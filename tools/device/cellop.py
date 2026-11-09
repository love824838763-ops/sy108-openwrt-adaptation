# -*- coding: utf-8 -*-
"""调用 udx.cellular ubus 接口并等待异步结果
用法: cellop.py <method> [json-args]
"""
import json, time, sys
from rsh import run

def call(method, args=None, quiet=False):
    cmd = "ubus call udx.cellular %s" % method
    if args is not None:
        cmd += " '%s'" % json.dumps(args)
    rc, out, err = run(cmd, 25)
    if not quiet and rc != 0:
        print('rc=%d err=%s' % (rc, err.strip()[:200]))
    try:
        return json.loads(out)
    except Exception:
        if out.strip():
            print('RAW:', out.strip()[:800])
        return None

def execute(method, args=None, timeout=150):
    r = call(method, args)
    if r is None:
        return None
    if r.get('busy'):
        time.sleep(1.0)
        return execute(method, args, timeout)
    if r.get('accepted') is not True:
        return r
    if r.get('duplicate') and r.get('state') == 'complete':
        return r.get('result')
    ref = {'id': r['operation_id'], 'boot_id': r['boot_id'], 'broker_id': r['broker_id']}
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(0.6)
        s = call('operation_status', ref, quiet=True)
        if not s:
            continue
        st = s.get('state')
        if st in ('queued', 'running'):
            continue
        if st == 'complete':
            return s.get('result')
        return s
    return {'error': 'timeout waiting for %s' % method}

if __name__ == '__main__':
    m = sys.argv[1]
    a = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
    res = execute(m, a)
    print(json.dumps(res, indent=1, ensure_ascii=False))
