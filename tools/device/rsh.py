#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过 paramiko 对设备执行 shell 命令

用法:  rsh.py "command" [--timeout=N]

连接参数（环境变量优先，未设置时用下面的默认值）:
  SY108_HOST  设备地址，默认 192.168.66.1（USB 网卡侧固定地址）
  SY108_PORT  SSH 端口，默认 22（部分固件 dropbear 改过端口）
  SY108_USER  用户名，默认 root
  SY108_PASS  密码；设置后只试这一个。不设置则依次试固件常见默认密码。

示例:
  SY108_PASS=admin python rsh.py "ubus call udx.cellular status"
"""
import os, sys, paramiko, socket

HOST = os.environ.get('SY108_HOST') or '192.168.66.1'
PORT = int(os.environ.get('SY108_PORT') or 22)
USER = os.environ.get('SY108_USER') or 'root'

# 上游固件常见的出厂密码，按可能性排序。设了 SY108_PASS 就只用它。
_DEFAULTS = ['admin', 'root', '', 'password', 'openwrt', 'sy108']
PASSWORDS = [os.environ['SY108_PASS']] if os.environ.get('SY108_PASS') else _DEFAULTS

def connect(pw, timeout=8):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=pw, timeout=timeout,
              look_for_keys=False, allow_agent=False,
              banner_timeout=timeout, auth_timeout=timeout)
    return c

def run(cmd, timeout=30):
    last = None
    for pw in PASSWORDS:
        try:
            c = connect(pw)
        except paramiko.AuthenticationException as e:
            last = 'auth fail pw=%r' % pw
            continue
        except Exception as e:
            return 99, '', 'connect error: %r' % (e,)
        try:
            stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode('utf-8', 'replace')
            err = stderr.read().decode('utf-8', 'replace')
            rc = stdout.channel.recv_exit_status()
            return rc, out, err
        finally:
            c.close()
    return 98, '', last or 'no password worked'

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    tmo = 30
    for a in sys.argv[1:]:
        if a.startswith('--timeout'):
            tmo = int(a.split('=')[1]) if '=' in a else 60
    cmd = args[0] if args else 'echo hello'
    rc, out, err = run(cmd, tmo)
    sys.stdout.write(out)
    if err:
        sys.stderr.write(err)
    print('[rc=%d]' % rc)
