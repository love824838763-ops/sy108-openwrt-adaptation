#!/bin/sh
# portal-watch - 蜂窝断网时开启 captive portal，恢复后关闭
# 断网 >= 15 秒才激活（避免 5 秒自愈重拨造成抖动）
# 注意：不要用 stop udx-cellular 制造断网，会触发 PMIC 看门狗硬重启
STATE=/run/portal.active
FORCE=/run/portal.force
DOWN=0
UP=0

log() { logger -t portal-watch "$*" 2>/dev/null; }

while :; do
	# 强制锁定模式下不自动切换（供测试）
	if [ -f "$FORCE" ]; then
		sleep 5
		continue
	fi

	if ubus call network.interface.wan status 2>/dev/null | grep -q '"up": *true'; then
		UP=$((UP + 1))
		DOWN=0
	else
		DOWN=$((DOWN + 1))
		UP=0
	fi

	# band-auto 扫描期间 WAN 反复断开是预期行为，不弹 captive portal
	# （否则扫描中的浏览器会被劫持到提示页，看起来像"网站进不去"）
	if [ -f /tmp/band-auto.scan ]; then
		if [ -f "$STATE" ]; then
			log "band-auto scan in progress -> portal OFF (no hijack)"
			/usr/bin/portal-ctl off
		fi
		DOWN=0
		sleep 5
		continue
	fi

	if [ $DOWN -ge 3 ] && [ ! -f "$STATE" ]; then
		log "WAN down -> portal ON"
		/usr/bin/portal-ctl on
		DOWN=0
	elif [ $UP -ge 2 ] && [ -f "$STATE" ]; then
		log "WAN up -> portal OFF"
		/usr/bin/portal-ctl off
		UP=0
	fi

	sleep 5
done
