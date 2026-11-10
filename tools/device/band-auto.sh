#!/bin/sh
# band-auto v2 — 智能选频（手机式：默认自动，仅在明确更优时锁定「频段组」）
# 用法: band-auto run      周期检查（cron 每5分钟调用）
#       band-auto scan     强制全频段扫描
#       band-auto status   查看状态
#       band-auto on|off   启用 / 停用自动选频
#       band-auto log      查看最近日志
#
# v2 策略（像手机一样自动切换）：
#   1. 默认不锁频 —— 基带全频段自由切换 = 手机行为，掉一个频段自动回退到别的频段
#   2. 信号持续差才扫描；赢家需比当前快 15% 且实测 >= 10Mbps 才值得锁定
#      （全网拥塞时所有频段都慢，锁谁都没用，样本不可靠就不锁）
#   3. 锁定的是「频段组」：赢家 + 实测接近的频段（>= 赢家 50%，最多 3 个），
#      组内基带可自动切换 —— 不会像锁单频段那样一掉信号就没网
#   4. 锁定 2 小时自动解锁回 auto（TTL）
#   5. 看门狗：锁定期间掉网连续 2 次 => 立即解锁回 auto + 冷却 2 小时
#   6. 只管理 band-auto 自己上的锁（/etc/band-auto.hold），不干扰手动 bandlock
# 依赖: bandlock(ubus band_lock), curl, jsonfilter, awk
# 副作用: 扫描期间断线 1-3 分钟（每切换一次频段重注册约 25 秒）

FLAG_ON=/etc/band-auto.on
STATE=/root/band-auto.state
LOG=/root/band-auto.log
LOCK=/tmp/band-auto.lock
HOLD=/etc/band-auto.hold
MODE=/etc/bandlock.mode
LIST_FILE=/etc/band-auto.list
PRIMARY_DEF="n78 n79 n41"
FALLBACK="n28 n1 n3"

GOOD_SINR=5          # SINR >= 此值视为信号好
GOOD_RSRP=-85        # RSRP >= 此值视为信号好
POOR_NEED=2          # 连续几次信号差才触发扫描（配合 5 分钟 cron = 10 分钟持续差）
COOLDOWN=1800        # 两次扫描最小间隔（秒）
COOLDOWN_STAY=7200   # 上次扫描结论为「维持现状」时的冷却
COOLDOWN_REVERT=7200 # 看门狗解锁后的冷却（避免马上又锁回去）
REG_WAIT=60          # 每个频段等待驻网上限（秒）；band_lock 异步生效需等真正切换
SWITCH_MARGIN=1.15   # 新频段比当前快 15% 以上才切换
MIN_WIN_BPS=1250000  # 赢家实测 >= 10Mbps 才允许锁定（低于此值视为拥塞样本，不锁）
GROUP_MARGIN=0.5     # 实测 >= 赢家 50% 的频段加入锁定组（组内可自动切换）
GROUP_MAX=3          # 锁定组最多频段数
LOCK_TTL=7200        # 锁定有效期（秒），到期自动解锁回 auto
WD_NEED=2            # 锁定期间连续掉网几次触发看门狗解锁
PROBE_URL="https://speed.cloudflare.com/__down?bytes=2097152"
CANDS=/tmp/band-auto.cands

# ---------- 基础 ----------
log() {
	echo "$(date '+%m-%d %H:%M:%S') $*" >> "$LOG" 2>/dev/null
	tail -n 200 "$LOG" 2>/dev/null > "$LOG.t" && mv "$LOG.t" "$LOG" 2>/dev/null
}

