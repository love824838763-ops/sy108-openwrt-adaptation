# -*- coding: utf-8 -*-
"""通过 paramiko 对设备执行 shell 命令（自动试多个密码）
用法: rsh.py "command" [--timeout N]
"""
import sys, paramiko, socket

HOST = '192.168.66.1'
USER = 'root'
PASSWORDS = ['admin', 'root', '', 'password', 'openwrt', 'sy108']

def connect(pw, timeout=8):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, password=pw, timeout=timeout,
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
