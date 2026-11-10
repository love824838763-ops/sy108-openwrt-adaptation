#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FDT 解析器（修正版）：正确按 4 字节对齐处理 BEGIN_NODE / PROP。"""
import struct, sys

def align4(x):
    return (x + 3) & ~3

def parse(path):
    data = open(path, 'rb').read()
    magic, totalsize, off_struct, off_strings, off_rsv, version, lastcomp, cpuid, size_strings, size_struct = \
        struct.unpack('>10I', data[:40])
    assert magic == 0xd00dfeed, 'bad magic %08x' % magic
    strings = data[off_strings:off_strings + size_strings]
    p = off_struct
    end = off_struct + size_struct
    nodes = []          # list of dict(path, props(list of (name,val)))
    stack = []          # node names
    cur = None
    while p < end:
        tok = struct.unpack('>I', data[p:p+4])[0]
        p += 4
        if tok == 1:    # BEGIN_NODE
            e = data.index(b'\x00', p)
            name = data[p:e].decode('utf-8', 'replace')
            p = align4(e + 1)
            stack.append(name)
            cur = {'path': '/' + '/'.join([s for s in stack if s]), 'props': []}
            nodes.append(cur)
        elif tok == 2:  # END_NODE
            if stack:
                stack.pop()
            cur = None
        elif tok == 3:  # PROP
            ln, nameoff = struct.unpack('>II', data[p:p+8])
            p += 8
            val = data[p:p+ln]
            p = align4(p + ln)
            e = strings.index(b'\x00', nameoff)
            pname = strings[nameoff:e].decode('utf-8', 'replace')
            if cur is None:
                cur = {'path': '/', 'props': []}
                nodes.append(cur)
            cur['props'].append((pname, val))
        elif tok == 4:  # NOP
            pass
        elif tok == 9:  # END
            break
        else:
            raise SystemExit('unknown token %d at %#x' % (tok, p - 4))
    return nodes

def fmt_val(v):
    if len(v) == 0:
        return '<empty>'
    if v.endswith(b'\x00') and all(32 <= c < 127 or c in (9, 10) for c in v[:-1]):
        return '"%s"' % v[:-1].decode('utf-8', 'replace')
    if len(v) % 4 == 0:
        cells = struct.unpack('>%dI' % (len(v) // 4), v)
        if len(cells) == 1:
            return '<%#x>' % cells[0]
        return '<' + ' '.join('%#x' % c for c in cells) + '>'
    return v.hex()

if __name__ == '__main__':
    path = sys.argv[1]
    pat = sys.argv[2] if len(sys.argv) > 2 else None
    nodes = parse(path)
    print('##### %s : %d nodes #####' % (path, len(nodes)))
    for n in nodes:
        if pat and pat not in n['path']:
            continue
        print('NODE %s' % n['path'])
        for k, v in n['props']:
            print('    %-24s = %s' % (k, fmt_val(v)))
