#!/bin/sh
# sy108status - 免登录状态接口（只读）
# 返回 JSON：运行状态 / 网络连接 / 频段信号
# 信号数据缓存 30 秒，避免每次刷新都触发 modem AT 查询

echo "Content-Type: application/json"
echo "Access-Control-Allow-Origin: *"
echo "Cache-Control: no-store"
echo ""

CACHE=/tmp/sy108_signal.json
TTL=30
NOW=$(date +%s)

# ---------- 1. 信号（带缓存）----------
MT=0
[ -f "$CACHE" ] && MT=$(date -r "$CACHE" +%s 2>/dev/null || echo 0)

if [ $((NOW - MT)) -ge $TTL ]; then
	R=$(ubus call udx.cellular serving_refresh 2>/dev/null)
	ID=$(echo "$R" | jsonfilter -e '@.operation_id' 2>/dev/null)
	if [ -n "$ID" ]; then
		BOOT=$(echo "$R" | jsonfilter -e '@.boot_id' 2>/dev/null)
		BRK=$(echo "$R" | jsonfilter -e '@.broker_id' 2>/dev/null)
		REF="{\"id\":$ID,\"boot_id\":\"$BOOT\",\"broker_id\":\"$BRK\"}"
		ST=""
		i=0
		while [ $i -lt 8 ]; do
			sleep 0.6
			ST=$(ubus call udx.cellular operation_status "$REF" 2>/dev/null)
			S=$(echo "$ST" | jsonfilter -e '@.state' 2>/dev/null)
			case "$S" in
				complete) break ;;
				failed|cancelled|error) break ;;
			esac
			i=$((i + 1))
		done
		echo "$ST" | jsonfilter -e '@.result' 2>/dev/null > "$CACHE"
	fi
fi

BAND=$(jsonfilter -e '@.cells[@.serving=true].band' <"$CACHE" 2>/dev/null)
PCI=$(jsonfilter -e '@.cells[@.serving=true].pci' <"$CACHE" 2>/dev/null)
RSRP=$(jsonfilter -e '@.cells[@.serving=true].rsrp' <"$CACHE" 2>/dev/null)
RSRQ=$(jsonfilter -e '@.cells[@.serving=true].rsrq' <"$CACHE" 2>/dev/null)
SINR=$(jsonfilter -e '@.cells[@.serving=true].sinr' <"$CACHE" 2>/dev/null)
ARFCN=$(jsonfilter -e '@.cells[@.serving=true].arfcn' <"$CACHE" 2>/dev/null)

[ -z "$BAND" ] && BAND="--"
[ -z "$PCI" ] && PCI="null"
[ -z "$RSRP" ] && RSRP="null"
[ -z "$RSRQ" ] && RSRQ="null"
[ -z "$SINR" ] && SINR="null"
[ -z "$ARFCN" ] && ARFCN="null"

# ---------- 2. 系统 ----------
UP=$(cut -d. -f1 /proc/uptime)
TEMP_RAW=$(cat /sys/class/thermal/thermal_zone6/temp 2>/dev/null)
[ -z "$TEMP_RAW" ] && TEMP_RAW=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
TEMP=$(( ${TEMP_RAW:-0} / 1000 ))
MEMT=$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo)
MEMF=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
LOAD=$(cut -d' ' -f1 /proc/loadavg)
VER=$(sed -n "s/^DISTRIB_DESCRIPTION='\(.*\)'/\1/p" /etc/openwrt_release 2>/dev/null)
REL=$(sed -n "s/^DISTRIB_RELEASE='\(.*\)'/\1/p" /etc/openwrt_release 2>/dev/null)
[ -z "$VER" ] && VER="${REL:-OpenWrt}"

