#!/bin/sh
# 第一步：仅添加 view 只读账户，不动 root
set -e

cp -f /etc/config/rpcd /etc/config/rpcd.step1bak
echo "=== 备份: /etc/config/rpcd.step1bak ==="

if uci show rpcd 2>/dev/null | grep -q "username='view'"; then
	echo "view 账户已存在，跳过"
else
	uci add rpcd login >/dev/null
	uci set rpcd.@login[-1].username='view'
	uci set rpcd.@login[-1].password='$p$view'
	uci add_list rpcd.@login[-1].read='*'
	echo "view 账户已加入"
fi

uci commit rpcd
echo "=== 配置 ==="
uci show rpcd

/etc/init.d/rpcd restart >/dev/null 2>&1
sleep 2
echo "=== rpcd 已重启 ==="