getj() { curl -s --max-time 15 http://127.0.0.1/cgi-bin/sy108status 2>/dev/null; }

# $1=a $2=op(< > >= <= ==) $3=b  浮点比较，真返回0
fcmp() { awk -v a="$1" -v op="$2" -v b="$3" 'BEGIN{
	if(op=="<")  { exit !(a<b)  }
	if(op==">")  { exit !(a>b)  }
	if(op==">=") { exit !(a>=b) }
	if(op=="<=") { exit !(a<=b) }
	if(op=="==") { exit !(a==b) }
	exit 1 }'; }

# 信号综合分（仅作同速/无速率时的次级参考）：SINR 权重高，RSRP 次之
sigscore() { awk -v s="$1" -v r="$2" 'BEGIN{ printf "%.1f", s*10 + (r+110)*0.3 }'; }

mbps() { awk -v v="$1" 'BEGIN{printf "%.1f", v*8/1000000}'; }

probe() { # 输出 B/s（float），失败输出 0（失败自动重试一次）
	P=$(curl -o /dev/null -s -w '%{speed_download}' --max-time 15 "$PROBE_URL" 2>/dev/null | grep -oE '^[0-9.]+' | head -1)
	if [ -z "$P" ] || [ "$P" = "0" ] || [ "$P" = "0.000" ]; then
		sleep 2
		P=$(curl -o /dev/null -s -w '%{speed_download}' --max-time 15 "$PROBE_URL" 2>/dev/null | grep -oE '^[0-9.]+' | head -1)
	fi
	[ -z "$P" ] && P=0
	echo "$P"
}

wait_band() { # $1=目标频段或逗号分隔的组：等信号真正切入目标（组）且 PDP 激活
	i=0
	while [ "$i" -lt "$REG_WAIT" ]; do
		J=$(getj)
		B=$(echo "$J" | jsonfilter -e '@.signal.band' 2>/dev/null)
		ST=$(echo "$J" | jsonfilter -e '@.cell.state' 2>/dev/null)
		if [ "$B" != "" ] && [ "$B" != "?" ] && [ "$ST" = "pdp_active" ]; then
			case ",$1," in
			*",$B,"*) sleep 3; return 0 ;;
			esac
		fi
		sleep 3
		i=$((i+3))
	done
	return 1
}

measure() { # 输出 "band|probe|sinr|rsrp|score"
	J=$(getj)
	B=$(echo "$J" | jsonfilter -e '@.signal.band' 2>/dev/null)
	SN=$(echo "$J" | jsonfilter -e '@.signal.sinr' 2>/dev/null)
	RS=$(echo "$J" | jsonfilter -e '@.signal.rsrp' 2>/dev/null)
	[ -z "$B" ] && B="?"
	[ -z "$SN" ] && SN=-99
	[ -z "$RS" ] && RS=-140
	P=$(probe)
	[ -z "$P" ] && P=0
	SC=$(sigscore "$SN" "$RS")
	echo "$B|$P|$SN|$RS|$SC"
}

load_state() {
	POOR=0; LAST_SCAN=0; LAST_RESULT=none; LAST_CHOICE=auto; LOCK_TIME=0; WD_BAD=0
	[ -f "$STATE" ] && . "$STATE"
}

save_state() {
	echo "POOR=$POOR LAST_SCAN=$LAST_SCAN LAST_RESULT=$LAST_RESULT LAST_CHOICE=$LAST_CHOICE LOCK_TIME=$LOCK_TIME WD_BAD=$WD_BAD" > "$STATE" 2>/dev/null
}

bands_to_scan() {
	if [ -f "$LIST_FILE" ]; then
		cat "$LIST_FILE"
	else
		echo "$PRIMARY_DEF $FALLBACK"
	fi
}

# ---------- 锁管理（只管理 band-auto 自己上的锁） ----------
# $1=频段 $2=逗号组 => 组含该频段返回0
in_group() {
	case ",$2," in *",$1,"*) return 0 ;; esac
	return 1
}

acquire_lock() { # $1=频段（单个或逗号组，如 n78,n79）
	case "$1" in
	*,*) /usr/bin/bandlock "g=$1" >/dev/null 2>&1 ;;
	*)   /usr/bin/bandlock "$1" >/dev/null 2>&1 ;;
	esac
	echo "$1" > "$HOLD"
	LOCK_TIME=$(date +%s)
	WD_BAD=0
}

release_lock() { # 解锁回 auto（手机模式）
	/usr/bin/bandlock auto >/dev/null 2>&1
	rm -f "$HOLD"
	LOCK_TIME=0
	WD_BAD=0
}

