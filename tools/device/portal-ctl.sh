#!/bin/sh
# portal-ctl - captive portal 开关
#   on       开启（DNS 劫持 + HTTP 全量重定向到 portal 页）
#   off      关闭
#   status   查看状态
#   force    锁定当前状态，守护进程不再自动切换（测试用）
#   unforce  解除锁定
IP=192.168.66.99
CONF=/tmp/dnsmasq.cfg01411c.d/portal.conf
STATE=/run/portal.active
FORCE=/run/portal.force

init_net() {
	ip addr add $IP/32 dev br-usb 2>/dev/null
	# DNAT 到 loopback 需要放开 route_localnet
	for f in /proc/sys/net/ipv4/conf/all/route_localnet \
	         /proc/sys/net/ipv4/conf/br-usb/route_localnet \
	         /proc/sys/net/ipv4/conf/uncm0/route_localnet; do
		[ -w "$f" ] && echo 1 > "$f" 2>/dev/null
	done
	nft add table inet portal 2>/dev/null
	nft add chain inet portal dstnat '{ type nat hook prerouting priority dstnat - 10; policy accept; }' 2>/dev/null
	nft add chain inet portal out '{ type nat hook output priority dstnat - 20; policy accept; }' 2>/dev/null
}

rule_count() {
	nft list table inet portal 2>/dev/null | grep -c 'dnat ip to'
}

clear_rules() {
	for H in $(nft -a list chain inet portal dstnat 2>/dev/null | sed -n 's/.*# handle \([0-9]*\)/\1/p'); do
		nft delete rule inet portal dstnat handle "$H" 2>/dev/null
	done
	for H in $(nft -a list chain inet portal out 2>/dev/null | sed -n 's/.*# handle \([0-9]*\)/\1/p'); do
		nft delete rule inet portal out handle "$H" 2>/dev/null
	done
}

portal_on() {
	init_net
	mkdir -p /tmp/dnsmasq.cfg01411c.d
	printf 'address=/#/%s\nlocal-ttl=10\n' "$IP" > "$CONF"

	clear_rules
	nft add rule inet portal dstnat ip daddr $IP tcp dport 80 dnat ip to 127.0.0.1:88
	nft add rule inet portal out oifname 'uncm0' tcp dport 80 dnat ip to 127.0.0.1:88
	nft add rule inet portal out oifname 'br-usb' tcp dport 80 dnat ip to 127.0.0.1:88

	/etc/init.d/dnsmasq restart
	touch "$STATE"
	echo "portal ON ($(rule_count) rules)"
}

portal_off() {
	rm -f "$CONF"
	clear_rules
	/etc/init.d/dnsmasq restart
	rm -f "$STATE"
	echo "portal OFF"
}

case "$1" in
on) portal_on ;;
off) portal_off ;;
force) touch "$FORCE"; echo "portal locked" ;;
unforce) rm -f "$FORCE"; echo "portal unlocked" ;;
status)
	if [ -f "$STATE" ]; then echo "portal: ON"; else echo "portal: OFF"; fi
	if [ -f "$FORCE" ]; then echo "locked: yes"; else echo "locked: no"; fi
	echo "rules: $(rule_count)"
	echo "conf: $([ -f "$CONF" ] && echo present || echo absent)"
	;;
*) echo "usage: portal-ctl on|off|force|unforce|status" ;;
esac
