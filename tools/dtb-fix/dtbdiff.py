#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对比两份 DTB 的节点与属性差异"""
import os, sys
from fdt2 import parse, fmt_val

a = parse(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main.dtb'))
b = parse(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recovery.dtb'))

def index(nodes):
    d = {}
    for n in nodes:
        d[n['path']] = dict(n['props'])
    return d

A, B = index(a), index(b)
onlyA = sorted(set(A) - set(B))
onlyB = sorted(set(B) - set(A))
print('=== 只在 main.dtb 的节点 (%d) ===' % len(onlyA))
for p in onlyA:
    print('  +', p)
print('=== 只在 recovery.dtb 的节点 (%d) ===' % len(onlyB))
for p in onlyB:
    print('  -', p)

print()
print('=== 同名节点的属性差异 ===')
for p in sorted(set(A) & set(B)):
    pa, pb = A[p], B[p]
    ka, kb = set(pa), set(pb)
    lines = []
    for k in sorted(ka - kb):
        lines.append('    main 独有  %-26s = %s' % (k, fmt_val(pa[k])))
    for k in sorted(kb - ka):
        lines.append('    rec  独有  %-26s = %s' % (k, fmt_val(pb[k])))
    for k in sorted(ka & kb):
        if pa[k] != pb[k]:
            lines.append('    值不同      %-26s main=%s | rec=%s' % (k, fmt_val(pa[k]), fmt_val(pb[k])))
    if lines:
        print('NODE %s' % p)
        print('\n'.join(lines))
