#!/bin/sh
# portal 入口：处理所有请求
#  - /connecttest.txt 等 NCSI 探测路径 -> 302 跳转到状态页（触发 Windows 弹窗）
#  - 其他路径 -> 返回状态页

case "$REQUEST_URI" in
	*connecttest*|*ncsi*|*msft*|*captive*|*generate_204*|*gen_204*)
		printf 'Status: 302 Found\r\n'
		printf 'Location: http://192.168.66.1/\r\n'
		printf 'Content-Length: 0\r\n'
		printf 'Connection: close\r\n\r\n'
		exit 0
		;;
esac

# 其余路径直接吐出状态页
exec /www/portal/index.html 2>/dev/null || {
	printf 'Content-Type: text/html; charset=utf-8\r\n\r\n'
	printf '<html><body><h1>5G 通信壳</h1><p>网络已断开，状态页请访问 http://192.168.66.1/</p></body></html>\n'
}