# 扫描期间的临时锁：直接走 ubus，绝不写 /etc/bandlock.mode。
# 否则扫描被 kill/断电中断时，某个无覆盖的中间频段会被 rc.local 开机永久恢复。
scan_lock() { # $1=单个频段
	ubus call udx.cellular band_lock "{\"lte\":[],\"nr\":[\"$1\"]}" >/dev/null 2>&1
}

# ---------- 看门狗：掉网自愈 / 锁定期间掉网解锁 / TTL 到期 ----------
do_watch() {
	[ -d "$LOCK" ] && return 0   # 扫描进行中，不干预
	load_state
	if [ ! -f "$FLAG_ON" ] && [ -f "$HOLD" ]; then
		log "watchdog: band-auto 已停用但存在锁定 [$LAST_CHOICE]，解锁回 auto"
		release_lock
		LAST_RESULT=revert-disabled; LAST_CHOICE=auto
		save_state
		return 0
	fi

	if [ ! -f "$HOLD" ]; then
		# auto（手机式）模式下的掉网自愈：PDP 未激活连续 N 次 => 重试 APN
		J=$(getj)
		ST=$(echo "$J" | jsonfilter -e '@.cell.state' 2>/dev/null)
		# 没插卡时不算「掉网」，不做无效的 APN 重试，也不刷日志
		case "$ST" in
		waiting_sim|no_sim|sim_error|"")
			[ "$WD_BAD" != "0" ] && { WD_BAD=0; save_state; }
			return 0 ;;
		esac
		if [ "$ST" = "pdp_active" ]; then
			[ "$WD_BAD" != "0" ] && { WD_BAD=0; save_state; }
			return 0
		fi
		WD_BAD=$((WD_BAD+1))
		save_state
		if [ "$WD_BAD" -ge "$WD_NEED" ]; then
			log "watchdog: auto 模式掉网（state=${ST:-empty}）连续 ${WD_BAD} 次，重试 APN 自愈"
			/usr/bin/apn-auto apply >/dev/null 2>&1
			WD_BAD=0
			save_state
		fi
		return 0
	fi

	# TTL 到期自动解锁
	NOW=$(date +%s)
	if [ "$LOCK_TIME" != "0" ] && [ $((NOW - LOCK_TIME)) -ge "$LOCK_TTL" ]; then
		log "watchdog: 锁定 [$LAST_CHOICE] 已满 $LOCK_TTL 秒（TTL），自动解锁回 auto"
		release_lock
		LAST_RESULT=ttl-expire; LAST_CHOICE=auto
		save_state
		return 0
	fi

	# 掉网检测
	J=$(getj)
	ST=$(echo "$J" | jsonfilter -e '@.cell.state' 2>/dev/null)
	B=$(echo "$J" | jsonfilter -e '@.signal.band' 2>/dev/null)
	if [ "$ST" = "pdp_active" ] && [ -n "$B" ] && [ "$B" != "?" ]; then
		if [ "$WD_BAD" != "0" ]; then WD_BAD=0; save_state; fi
		return 0
	fi
	WD_BAD=$((WD_BAD+1))
	save_state
	if [ "$WD_BAD" -ge "$WD_NEED" ]; then
		log "watchdog: 锁定 [$LAST_CHOICE] 期间掉网 ${WD_BAD} 次（state=$ST band=$B），自动解锁回 auto"
		release_lock
		LAST_RESULT=watchdog-revert; LAST_CHOICE=auto
		# 冷却：把 LAST_SCAN 拨到现在，避免马上又扫描锁回去
		LAST_SCAN=$(date +%s)
		save_state
	fi
	return 0
}

