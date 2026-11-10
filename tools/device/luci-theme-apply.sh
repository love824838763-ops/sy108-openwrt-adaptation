#!/bin/sh
# luci-theme-apply.sh — 给 LuCI(Outline 主题) 套上 SY108 品牌样式与图标
#
# 用法：把 tools/device/ 整个目录传到设备 /tmp/sy108-ui/ 后执行：
#   sh /tmp/sy108-ui/luci-theme-apply.sh
#
# 做的事只有两件，都是可完全回滚的静态资源替换：
#   1) 把 luci-brand.css 追加到 login.css / main.css 末尾（先截断旧覆盖块，幂等）
#   2) 用 assets/logo-256.png、logo.svg 替换主题的 logo.png / favicon.svg
# 不碰任何模板(.ut)、不碰 ACL、不重启服务。

set -u
SRC=${1:-$(dirname "$0")}
DAY=$(date +%Y%m%d)
BK=/root/ui-backup-$DAY/luci
THEME=/www/luci-static/outline

[ -d "$THEME" ] || { echo "找不到 $THEME，主题可能不是 outline"; exit 1; }
mkdir -p "$BK"

echo "== 1/3 备份 =="
for f in "$THEME/login.css" "$THEME/main.css" "$THEME/images/logo.png" "$THEME/images/favicon.svg"; do
	[ -f "$f" ] || continue
	b=$(basename "$f")
	[ -f "$BK/$b" ] || cp "$f" "$BK/$b"
done
echo "   备份目录: $BK"

echo "== 2/3 追加品牌样式 =="
[ -f "$SRC/luci-brand.css" ] || { echo "缺少 $SRC/luci-brand.css"; exit 1; }
for f in login.css main.css; do
	[ -f "$THEME/$f" ] || continue
	# 从标记行起整段丢弃，再追加最新版本 —— 重复执行不会叠加
	awk '/SY108 UI consistency overlay/{exit} {print}' "$THEME/$f" > /tmp/sy108-$f
	cat "$SRC/luci-brand.css" >> /tmp/sy108-$f
	cp /tmp/sy108-$f "$THEME/$f"
	rm -f /tmp/sy108-$f
	echo "   $f 已更新 ($(wc -c < "$THEME/$f") 字节)"
done

echo "== 3/3 替换图标 =="
[ -f "$SRC/assets/logo-256.png" ] && cp "$SRC/assets/logo-256.png" "$THEME/images/logo.png" && echo "   logo.png 已替换"
[ -f "$SRC/assets/logo.svg" ] && cp "$SRC/assets/logo.svg" "$THEME/images/favicon.svg" && echo "   favicon.svg 已替换"

echo
echo "== 自检 =="
printf '   品牌样式标记: '; grep -c 'SY108 UI consistency overlay' "$THEME/main.css"
printf '   静态样式 HTTP: '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/luci-static/outline/main.css
printf '   图标 HTTP   : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/luci-static/outline/images/logo.png
printf '   logo 大小   : '; wc -c < "$THEME/images/logo.png"
echo
echo "回滚：cp $BK/* $THEME/ 并把两张图放回 $THEME/images/"
