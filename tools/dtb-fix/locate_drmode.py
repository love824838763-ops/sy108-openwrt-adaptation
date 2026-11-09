# -*- coding: utf-8 -*-
"""在 DTB struct 块中精确定位某节点的某属性，并做等长或变长替换"""
import os, struct, zlib

DTB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main.dtb'), 'rb').read()
(magic, totalsize, off_struct, off_strings, off_rsv,
 version, lastcomp, cpuid, size_strings, size_struct) = struct.unpack('>10I', DTB[:40])
assert magic == 0xd00dfeed
strings = DTB[off_strings:off_strings + size_strings]
print('totalsize=%d off_struct=%#x size_struct=%d off_strings=%#x size_strings=%d'
      % (totalsize, off_struct, size_struct, off_strings, size_strings))

def align4(x):
    return (x + 3) & ~3

def walk():
    """返回 [(kind, ...)] 扁平事件序列"""
    p = off_struct
    end = off_struct + size_struct
    stack = []
    out = []
    while p < end:
        tok = struct.unpack('>I', DTB[p:p+4])[0]
        if tok == 1:
            e = DTB.index(b'\x00', p + 4)
            name = DTB[p+4:e].decode()
            out.append(('NODE', p, '/'.join(stack + [name]) if name else '/'.join(stack) or '/'))
            stack.append(name)
            p = align4(e + 1)
        elif tok == 2:
            if stack: stack.pop()
            p += 4
        elif tok == 3:
            ln, nameoff = struct.unpack('>II', DTB[p+4:p+12])
            e = strings.index(b'\x00', nameoff)
            pname = strings[nameoff:e].decode()
            val = DTB[p+12:p+12+ln]
            out.append(('PROP', p, '/'.join(stack), pname, ln, nameoff, val))
            p = align4(p + 12 + ln)
        elif tok == 4:
            p += 4
        elif tok == 9:
            break
        else:
            raise SystemExit('bad token %d at %#x' % (tok, p))
    return out

ev = walk()
target_node = '/soc/ipa-bus/usb3@29100000/usb@29100000'
for e in ev:
    if e[0] == 'PROP' and e[2] == target_node and e[3] == 'dr_mode':
        _, p, node, pname, ln, nameoff, val = e
        print('FOUND dr_mode at abs %#x  rel=%#x  len=%d nameoff=%#x val=%r'
              % (p, p - off_struct, ln, nameoff, val))
        break
else:
    raise SystemExit('dr_mode not found')
