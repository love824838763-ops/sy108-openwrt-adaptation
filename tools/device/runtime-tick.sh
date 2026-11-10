#!/bin/sh
# runtime-tick — 累计通电运行时间采样器（跨重启累加）
#
# 由 cron 每 5 分钟调用一次；也可手动执行。
# 状态文件 /root/runtime.state 位于 overlay，恢复出厂后会被清空并重新起算。
#
# 原理：/proc/uptime 在每次开机时从 0 重新计数。若本次采样的 uptime 小于
# 上次记录的 uptime，说明期间发生过重启，就把「上一段的最后一次采样值」
# 累加进 TOTAL。误差上限为一个采样周期（默认 5 分钟）。
#
# 配套：/www/cgi-bin/sy108status 读取本文件，输出 runtime_total_sec 等字段。

# 变量名必须与 /www/cgi-bin/sy108status 读取的一致（R 前缀），
# 否则累计值会永远只剩「本次开机时长」。
STATE=/root/runtime.state
TMP=/root/runtime.state.tmp

NOW=$(date +%s)
UP=$(cut -d. -f1 /proc/uptime)

RTOTAL=0; RLAST_UP=0; RSINCE=$NOW; RSAMPLES=0; RLAST_TS=0
[ -f "$STATE" ] && . "$STATE"

for v in RTOTAL RLAST_UP RSINCE RSAMPLES RLAST_TS; do
	eval "x=\$$v"
	case "$x" in ''|*[!0-9]*) eval "$v=0" ;; esac
done
[ "$RSINCE" -eq 0 ] && RSINCE=$NOW

if [ "$RLAST_UP" -gt "$UP" ]; then
	RTOTAL=$((RTOTAL + RLAST_UP))
fi
RSAMPLES=$((RSAMPLES + 1))

echo "RTOTAL=$RTOTAL RLAST_UP=$UP RSINCE=$RSINCE RSAMPLES=$RSAMPLES RLAST_TS=$NOW" > "$TMP" 2>/dev/null \
	&& mv "$TMP" "$STATE" 2>/dev/null

exit 0
