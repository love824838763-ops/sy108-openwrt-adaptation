#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过 SSH stdin 直接写文件（无需 base64） 用法: rput.py <local> <remote> [mode]"""
import sys, paramiko
from rsh import connect, PASSWORDS

def put(local, remote, mode='644'):
    data = open(local, 'rb').read()
    for pw in PASSWORDS:
        try:
            c = connect(pw)
            break
        except paramiko.AuthenticationException:
            continue
        except Exception as e:
            raise SystemExit('connect error %r' % (e,))
    else:
        raise SystemExit('no password worked')
    try:
        stdin, stdout, stderr = c.exec_command('cat > %s' % remote, timeout=600)
        stdin.write(data)
        stdin.flush()
        stdin.channel.shutdown_write()
        rc = stdout.channel.recv_exit_status()
        err = stderr.read().decode('utf-8', 'replace')
        if err.strip():
            print('STDERR:', err.strip())
        if rc == 0:
            _, o2, _ = c.exec_command('chmod %s %s && wc -c < %s' % (mode, remote, remote), timeout=20)
            print('WRITTEN %s size=%s' % (remote, o2.read().decode().strip()))
        else:
            print('write failed rc=%d' % rc)
        return rc
    finally:
        c.close()

if __name__ == '__main__':
    put(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '644')
