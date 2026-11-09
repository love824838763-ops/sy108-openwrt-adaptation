#!/bin/sh
# wanhealth - read-only cellular WAN health probe for USB host auto-failover
# Returns {"wan":1,"ip":"..."} when cellular session is up, {"wan":0} otherwise.
# No auth needed: only reachable from br-usb (LAN), wan zone input is REJECT.

echo "Content-Type: application/json"
echo "Cache-Control: no-store"
echo ""

ST="$(ubus call network.interface.wan status 2>/dev/null)"

case "$ST" in
	*'"up": true'*)
		IP="$(echo "$ST" | sed -n 's/.*"address": "\([0-9.]*\)".*/\1/p' | head -1)"
		echo "{\"wan\":1,\"ip\":\"$IP\"}"
		;;
	*)
		echo '{"wan":0}'
		;;
esac
