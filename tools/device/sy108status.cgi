#!/bin/sh
# sy108status - 免登录状态接口（只读）
# 返回 JSON：运行状态 / 网络连接 / 频段信号 / 实时速率 / 上行功率估算 / 能耗估算
# 信号数据缓存 30 秒，避免每次刷新都触发 modem AT 查询
# 所有功率与能耗数值均为模型估算，设备无电流采样硬件，非实测值

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
BW=$(jsonfilter -e '@.cells[@.serving=true].bandwidth_mhz' <"$CACHE" 2>/dev/null)

[ -z "$BAND" ] && BAND="--"
[ -z "$PCI" ] && PCI="null"
[ -z "$RSRP" ] && RSRP="null"
[ -z "$RSRQ" ] && RSRQ="null"
[ -z "$SINR" ] && SINR="null"
[ -z "$ARFCN" ] && ARFCN="null"
[ -z "$BW" ] || [ "$BW" = "null" ] && BW="null"

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
KERN=$(uname -r)
TARGET=$(sed -n "s/^DISTRIB_TARGET='\(.*\)'/\1/p" /etc/openwrt_release 2>/dev/null)
REV=$(sed -n "s/^DISTRIB_REVISION='\(.*\)'/\1/p" /etc/openwrt_release 2>/dev/null)

# 刷机 / 首次启动时间：取「首次开机自动生成」文件中最早的时间戳。
# 依据：/etc/config/fstab|firewall|luci|ubihealthd 与 dropbear 主机密钥，
# 由镜像首次启动时的 uci-defaults / dropbear 生成，之后不再变动。
FLASH_EPOCH=0
for f in /etc/config/fstab /etc/config/firewall /etc/config/luci /etc/config/ubihealthd \
         /etc/dropbear/dropbear_ed25519_host_key /etc/dropbear/dropbear_rsa_host_key; do
	[ -f "$f" ] || continue
	FT=$(date -r "$f" +%s 2>/dev/null)
	case "$FT" in ''|*[!0-9]*) continue ;; esac
	[ "$FT" -gt 0 ] || continue
	if [ "$FLASH_EPOCH" -eq 0 ] || [ "$FT" -lt "$FLASH_EPOCH" ]; then FLASH_EPOCH=$FT; fi
done
[ "$FLASH_EPOCH" -eq 0 ] && FLASH_EPOCH=$((NOW - UP))
FLASH_DATE=$(date -d @"$FLASH_EPOCH" "+%Y-%m-%d %H:%M" 2>/dev/null)
SERVICE_SEC=$((NOW - FLASH_EPOCH)); [ "$SERVICE_SEC" -lt 0 ] && SERVICE_SEC=0

# 累计通电运行时间：/usr/bin/runtime-tick 每 5 分钟采样，跨重启累加。
# 重启后采样脚本尚未运行时，临时把上一段计入显示值（不写回，避免重复累加）。
RST=/root/runtime.state
RTOTAL=0; RLAST_UP=0; RSINCE=$NOW; RSAMPLES=0; RLAST_TS=0
[ -f "$RST" ] && . "$RST"
for _v in RTOTAL RLAST_UP RSINCE RSAMPLES RLAST_TS; do
	eval "_t=\$$_v"
	case "$_t" in ''|*[!0-9]*) eval "$_v=0" ;; esac
done
[ "$RSINCE" -eq 0 ] && RSINCE=$NOW
[ "$RLAST_UP" -gt "$UP" ] && RTOTAL=$((RTOTAL + RLAST_UP))
RUNTIME_TOTAL=$((RTOTAL + UP))
RUNTIME_SINCE_DATE=$(date -d @"$RSINCE" "+%Y-%m-%d %H:%M" 2>/dev/null)

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
SIMST=$(echo "$CS" | jsonfilter -e '@.sim.state' 2>/dev/null)
AMBR_DL=$(echo "$CS" | jsonfilter -e '@.qos.ambr_downlink_kbps' 2>/dev/null)
AMBR_UL=$(echo "$CS" | jsonfilter -e '@.qos.ambr_uplink_kbps' 2>/dev/null)

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
[ -z "$SIMST" ] && SIMST="UNKNOWN"
[ -z "$AMBR_DL" ] && AMBR_DL="0"
[ -z "$AMBR_UL" ] && AMBR_UL="0"
AMBR_DL_MBPS=$((AMBR_DL / 1000))
AMBR_UL_MBPS=$((AMBR_UL / 1000))

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
WW=wwan0
CUR_RX=$(cat /sys/class/net/$WW/statistics/rx_bytes 2>/dev/null || echo 0)
CUR_TX=$(cat /sys/class/net/$WW/statistics/tx_bytes 2>/dev/null || echo 0)
PERSIST=/root/traffic.state
LIVE=/tmp/traffic.live

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
for _v in BASE_RX BASE_TX LAST_RX LAST_TX; do
	eval "_t=\$$_v"
	case "$_t" in ''|*[!0-9]*) eval "$_v=0" ;; esac
done
PLAST_RX=$LAST_RX; PLAST_TX=$LAST_TX