# ---------- 扫描 ----------
do_scan() {
	if ! mkdir "$LOCK" 2>/dev/null; then
		log "scan 跳过：另一个扫描正在进行"
		echo "另一个扫描正在进行，稍后再试"
		return 1
	fi
	# shellcheck disable=SC2064
	# 异常退出（kill / 断电 / 重启）也要解锁并清掉持久化标记，
	# 避免把扫描中间态的频段留到下次开机。
	trap "/usr/bin/bandlock auto >/dev/null 2>&1; rm -f '$HOLD'; rmdir '$LOCK' 2>/dev/null; rm -f /tmp/band-auto.scan '$CANDS'" EXIT INT TERM

	load_state   # 确保 POOR 等变量已初始化（直接 scan 调用时）

	log "scan 开始（v2 组锁定策略）"
	echo "扫描中" > /tmp/band-auto.scan
	echo "开始扫描候选频段（每次切换需重注册约 25 秒，请稍候）..."

	# 1) 基准：当前频段实测
	BASE=$(measure)
	BASE_B=$(echo "$BASE" | cut -d'|' -f1)
	BASE_P=$(echo "$BASE" | cut -d'|' -f2)
	echo "当前: $BASE_B  速率=$(mbps "$BASE_P")Mbps"
	log "scan 基准 $BASE"

	# 2) 逐个候选频段实测
	BEST_B=""; BEST_P=0; BEST_S=-999; ANY_REG=0
	: > "$CANDS"
	for b in $(bands_to_scan); do
		echo "测试 $b" > /tmp/band-auto.scan
		if [ "$b" = "$BASE_B" ]; then
			CAND="$BASE"
			ANY_REG=1   # 当前频段必然已注册（刚测过）
		else
			scan_lock "$b"
			if wait_band "$b"; then
				ANY_REG=1
				CAND=$(measure)
			else
				CAND="$b|-1|-99|-140|-999"
			fi
		fi
		CB=$(echo "$CAND" | cut -d'|' -f1)
		CP=$(echo "$CAND" | cut -d'|' -f2)
		CS=$(echo "$CAND" | cut -d'|' -f3)
		CR=$(echo "$CAND" | cut -d'|' -f4)
		CSC=$(echo "$CAND" | cut -d'|' -f5)
		log "scan $CB probe=$CP sinr=$CS rsrp=$CR score=$CSC"
		echo "  $CB: $(mbps "$CP")Mbps  SINR=${CS}dB  RSRP=${CR}dBm"
		echo "$CB|$CP|$CS|$CR|$CSC" >> "$CANDS"
		# 排序：实测速率优先；速率相同(含0)比信号分
		if fcmp "$CP" ">" "$BEST_P" || { fcmp "$CP" "==" "$BEST_P" && fcmp "$CSC" ">" "$BEST_S"; }; then
			BEST_B=$CB; BEST_P=$CP; BEST_S=$CSC
		fi
	done

	# 3) 组装频段组：赢家 + 实测 >= 赢家 GROUP_MARGIN 的频段（组内可自动切换）
	GROUP="$BEST_B"
	if [ -n "$BEST_B" ] && fcmp "$BEST_P" ">" "0"; then
		THR=$(awk -v p="$BEST_P" -v m="$GROUP_MARGIN" 'BEGIN{printf "%.6f", p*m}')
		while IFS='|' read -r CB CP _cs _cr _csc; do
			[ -z "$CB" ] && continue
			[ "$CB" = "$BEST_B" ] && continue
			GN=$(echo "$GROUP" | awk -F, '{print NF}')
			[ "$GN" -ge "$GROUP_MAX" ] && break
			if fcmp "$CP" ">=" "$THR" && fcmp "$CP" ">" "0"; then
				GROUP="$GROUP,$CB"
			fi
		done < "$CANDS"
	fi

	# 4) 决策
	NOW=$(date +%s)
	if [ -z "$BEST_B" ] || [ "$ANY_REG" = "0" ]; then
		release_lock
		LAST_RESULT=fallback-auto; LAST_CHOICE=auto
		log "scan 结论：所有候选无注册，回退 auto"
		echo "结论：所有候选频段无信号，已保持自动模式（交给基带选网）"
	elif fcmp "$BEST_P" "<" "$MIN_WIN_BPS"; then
		# 全网拥塞/样本不可靠：谁都不锁，保持手机式自动
		release_lock
		LAST_RESULT=too-slow-no-lock; LAST_CHOICE=auto
		log "scan 结论：最快 $BEST_B 仅 $(mbps "$BEST_P")Mbps（< $(mbps "$MIN_WIN_BPS")Mbps），样本不可靠，保持 auto"
		echo "结论：当前环境所有频段都慢（最快 $BEST_B 仅 $(mbps "$BEST_P")Mbps），锁定无意义，保持自动模式"
	elif [ "$BEST_B" = "$BASE_B" ] && [ "$GROUP" = "$BEST_B" ]; then
		# 当前就是最快且无同级组员：无需干预
		release_lock
		LAST_RESULT=stay-auto; LAST_CHOICE=auto
		log "scan 结论：当前 $BASE_B 已是最快，保持 auto（手机式）"
		echo "结论：当前 $BASE_B 已是实测最快，保持自动模式"
	elif [ "$BEST_B" = "$BASE_B" ] || in_group "$BASE_B" "$GROUP"; then
		# 赢家=当前（或当前已在组内）：锁组允许组内切换，比锁单频段稳
		acquire_lock "$GROUP"
		LAST_RESULT=locked-group; LAST_CHOICE="$GROUP"
		log "scan 结论：锁定频段组 [$GROUP]（含当前 $BASE_B，组内可自动切换，${LOCK_TTL}s 后自动解锁）"
		echo "结论：锁定频段组 [$GROUP]（组内可自动切换，2 小时后自动解锁）"
	elif fcmp "$BEST_P" ">=" "$(awk -v a="$BASE_P" -v m="$SWITCH_MARGIN" 'BEGIN{print a*m}')"; then
		# 换组：赢家组明显更快 => 锁组并验证
		acquire_lock "$GROUP"
		# 切换后必须验证 PDP 真正激活，失败则先恢复 APN，再不行回退 auto
		if ! wait_band "$GROUP"; then
			log "scan 切换 [$GROUP] 后 PDP 未激活，重试 APN"
			/usr/bin/apn-auto apply >/dev/null 2>&1
		fi
		if [ "$(getj | jsonfilter -e '@.cell.state' 2>/dev/null)" = "pdp_active" ]; then
			LAST_RESULT=locked-group; LAST_CHOICE="$GROUP"
			log "scan 结论：切换 $BASE_B -> [$GROUP]（$(mbps "$BEST_P")Mbps > 当前 $(mbps "$BASE_P")Mbps，${LOCK_TTL}s 后自动解锁）"
			echo "结论：切换到频段组 [$GROUP]（实测 $(mbps "$BEST_P")Mbps，快于当前 $(mbps "$BASE_P")Mbps；组内可自动切换，2 小时后自动解锁）"
		else
			release_lock
			LAST_RESULT=fallback-auto; LAST_CHOICE=auto
			log "scan 结论：[$GROUP] 激活失败，回退 auto"
			echo "结论：[$GROUP] 切换后无法联网，已回退自动模式"
		fi
	else
		# 赢家没快够 15% => 不锁，保持手机式自动
		release_lock
		LAST_RESULT=stay-auto; LAST_CHOICE=auto
		log "scan 结论：$BEST_B 略快但未达 15% 优势，保持 auto（手机式）"
		echo "结论：$BEST_B 略快但优势不足 15%，保持自动模式"
	fi

	# 5) 扫描后统一验证数据连接（逐段切换会打断 PDP，无锁定路径也必须修复）
	if [ "$(getj | jsonfilter -e '@.cell.state' 2>/dev/null)" != "pdp_active" ]; then
		log "scan 结束后 PDP 未激活，重试 APN 修复"
		/usr/bin/apn-auto apply >/dev/null 2>&1
		sleep 15
		if [ "$(getj | jsonfilter -e '@.cell.state' 2>/dev/null)" = "pdp_active" ]; then
			log "scan 结束后 APN 修复成功"
		else
			log "scan 结束后 APN 修复失败（watchdog 下轮继续自愈）"
		fi
	fi

	POOR=0   # 扫描后清零：需重新累计 POOR_NEED 次才会再扫，避免冷却一到立刻重扫
	LAST_SCAN=$NOW
	save_state
	rmdir "$LOCK" 2>/dev/null
	rm -f /tmp/band-auto.scan "$CANDS"
	trap - EXIT INT TERM
}

