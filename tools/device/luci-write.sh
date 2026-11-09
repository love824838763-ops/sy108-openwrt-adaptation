#!/bin/sh
# luci-write.sh — 临时开关 LuCI 网页的写权限
#   luci-write.sh on    解锁：网页可以保存修改
#   luci-write.sh off   锁定：网页只读（默认状态）
#   luci-write.sh status 查看当前状态
# 注意：SSH 通道始终可以写，不受此开关影响。

case "$1" in
on)
	uci -q add_list rpcd.@login[0].write='*'
	uci commit rpcd
	/etc/init.d/rpcd restart >/dev/null 2>&1
	echo "LuCI 已解锁：现在网页可以保存配置了。用完记得执行 $0 off"
	;;
off)
	uci -q del_list rpcd.@login[0].write='*'
	uci commit rpcd
	/etc/init.d/rpcd restart >/dev/null 2>&1
	echo "LuCI 已锁定：网页只读，无法保存任何配置"
	;;
status)
	W=$(uci -q get rpcd.@login[0].write 2>/dev/null)
	if [ -n "$W" ]; then
		echo "当前状态：解锁（网页可写）"
	else
		echo "当前状态：锁定（网页只读）"
	fi
	;;
*)
	echo "用法: $0 on|off|status"
	exit 1
	;;
esac