WRAPPED=0
if [ "$CUR_RX" -lt "$LAST_RX" ]; then BASE_RX=$((BASE_RX + LAST_RX)); WRAPPED=1; fi
if [ "$CUR_TX" -lt "$LAST_TX" ]; then BASE_TX=$((BASE_TX + LAST_TX)); WRAPPED=1; fi
TOTAL_RX=$((BASE_RX + CUR_RX))
TOTAL_TX=$((BASE_TX + CUR_TX))

NOW300=$((NOW / 300))
D_RX=$((CUR_RX - PLAST_RX)); [ "$D_RX" -lt 0 ] && D_RX=0
D_TX=$((CUR_TX - PLAST_TX)); [ "$D_TX" -lt 0 ] && D_TX=0
if [ "$WRAPPED" = "1" ] || [ "$SAVED" != "$NOW300" ] || [ "$D_RX" -gt 2097152 ] || [ "$D_TX" -gt 2097152 ]; then
	SAVED=$NOW300
	echo "BASE_RX=$BASE_RX BASE_TX=$BASE_TX LAST_RX=$CUR_RX LAST_TX=$CUR_TX SAVED=$SAVED" > "$PERSIST.tmp" 2>/dev/null && mv "$PERSIST.tmp" "$PERSIST" 2>/dev/null
fi
echo "BASE_RX=$BASE_RX BASE_TX=$BASE_TX LAST_RX=$CUR_RX LAST_TX=$CUR_TX SAVED=$SAVED" > "$LIVE"
[ "$ACQ" = "1" ] && rmdir "$LOCKDIR" 2>/dev/null

# ---------- 6. 实时速率（相邻两次采样的字节差 / 时间差）----------
RSTATE=/tmp/sy108_rate.state
PRX=0; PTX=0; PTS=0
[ -f "$RSTATE" ] && . "$RSTATE"
case "$PRX$PTX$PTS" in *[!0-9]*) PRX=0; PTX=0; PTS=0 ;; esac
DT=$((NOW - PTS))
[ "$PTS" -eq 0 ] && DT=0
if [ "$DT" -gt 0 ] && [ "$DT" -lt 300 ] && [ "$CUR_RX" -ge "$PRX" ] && [ "$CUR_TX" -ge "$PTX" ]; then
	DOWN_BPS=$(( (CUR_RX - PRX) * 8 / DT ))
	UP_BPS=$(( (CUR_TX - PTX) * 8 / DT ))
else
	DOWN_BPS=0; UP_BPS=0
fi
echo "PRX=$CUR_RX PTX=$CUR_TX PTS=$NOW" > "$RSTATE"

# ---------- 7. 频段扫描状态 ----------
SCAN=""
if [ -f /tmp/band-auto.scan ] && find /tmp/band-auto.scan -mmin -15 2>/dev/null | grep -q .; then
	SCAN=$(tr -d '"' < /tmp/band-auto.scan 2>/dev/null)
fi
BANDMODE=$(cat /etc/bandlock.mode 2>/dev/null)
[ -z "$BANDMODE" ] && BANDMODE="auto"

# ---------- 8. 上行发射功率估算（非实测）----------
# 依据 3GPP 开环功控：PL ≈ 参考信号功率 - RSRP；
# P_est ≈ P0 + α·PL + 带宽/MCS 修正，此处用线性近似 (-75 + 0.8*PL) dBm。
# 设备未暴露 PUSCH / PHR 实测接口，AT 工程模式矩阵亦无可解析功率字段。
RSRP_INT=""
case "$RSRP" in
	-[0-9]*|[0-9]*) RSRP_INT=$(echo "$RSRP" | cut -d. -f1) ;;
esac
CAP=23
case "$BAND" in n78|n79|n41|n77) CAP_HPUE=26 ;; *) CAP_HPUE=23 ;; esac
if [ -n "$RSRP_INT" ]; then
	PL=$((20 - RSRP_INT))
	[ "$PL" -lt 40 ] && PL=40
	[ "$PL" -gt 160 ] && PL=160
	EST=$(( (-7500 + 80 * PL) / 100 ))
	[ "$EST" -lt 0 ] && EST=0
	[ "$EST" -gt "$CAP" ] && EST=$CAP
	LOW=$((EST - 4)); [ "$LOW" -lt 0 ] && LOW=0
	HIGH=$((EST + 4)); [ "$HIGH" -gt "$CAP" ] && HIGH=$CAP
	HEADROOM=$((CAP - EST))
	POWER_JSON="\"tx_est_dbm\":$EST,\"tx_low_dbm\":$LOW,\"tx_high_dbm\":$HIGH,\"headroom_db\":$HEADROOM,\"cap_dbm\":$CAP,\"hpue_cap_dbm\":$CAP_HPUE,\"pl_db\":$PL,\"class\":\"PC3 (23 dBm)\",\"measured\":false,\"method\":\"3GPP open-loop estimate from RSRP\""