# ---------- 周期检查 ----------
do_run() {
	[ -f "$FLAG_ON" ] || exit 0          # 未启用（看门狗由入口处 do_watch 兜底）
	load_state
	J=$(getj)
	# 无卡 / 未注册 / 数据通道未建立时：信号值是无意义的占位值（-99/-140），
	# 不累计 POOR、不触发扫描。否则没卡期间每 5 分钟攒一次，
	# 一插卡立刻触发一轮 7~8 分钟的全频段断网扫描。
	ST=$(echo "$J" | jsonfilter -e '@.cell.state' 2>/dev/null)
	case "$ST" in
	waiting_sim|no_sim|sim_error|waiting_registration|connecting|"")
		if [ "$POOR" != "0" ]; then POOR=0; save_state; fi
		exit 0 ;;
	esac
	SN=$(echo "$J" | jsonfilter -e '@.signal.sinr' 2>/dev/null)
	RS=$(echo "$J" | jsonfilter -e '@.signal.rsrp' 2>/dev/null)
	[ -z "$SN" ] && SN=-99
	[ -z "$RS" ] && RS=-140

	# 信号好 => 清零计数直接退出
	if fcmp "$SN" ">=" "$GOOD_SINR" || fcmp "$RS" ">=" "$GOOD_RSRP"; then
		[ "$POOR" != "0" ] && { POOR=0; save_state; }
		exit 0
	fi

	POOR=$((POOR+1))
	save_state
	[ "$POOR" -lt "$POOR_NEED" ] && exit 0

	# 冷却检查（维持现状/拥塞无锁/看门狗回退后冷却更久，避免反复扫描断线）
	case "$LAST_RESULT" in
	stay|stay-auto|watchdog-revert|ttl-expire|revert-disabled|too-slow-no-lock) CD=$COOLDOWN_REVERT ;;
	*) CD=$COOLDOWN ;;
	esac
	if [ $(( $(date +%s) - LAST_SCAN )) -lt "$CD" ]; then
		exit 0
	fi

	log "run 触发扫描（SINR=$SN RSRP=$RS 连续差 $POOR 次）"
	do_scan
}

