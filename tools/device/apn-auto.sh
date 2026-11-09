#!/bin/sh
# apn-auto —— 按 SIM（IMSI MCC/MNC）自动识别国家/运营商并切换 APN
# 数据库: /etc/apn-auto.db（mcc|mnc|apn|pdp|auth|user|pass|carrier）
#         /etc/apn-country.db（mcc|country_zh）
# 用法:
#   apn-auto show      显示当前 SIM 识别结果与建议配置
#   apn-auto apply     立即应用建议 APN（查表命中才动手）
#   apn-auto check     供 cron/开机调用：换卡(ICCID变化)时自动切换
#   apn-auto on|off    开/关「换卡自动切换」（默认开）
#   apn-auto status    显示自动模式状态与上次识别记录

DB=/etc/apn-auto.db
CDB=/etc/apn-country.db
STATE=/var/run/apn-auto.state
FLAG=/etc/apn-auto.enabled
LOG=/tmp/apn-auto.log

[ -f "$FLAG" ] || [ -f /etc/apn-auto.disabled ] || touch "$FLAG" 2>/dev/null

log() { echo "$(date '+%m-%d %H:%M:%S') $*" >> "$LOG" 2>/dev/null; }

get_field() { # $1=jsonfilter 表达式
    ubus call udx.cellular status 2>/dev/null | jsonfilter -e "$1" 2>/dev/null
}

# ---- 1. 读 SIM 身份 ----
read_sim() {
    IMSI=$(get_field '@.imsi')
    ICCID=$(get_field '@.iccid')
    SIMSTATE=$(get_field '@.sim.state')
    [ -n "$IMSI" ] && [ "$IMSI" != "null" ] || { echo "SIM: 未读到 IMSI（无卡/未就绪）"; return 1; }
    MCC=${IMSI%${IMSI#???}}                 # 前3位
    MNC3=${IMSI#???}; MNC3=${MNC3%${MNC3#???}}  # 4-6位
    MNC2=${IMSI#???}; MNC2=${MNC2%${MNC2#??}}   # 4-5位
    return 0
}

# ---- 2. 查表（MNC 先3位后2位；实测覆盖行在生成时已置顶同名替换） ----
lookup() {
    HIT=""
    for mnc in "$MNC3" "$MNC2"; do
        [ -n "$mnc" ] || continue
        HIT=$(grep -m1 "^${MCC}|${mnc}|" "$DB" 2>/dev/null)
        [ -n "$HIT" ] && break
    done
    [ -n "$HIT" ] || return 1
    OLDIFS=$IFS; IFS='|'
    set -- $HIT; IFS=$OLDIFS
    L_MCC=$1; L_MNC=$2; L_APN=$3; L_PDP=$4; L_AUTH=$5; L_USER=$6; L_PASS=$7; L_CARRIER=$8
    return 0
}

country_of() {
    c=$(grep -m1 "^${MCC}|" "$CDB" 2>/dev/null | cut -d'|' -f2)
    echo "${c:-未知}"
}

current_apn() {
    ubus call udx.cellular status 2>/dev/null | jsonfilter -e '@.profile.apn' 2>/dev/null
}

# ---- 3. 应用 APN（参数格式与 LuCI 前端一致；ubus 异步，需轮询结果） ----
apply_apn() {
    apn="$1"; pdp="$2"; auth="$3"; user="$4"; pass="$5"
    case "$pdp" in IPV4|IPV6|IPV4V6) ;; *) pdp=IPV4V6 ;; esac
    case "$auth" in none|pap|chap) ;; *) auth=none ;; esac
    res=$(ubus call udx.cellular apn "{\"apn\":\"$apn\",\"pdp_type\":\"$pdp\",\"cid\":1,\"username\":\"$user\",\"password\":\"$pass\",\"auth_method\":\"$auth\"}" 2>/dev/null)
    oid=$(echo "$res" | jsonfilter -e '@.operation_id' 2>/dev/null)
    bid=$(echo "$res" | jsonfilter -e '@.boot_id' 2>/dev/null)
    brk=$(echo "$res" | jsonfilter -e '@.broker_id' 2>/dev/null)
    # 轮询异步结果（最多 60 秒；CMHK 双栈激活实测需约 25 秒）
    st=""
    if [ -n "$oid" ]; then
        i=0
        while [ $i -lt 60 ]; do
            sleep 1
            st=$(ubus call udx.cellular operation_status "{\"id\":$oid,\"boot_id\":\"$bid\",\"broker_id\":\"$brk\"}" 2>/dev/null | jsonfilter -e '@.state' 2>/dev/null)
            case "$st" in complete|failed) break ;; esac
            i=$((i+1))
        done
    fi
    # 以读回 profile.apn 为准
    sleep 2
    cur=$(current_apn)
    if [ "$cur" = "$apn" ]; then
        log "APN 已应用: $apn ($pdp/$auth) 运营商=$L_CARRIER 国家=$(country_of) 结果=$st"
        echo "OK: APN 已切换为 $apn（$pdp，认证 $auth）"
        return 0
    fi
    log "APN 应用失败: $apn 目标=$apn 读回=${cur:-无} 结果=$st"
    echo "WARN: APN 切换未确认成功（读回 ${cur:-空}），请运行 apn-auto show 查看"
    return 1
}

