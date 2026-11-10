#!/bin/sh
# bandlock - 5G 频段锁定辅助
# 用法: bandlock n79          锁定 NR n79（单频段）
#       bandlock g=n78,n79    锁定 NR 频段组（组内可自动切换，接近手机行为）
#       bandlock auto         恢复全频段自动选频（默认，手机模式）
#       bandlock status       查看当前设置
# 说明: udx.band_lock 不进 uci，重启失效；/etc/bandlock.mode 标记由 rc.local 开机恢复。
#       锁频瞬间可能断线 5-10 秒。日常建议保持 auto（手机式自动选频）。

FLAG=/etc/bandlock.mode

case "$1" in
status)
	if [ -f "$FLAG" ]; then
		echo "bandlock mode: $(cat "$FLAG")"
	else
		echo "bandlock mode: auto (default)"
	fi
	ubus call udx.cellular status 2>/dev/null | jsonfilter -e '@.band_lock' 2>/dev/null || true
	;;
auto)
	rm -f "$FLAG"
	ubus call udx.cellular unlock '{"scope":"bands"}' >/dev/null 2>&1
	rc=$?
	echo "auto (unlock) applied rc=$rc"
	;;
g=*)
	list="${1#g=}"
	json=$(echo "$list" | sed 's/,/","/g; s/^/"/; s/$/"/')
	echo "$1" > "$FLAG"
	ubus call udx.cellular band_lock "{\"lte\":[],\"nr\":[$json]}" >/dev/null 2>&1
	rc=$?
	echo "locked to NR group [$list] rc=$rc（组内可自动切换；断线属正常，自动重拨约 5-10 秒）"
	;;
n79|n78|n41|n28|n1|n3)
	echo "$1" > "$FLAG"
	ubus call udx.cellular band_lock "{\"lte\":[],\"nr\":[\"$1\"]}" >/dev/null 2>&1
	rc=$?
	echo "locked to NR $1 rc=$rc（断线属正常，自动重拨约 5-10 秒）"
	;;
*)
	echo "用法: bandlock n79|n78|n41|n28|n1|n3|g=n78,n79|auto|status"
	exit 1
	;;
esac
