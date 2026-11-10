#!/bin/sh
# 创建 LuCI 只读账户 view / admin（密码与 root 相同）
set -e

echo "=== 1. 备份 ==="
cp -f /etc/passwd /etc/passwd.pre-view
cp -f /etc/shadow /etc/shadow.pre-view
ls -l /etc/passwd /etc/shadow
echo "backup ok"

echo "=== 2. 追加 passwd 条目 ==="
if grep -q '^view:' /etc/passwd; then
	echo "passwd: already exists"
else
	echo 'view:x:1000:0:LuCI-ReadOnly:/var:/bin/false' >> /etc/passwd
	echo "passwd: added"
fi

echo "=== 3. 追加 shadow 条目（复用 root 的 hash）==="
ROOTHASH=$(grep '^root:' /etc/shadow | cut -d: -f2)
if grep -q '^view:' /etc/shadow; then
	echo "shadow: already exists"
else
	printf 'view:%s:19000:0:99999:7:::\n' "$ROOTHASH" >> /etc/shadow
	echo "shadow: added"
fi

echo "=== 4. 校验 ==="
grep '^view:' /etc/passwd
grep '^view:' /etc/shadow | cut -c1-30