# ---------- 入口 ----------
case "$1" in
run)
	do_watch
	do_run
	;;
watch)
	do_watch
	;;
scan)
	do_watch
	do_scan
	;;
on)
	touch "$FLAG_ON"
	echo "自动选频已启用（手机式：默认自动切换，信号持续变差时才扫描；检查间隔 5 分钟）"
	log "auto band 选频 enabled"
	;;
off)
	rm -f "$FLAG_ON"
	# 停用时若存在 band-auto 上的锁，解锁回手机式自动
	if [ -f "$HOLD" ]; then
		release_lock
		echo "自动选频已停用，已解锁频段恢复自动切换（bandlock 手动锁频仍然有效）"
	else
		echo "自动选频已停用（bandlock 手动锁频仍然有效）"
	fi
	log "auto band 选频 disabled"
	;;
status)
	if [ -f "$FLAG_ON" ]; then echo "band-auto: 启用"; else echo "band-auto: 停用"; fi
	/usr/bin/bandlock status
	load_state
	echo "连续信号差次数: $POOR  | 上次扫描: $(date -d @$LAST_SCAN '+%m-%d %H:%M' 2>/dev/null || echo $LAST_SCAN)  | 上次结论: $LAST_RESULT ($LAST_CHOICE)"
	if [ -f "$HOLD" ]; then
		LEFT=$(( LOCK_TTL - ( $(date +%s) - LOCK_TIME ) ))
		[ "$LEFT" -lt 0 ] && LEFT=0
		echo "band-auto 持有锁定: $(cat "$HOLD")  剩余有效期: ${LEFT}s（到期自动解锁）"
	else
		echo "band-auto 持有锁定: 无（当前手机式自动选频）"
	fi
	[ -f "$LIST_FILE" ] && echo "候选频段: $(cat $LIST_FILE)" || echo "候选频段: $PRIMARY_DEF + $FALLBACK (默认)"
	;;
log)
	tail -n 30 "$LOG" 2>/dev/null || echo "(暂无日志)"
	;;
*)
	echo "用法: band-auto run|scan|status|on|off|log"
	exit 1
	;;
esac
