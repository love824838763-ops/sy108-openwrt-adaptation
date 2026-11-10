#!/bin/sh
# luci-write.sh — LuCI 写权限总开关
#
# v2：网页层已改为「分级保护」（luci-guard.js）：
#   - 普通设置（语言 / 主题 / LED / 状态等）静默放行，不询问
#   - 危险操作确认时弹红色窗口，并列出「不能怎么设置 / 会导致什么」
#   - 恢复出厂 / 刷机等最高危操作额外要求输入确认词
# 因此不再需要「一刀切全只读」。本脚本保留为应急总闸：
#   on     分级保护模式（默认）：网页可写，危险项有确认
#   off    应急全锁：网页完全只读（排查误改、临时交他人使用时用）
#   status 查看当前状态
#
# 实现：rpcd login ACL 的 write 列表。root 账号可写；view 账号始终只读。
# 注意：SSH 通道始终可以写，不受此开关影响。

case "$1" in
on)
	uci -q add_list rpcd.@login[0].write='*'
	uci commit rpcd
	/etc/init.d/rpcd restart >/dev/null 2>&1
	echo "LuCI：分级保护模式（网页可写；危险操作会弹红色确认并说明后果）"
	;;
off)
	uci -q del_list rpcd.@login[0].write='*'
	uci commit rpcd
	/etc/init.d/rpcd restart >/dev/null 2>&1
	echo "LuCI：应急全锁（网页只读，任何设置都保存不了）"
	;;
status)
	W=$(uci -q get rpcd.@login[0].write 2>/dev/null)
	G='未安装'
	[ -f /www/luci-static/sy108/luci-guard.js ] && G='已安装'
	if [ -n "$W" ]; then
		echo "当前状态：分级保护（网页可写，分级守卫 $G）"
	else
		echo "当前状态：应急全锁（网页只读，分级守卫 $G）"
	fi
	;;
*)
	echo "用法: $0 on|off|status"
	exit 1
	;;
esac
