#!/bin/sh
# captive portal 探测重定向：Windows NCSI 探测到此会收到 302
# → Windows 判定为 captive portal → 自动弹出浏览器到状态页
printf 'Status: 302 Found\r\n'
printf 'Location: http://192.168.66.1/\r\n'
printf 'Content-Length: 0\r\n'
printf 'Connection: close\r\n\r\n'
