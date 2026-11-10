#!/bin/sh
# install-web-ui.sh — 在设备上一键部署「统一 UI + 分级守卫 + 系统信息」
#
# 用法：把 tools/device/ 整个目录传到设备 /tmp/sy108-ui/ 后执行：
#   sh /tmp/sy108-ui/install-web-ui.sh
#
# 本脚本幂等：重复执行不会重复注入、不会重复写 cron。
# 所有被覆盖的原件先备份到 /root/ui-backup-<日期>/，可随时回滚。
# 不会重启网络、不会动 APN / 频段 / 射频参数。

set -u
SRC=${1:-$(dirname "$0")}
DAY=$(date +%Y%m%d)
BK=/root/ui-backup-$DAY
[ -f /root/ui-backup-20261110/udx-signal.html ] && BK=/root/ui-backup-20261110
mkdir -p "$BK" /www/luci-static/sy108

echo "== 1/7 备份原件 =="
for f in /www/index.html /www/portal/index.html /www/cgi-bin/sy108status \
         /usr/share/ucode/luci/template/themes/outline/footer.ut \
         /usr/share/ucode/luci/template/themes/aurora/footer.ut \
         /www/luci-static/udx/signal.html /etc/config/rpcd /etc/crontabs/root; do
	[ -f "$f" ] || continue
	B=$(echo "$f" | tr '/' '_')
	[ -f "$BK/$B" ] || cp "$f" "$BK/$B"
done
echo "   备份目录: $BK"

echo "== 2/7 状态页 / 断网页 / CGI =="
[ -f "$SRC/index.html" ]        && cp "$SRC/index.html"        /www/index.html              && chmod 644 /www/index.html
[ -f "$SRC/portal.html" ]       && cp "$SRC/portal.html"       /www/portal/index.html      && chmod 644 /www/portal/index.html
[ -f "$SRC/sy108status.cgi" ]   && cp "$SRC/sy108status.cgi"   /www/cgi-bin/sy108status    && chmod 755 /www/cgi-bin/sy108status
sh -n /www/cgi-bin/sy108status || { echo "!! CGI 语法错误，已中止"; exit 1; }

echo "== 3/7 上游信号看板外挂（原文件只加两行引用） =="
[ -f "$SRC/udx-signal-polish.css" ] && cp "$SRC/udx-signal-polish.css" /www/luci-static/udx/ && chmod 644 /www/luci-static/udx/udx-signal-polish.css
[ -f "$SRC/udx-signal-polish.js" ]  && cp "$SRC/udx-signal-polish.js"  /www/luci-static/udx/ && chmod 644 /www/luci-static/udx/udx-signal-polish.js
F=/www/luci-static/udx/signal.html
if [ -f "$F" ] && ! grep -q 'udx-signal-polish' "$F"; then
	sed -i 's#</head>#<link rel="stylesheet" href="/luci-static/udx/udx-signal-polish.css"><script defer src="/luci-static/udx/udx-signal-polish.js"></script></head>#' "$F"
	echo "   已挂接 signal.html"
else
	echo "   已挂接（跳过）"
fi

echo "== 4/7 LuCI 分级守卫 =="
[ -f "$SRC/luci-guard.js" ] && cp "$SRC/luci-guard.js" /www/luci-static/sy108/luci-guard.js && chmod 644 /www/luci-static/sy108/luci-guard.js
for T in /usr/share/ucode/luci/template/themes/outline/footer.ut \
         /usr/share/ucode/luci/template/themes/aurora/footer.ut; do
	[ -f "$T" ] || continue
	if grep -q 'luci-guard.js' "$T"; then
		echo "   $(basename $(dirname "$T")) 已注入（跳过）"
	else
		sed -i 's#</body>#<script defer src="/luci-static/sy108/luci-guard.js"></script></body>#' "$T"
		echo "   $(basename $(dirname "$T")) 已注入"
	fi
done

echo "== 5/7 解除 rpcd 全锁（改为分级保护） =="
[ -f "$SRC/luci-write.sh" ] && cp "$SRC/luci-write.sh" /usr/bin/luci-write && chmod 755 /usr/bin/luci-write
uci -q del_list rpcd.@login[0].write='*'
uci -q add_list rpcd.@login[0].write='*'
uci commit rpcd
/etc/init.d/rpcd restart >/dev/null 2>&1
echo "   root 可写；view 账号仍只读；危险操作由 luci-guard.js 拦截"

echo "== 6/7 累计运行时间采样（cron 每 5 分钟） =="
[ -f "$SRC/runtime-tick.sh" ] && cp "$SRC/runtime-tick.sh" /usr/bin/runtime-tick && chmod 755 /usr/bin/runtime-tick
sh -n /usr/bin/runtime-tick || { echo "!! runtime-tick 语法错误，已中止"; exit 1; }
touch /etc/crontabs/root
grep -q 'usr/bin/runtime-tick' /etc/crontabs/root || echo '*/5 * * * * /usr/bin/runtime-tick' >> /etc/crontabs/root
/etc/init.d/cron restart >/dev/null 2>&1
/usr/bin/runtime-tick
echo "   采样器已启动；统计起点写入 /root/runtime.state"

echo "== 7/7 校验 =="
printf '   index.html      : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
printf '   portal(:88)     : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:88/
printf '   sy108status     : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/cgi-bin/sy108status
printf '   signal dashboard: '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/luci-static/udx/signal.html
printf '   luci-guard.js   : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/luci-static/sy108/luci-guard.js
printf '   LuCI login      : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/cgi-bin/luci/
echo "   system 字段："
curl -s --max-time 30 http://127.0.0.1/cgi-bin/sy108status | jsonfilter -e '@.system' 2>/dev/null | head -c 400
echo ""
echo "DONE. 恢复出厂入口：LuCI → System → System maintenance（需登录，会弹红色确认）。"
