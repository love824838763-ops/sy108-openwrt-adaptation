# -*- coding: utf-8 -*-
"""从设备下载文件（二进制安全） 用法: rget.py <remote> <local>"""
import sys, os, paramiko
from rsh import connect, PASSWORDS

def get(remote, local):
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
        chan = c.get_transport().open_session()
        chan.exec_command('cat %s' % remote)
        buf = bytearray()
        while True:
            d = chan.recv(65536)
            if not d:
                break
            buf += d
        rc = chan.recv_exit_status()
    finally:
        c.close()
    with open(local, 'wb') as f:
        f.write(buf)
    print('GOT %s -> %s  %d bytes  rc=%d' % (remote, local, len(buf), rc))
    return len(buf)

if __name__ == '__main__':
    get(sys.argv[1], sys.argv[2])