# ---------- 3. 蜂窝 ----------
CS=$(ubus call udx.cellular status 2>/dev/null)
STATE=$(echo "$CS" | jsonfilter -e '@.state' 2>/dev/null)
ERR=$(echo "$CS" | jsonfilter -e '@.last_error' 2>/dev/null)
APN=$(echo "$CS" | jsonfilter -e '@.profile.apn' 2>/dev/null)
REG=$(echo "$CS" | jsonfilter -e '@.registration.registered' 2>/dev/null)
ROAM=$(echo "$CS" | jsonfilter -e '@.roaming' 2>/dev/null)
PLMN=$(echo "$CS" | jsonfilter -e '@.operator.plmn' 2>/dev/null)
ACT=$(echo "$CS" | jsonfilter -e '@.registration.act' 2>/dev/null)
ICCID=$(echo "$CS" | jsonfilter -e '@.iccid' 2>/dev/null)
IMSI=$(echo "$CS" | jsonfilter -e '@.imsi' 2>/dev/null)
ATTACHED=$(echo "$CS" | jsonfilter -e '@.attached' 2>/dev/null)

[ -z "$STATE" ] && STATE="unknown"
[ -z "$ERR" ] && ERR_JSON=null || ERR_JSON="\"$ERR\""
[ -z "$APN" ] && APN="--"
[ -z "$REG" ] && REG="false"
[ -z "$ROAM" ] && ROAM="false"
[ -z "$PLMN" ] && PLMN="--"
[ -z "$ACT" ] && ACT="0"
[ -z "$ICCID" ] && ICCID=""
[ -z "$IMSI" ] && IMSI=""
[ -z "$ATTACHED" ] && ATTACHED="0"