# ---- 4. 命令 ----
cmd_show() {
    if ! read_sim; then return 1; fi
    echo "SIM 状态  : $SIMSTATE"
    echo "ICCID     : $ICCID"
    echo "IMSI      : $IMSI"
    echo "识别国家  : $(country_of)（MCC $MCC）"
    if lookup; then
        echo "识别运营商: $L_CARRIER（MCC/MNC $L_MCC/$L_MNC）"
        echo "建议 APN  : $L_APN  PDP=$L_PDP  认证=$L_AUTH"
        cur=$(current_apn)
        echo "当前 APN  : ${cur:-（无）}"
        if [ "$cur" = "$L_APN" ]; then
            echo "状态      : 已匹配，无需更改"
        else
            echo "状态      : 与建议不一致，运行 apn-auto apply 可自动切换"
        fi
    else
        echo "识别运营商: 未知（MCC/MNC $MCC/$MNC2 不在数据库）"
        echo "提示      : 可手动在 LuCI 或用 ubus 设置 APN，或补充 /etc/apn-auto.db"
    fi
}

cmd_apply() {
    if ! read_sim; then return 1; fi
    if lookup; then
        echo "识别: $(country_of) / $L_CARRIER -> $L_APN"
        apply_apn "$L_APN" "$L_PDP" "$L_AUTH" "$L_USER" "$L_PASS"
    else
        echo "未命中数据库（MCC=$MCC MNC=$MNC2/$MNC3），不改动当前配置"
        return 1
    fi
}

cmd_check() {
    # 自动模式总闸
    [ -f /etc/apn-auto.disabled ] && return 0
    if ! read_sim; then return 0; fi
    # 记录上次 ICCID，变化（换卡）才动
    LAST=$(cut -d' ' -f1 "$STATE" 2>/dev/null)
    if [ "$ICCID" = "$LAST" ]; then
        return 0
    fi
    if lookup; then
        log "检测到 SIM 变化: ICCID=$ICCID 国家=$(country_of) 运营商=$L_CARRIER，自动切换 APN=$L_APN"
        apply_apn "$L_APN" "$L_PDP" "$L_AUTH" "$L_USER" "$L_PASS"
    else
        log "检测到 SIM 变化: ICCID=$ICCID MCC=$MCC MNC=$MNC2 未命中数据库，保持现状"
    fi
    echo "$ICCID $MCC/$MNC2 $(country_of) $L_CARRIER $L_APN" > "$STATE" 2>/dev/null
}

cmd_status() {
    if [ -f /etc/apn-auto.disabled ]; then
        echo "自动切换: 已关闭（apn-auto on 可开启）"
    else
        echo "自动切换: 已开启（换卡时自动识别国家/运营商并切换 APN）"
    fi
    [ -f "$STATE" ] && echo "上次识别: $(cat "$STATE")"
    echo "当前 APN : $(current_apn)"
    [ -f "$LOG" ] && echo "--- 最近日志 ---" && tail -5 "$LOG"
}

case "$1" in
    show)   cmd_show ;;
    apply)  cmd_apply ;;
    check)  cmd_check ;;
    status) cmd_status ;;
    on)     rm -f /etc/apn-auto.disabled; echo "自动切换已开启" ;;
    off)    touch /etc/apn-auto.disabled; echo "自动切换已关闭" ;;
    *)      echo "用法: apn-auto show|apply|check|status|on|off"; exit 1 ;;
esac