else
	EST=0; PL=0
	POWER_JSON="\"tx_est_dbm\":null,\"tx_low_dbm\":null,\"tx_high_dbm\":null,\"headroom_db\":null,\"cap_dbm\":$CAP,\"hpue_cap_dbm\":$CAP_HPUE,\"pl_db\":null,\"class\":\"PC3 (23 dBm)\",\"measured\":false,\"method\":\"3GPP open-loop estimate from RSRP\""
fi

# ---------- 9. 能耗估算（模型 + 时间积分，非实测）----------
# 公开规格参考（UDX710 USB 供电设备）：空闲 0.75 W、工作电流 760 mA ≈ 3.8 W @5V、
# 峰值电流 3 A；同类 5G CPE 满载实测约 6.8 W。
# 模型：基础 1.10 W + 数据链路 0.50 W + 吞吐加成(≤1.20 W) + PA 加成(≤0.80 W) + 扫描 0.60 W
BASECW=110
LINKCW=0
[ "$STATE" = "pdp_active" ] && LINKCW=50
RATE_TOTAL=$((DOWN_BPS + UP_BPS))
TRAFCW=$(( RATE_TOTAL / 1000 * 120 / 100000 ))
[ "$TRAFCW" -gt 120 ] && TRAFCW=120
if [ "$EST" -le 5 ]; then TXCW=5
elif [ "$EST" -le 10 ]; then TXCW=10
elif [ "$EST" -le 15 ]; then TXCW=20
elif [ "$EST" -le 20 ]; then TXCW=45
else TXCW=80
fi
SCANCW=0
[ -n "$SCAN" ] && SCANCW=60
PWCW=$((BASECW + LINKCW + TRAFCW + TXCW + SCANCW))

# 能量积分：用上一次采样功率代表这段区间，Wh×1000 (mWh) 存整数
ESTATE=/root/energy.state
ETMP=/root/energy.state.tmp
ELTS=0; ELASTCW=$PWCW; ETOTAL=0; EBOOT=0; EBOOTUP=0
[ -f "$ESTATE" ] && . "$ESTATE"
for _v in ELTS ELASTCW ETOTAL EBOOT EBOOTUP; do
	eval "_t=\$$_v"
	case "$_t" in ''|*[!0-9]*) eval "$_v=0" ;; esac
done
[ "$EBOOTUP" -gt "$UP" ] && EBOOT=0
EDT=$((NOW - ELTS)); [ "$ELTS" -eq 0 ] && EDT=0
[ "$EDT" -lt 0 ] && EDT=0; [ "$EDT" -gt 3600 ] && EDT=3600
EADD=$(( ELASTCW * EDT / 360 ))
ETOTAL=$((ETOTAL + EADD))
EBOOT=$((EBOOT + EADD))
echo "ELTS=$NOW ELASTCW=$PWCW ETOTAL=$ETOTAL EBOOT=$EBOOT EBOOTUP=$UP" > "$ETMP" 2>/dev/null && mv "$ETMP" "$ESTATE" 2>/dev/null

# ---------- 10. 输出 ----------
cat <<EOF
{"uptime":$UP,"temp":$TEMP,"mem_total":$MEMT,"mem_free":$MEMF,"load":"$LOAD","version":"$VER","scan":"$SCAN","band_mode":"$BANDMODE",
"system":{"version":"$VER","release":"$REL","revision":"$REV","target":"$TARGET","kernel":"$KERN","flash_epoch":$FLASH_EPOCH,"flash_date":"$FLASH_DATE","flash_basis":"first-boot generated files: /etc/config/fstab, dropbear host keys","service_sec":$SERVICE_SEC,"runtime_total_sec":$RUNTIME_TOTAL,"runtime_since":$RSINCE,"runtime_since_date":"$RUNTIME_SINCE_DATE","runtime_samples":$RSAMPLES,"boot_sec":$UP},
"cell":{"state":"$STATE","last_error":$ERR_JSON,"apn":"$APN","registered":$REG,"roaming":$ROAM,
"plmn":"$PLMN","act":$ACT,"iccid":"$ICCID","attached":$ATTACHED,"sim":"$SIMST","country":"$COUNTRY","carrier":"$CARRIER"},
"wan":{"up":$WUP,"ip":"$WIP","dns":"$WDNS","uptime":$WUPT,"iface":"wwan0"},
"signal":{"band":"$BAND","pci":$PCI,"rsrp":$RSRP,"rsrq":$RSRQ,"sinr":$SINR,"arfcn":$ARFCN,"bandwidth_mhz":$BW},
"traffic":{"rx":$TOTAL_RX,"tx":$TOTAL_TX,"boot_rx":$CUR_RX,"boot_tx":$CUR_TX},
"rate":{"down_bps":$DOWN_BPS,"up_bps":$UP_BPS,"interval_s":$DT},
"qos":{"ambr_down_mbps":$AMBR_DL_MBPS,"ambr_up_mbps":$AMBR_UL_MBPS},
"power":{$POWER_JSON},
"energy":{"watt_cw":$PWCW,"total_mwh":$ETOTAL,"boot_mwh":$EBOOT,"tariff_cny_per_kwh":60,"measured":false,"model":"idle 0.75W / active 3.8W UDX710 reference"},
"ts":$NOW}
EOF