# ---- SIM 识别（国家/运营商，来自 apn-auto 数据库） ----
COUNTRY=""
CARRIER=""
if [ -n "$IMSI" ]; then
	MCC=${IMSI%${IMSI#???}}
	MNC2=${IMSI#???}; MNC2=${MNC2%${MNC2#??}}
	MNC3=${IMSI#???}; MNC3=${MNC3%${MNC3#???}}
	COUNTRY=$(grep -m1 "^${MCC}|" /etc/apn-country.db 2>/dev/null | cut -d'|' -f2)
	ROW=$(grep -m1 "^${MCC}|${MNC3}|" /etc/apn-auto.db 2>/dev/null)
	[ -n "$ROW" ] || ROW=$(grep -m1 "^${MCC}|${MNC2}|" /etc/apn-auto.db 2>/dev/null)
	CARRIER=$(echo "$ROW" | cut -d'|' -f8)
fi

# ---------- 4. WAN ----------
WS=$(ubus call network.interface.wan status 2>/dev/null)
WUP=$(echo "$WS" | jsonfilter -e '@.up' 2>/dev/null)
WIP=$(echo "$WS" | sed -n '/"ipv4-address"/,/\]/p' | sed -n 's/.*"address": "\([0-9][0-9.]*\)".*/\1/p' | head -1)
WDNS=$(echo "$WS" | sed -n '/"dns-server"/,/\]/p' | sed -n 's/.*"\([0-9][0-9.]*\)".*/\1/p' | head -1)
WUPT=$(echo "$WS" | jsonfilter -e '@.uptime' 2>/dev/null)

[ -z "$WUP" ] && WUP="false"
[ -z "$WIP" ] && WIP="--"
[ -z "$WDNS" ] && WDNS="--"
[ -z "$WUPT" ] && WUPT="0"

# ---------- 5. 流量统计（跨重启累计，抗断电/并发）----------
# 设备无内置电池、拔 USB 即断电 => 状态文件必须原子写 + 回绕立即持久化
WW=wwan0
CUR_RX=$(cat /sys/class/net/$WW/statistics/rx_bytes 2>/dev/null || echo 0)
CUR_TX=$(cat /sys/class/net/$WW/statistics/tx_bytes 2>/dev/null || echo 0)
PERSIST=/root/traffic.state
LIVE=/tmp/traffic.live

# 并发锁：uhttpd 可能同时运行多个 CGI 实例（多标签页）
LOCKDIR=/tmp/traffic.lock
ACQ=0
if mkdir "$LOCKDIR" 2>/dev/null; then
	ACQ=1
else
	_wt=0
	while [ "$_wt" -lt 5 ]; do
		sleep 1
		if mkdir "$LOCKDIR" 2>/dev/null; then ACQ=1; break; fi
		_wt=$((_wt+1))
	done
fi

BASE_RX=0; BASE_TX=0; LAST_RX=0; LAST_TX=0; SAVED=0
if [ -f "$LIVE" ]; then
	. "$LIVE"
elif [ -f "$PERSIST" ]; then
	. "$PERSIST"
fi
# 状态文件损坏防护（断电可能截断文件）
for _v in BASE_RX BASE_TX LAST_RX LAST_TX; do
	eval "_t=\$$_v"
	case "$_t" in ''|*[!0-9]*) eval "$_v=0" ;; esac
done
PLAST_RX=$LAST_RX; PLAST_TX=$LAST_TX

# 回绕/重启检测：计数器回退 => 上一轮末值封存进基数
WRAPPED=0
if [ "$CUR_RX" -lt "$LAST_RX" ]; then BASE_RX=$((BASE_RX + LAST_RX)); WRAPPED=1; fi
if [ "$CUR_TX" -lt "$LAST_TX" ]; then BASE_TX=$((BASE_TX + LAST_TX)); WRAPPED=1; fi
TOTAL_RX=$((BASE_RX + CUR_RX))
TOTAL_TX=$((BASE_TX + CUR_TX))

# 持久化：回绕立即写（防再次断电丢失）；增量>2MB 写；每 5 分钟兜底写；tmp+mv 原子替换
NOW300=$((NOW / 300))
D_RX=$((CUR_RX - PLAST_RX)); [ "$D_RX" -lt 0 ] && D_RX=0
D_TX=$((CUR_TX - PLAST_TX)); [ "$D_TX" -lt 0 ] && D_TX=0
if [ "$WRAPPED" = "1" ] || [ "$SAVED" != "$NOW300" ] || [ "$D_RX" -gt 2097152 ] || [ "$D_TX" -gt 2097152 ]; then
	SAVED=$NOW300
	echo "BASE_RX=$BASE_RX BASE_TX=$BASE_TX LAST_RX=$CUR_RX LAST_TX=$CUR_TX SAVED=$SAVED" > "$PERSIST.tmp" 2>/dev/null && mv "$PERSIST.tmp" "$PERSIST" 2>/dev/null
fi
echo "BASE_RX=$BASE_RX BASE_TX=$BASE_TX LAST_RX=$CUR_RX LAST_TX=$CUR_TX SAVED=$SAVED" > "$LIVE"
[ "$ACQ" = "1" ] && rmdir "$LOCKDIR" 2>/dev/null

# ---------- 6. 频段扫描状态（band-auto 写入的阶段标记）----------
SCAN=""
if [ -f /tmp/band-auto.scan ] && find /tmp/band-auto.scan -mmin -15 2>/dev/null | grep -q .; then
	SCAN=$(tr -d '"' < /tmp/band-auto.scan 2>/dev/null)
fi

# ---------- 7. 输出 ----------
cat <<EOF
{"uptime":$UP,"temp":$TEMP,"mem_total":$MEMT,"mem_free":$MEMF,"load":"$LOAD","version":"$VER","scan":"$SCAN",
"cell":{"state":"$STATE","last_error":$ERR_JSON,"apn":"$APN","registered":$REG,"roaming":$ROAM,
"plmn":"$PLMN","act":$ACT,"iccid":"$ICCID","attached":$ATTACHED,"country":"$COUNTRY","carrier":"$CARRIER"},
"wan":{"up":$WUP,"ip":"$WIP","dns":"$WDNS","uptime":$WUPT},
"signal":{"band":"$BAND","pci":$PCI,"rsrp":$RSRP,"rsrq":$RSRQ,"sinr":$SINR,"arfcn":$ARFCN},
"traffic":{"rx":$TOTAL_RX,"tx":$TOTAL_TX,"boot_rx":$CUR_RX,"boot_tx":$CUR_TX},
"ts":$NOW}
EOF
