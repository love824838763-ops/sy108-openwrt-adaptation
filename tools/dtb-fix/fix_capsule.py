#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复 main.dtb 的 USB 节点：dr_mode otg->peripheral，删除 role-switch 相关属性，
   然后回填进 main_kernel.bin 的 capsule，重算 dtb_crc / header_crc / dtb_size。
"""
import struct, zlib, os

ROOT = os.path.dirname(os.path.abspath(__file__))
DTB_IN = os.path.join(ROOT, 'main.dtb')
KERN_IN = os.path.join(ROOT, 'main_kernel.bin')
DTB_OUT = os.path.join(ROOT, 'main_fixed.dtb')
KERN_OUT = os.path.join(ROOT, 'main_kernel_fixed.bin')

DTB_OFF_IN_KERNEL = 0x6CD200
KERNEL_TOTAL = 7191040
CAP_BASE = 0xA00
CAP_HDR = CAP_BASE + 0x80

dtb = bytearray(open(DTB_IN, 'rb').read())
(magic, totalsize, off_struct, off_strings, off_rsv,
 version, lastcomp, cpuid, size_strings, size_struct) = struct.unpack('>10I', dtb[:40])
assert magic == 0xd00dfeed and totalsize == len(dtb)
strings = bytes(dtb[off_strings:off_strings + size_strings])

def align4(x):
    return (x + 3) & ~3

# 扫描 struct 块，收集目标节点下需要处理的属性
target = '/soc/ipa-bus/usb3@29100000/usb@29100000'
DROP = {'usb-role-switch', 'role-switch-default-mode', 'sprd,pamu3-offload'}
p = off_struct
end = off_struct + size_struct
stack = []
todo_nop = []      # (abs_off, block_len)
dr_mode_hit = None
while p < end:
    tok = struct.unpack('>I', dtb[p:p+4])[0]
    if tok == 1:
        e = dtb.index(b'\x00', p + 4)
        name = bytes(dtb[p+4:e]).decode()
        stack.append(name)
        p = align4(e + 1)
    elif tok == 2:
        if stack: stack.pop()
        p += 4
    elif tok == 3:
        ln, nameoff = struct.unpack('>II', dtb[p+4:p+12])
        e = strings.index(b'\x00', nameoff)
        pname = strings[nameoff:e].decode()
        block_len = align4(12 + ln)
        cur = '/'.join(stack)
        if cur == target and pname in DROP:
            todo_nop.append((p, block_len, pname))
        if cur == target and pname == 'dr_mode':
            dr_mode_hit = (p, ln, nameoff, bytes(dtb[p+12:p+12+ln]))
        p = align4(p + 12 + ln)
    elif tok == 4:
        p += 4
    elif tok == 9:
        break
    else:
        raise SystemExit('bad token %d @%#x' % (tok, p))

print('dr_mode:', dr_mode_hit)
print('to NOP:', [(hex(o), l, n) for o, l, n in todo_nop])
assert dr_mode_hit and dr_mode_hit[3] == b'otg\x00'

# 1) 等长替换为 FDT_NOP（token=4），不影响任何偏移
for off, blen, name in todo_nop:
    assert blen % 4 == 0
    dtb[off:off+blen] = b'\x00\x00\x00\x04' * (blen // 4)
print('NOP applied: %d props' % len(todo_nop))

# 2) dr_mode 变长替换
doff, dlen, dnameoff, dval = dr_mode_hit
newval = b'peripheral\x00'          # 11 bytes
newval_padded = newval + b'\x00' * (align4(len(newval)) - len(newval))
new_prop = struct.pack('>III', 3, len(newval), dnameoff) + newval_padded
old_block = align4(12 + dlen)
assert old_block == 16, old_block
dtb[doff:doff+old_block] = new_prop
delta = align4(12 + len(newval)) - old_block
print('dr_mode %r -> %r  delta=%d' % (dval, newval, delta))

# 3) 更新 FDT header
new_total = len(dtb)
struct.pack_into('>I', dtb, 4, new_total)                       # totalsize
struct.pack_into('>I', dtb, 12, off_strings + delta)            # off_dt_strings
struct.pack_into('>I', dtb, 36, size_struct + delta)            # size_dt_struct
print('new dtb size = %d (was %d), off_dt_strings=%#x size_dt_struct=%d'
      % (new_total, totalsize, off_strings + delta, size_struct + delta))
open(DTB_OUT, 'wb').write(dtb)

# 4) 回填进 kernel 镜像
k = bytearray(open(KERN_IN, 'rb').read())
assert len(k) == KERNEL_TOTAL
assert k[DTB_OFF_IN_KERNEL:DTB_OFF_IN_KERNEL+4] == b'\xd0\x0d\xfe\xed'
k[DTB_OFF_IN_KERNEL:DTB_OFF_IN_KERNEL + totalsize] = dtb
if len(k) > KERNEL_TOTAL:
    del k[KERNEL_TOTAL:]
print('kernel after patch: %d bytes (target %d)' % (len(k), KERNEL_TOTAL))
assert len(k) == KERNEL_TOTAL

# 5) 更新 capsule header
newcrc = zlib.crc32(bytes(dtb)) & 0xffffffff
struct.pack_into('<I', k, CAP_HDR + 40, new_total)     # dtb_size
struct.pack_into('<I', k, CAP_HDR + 44, newcrc)        # dtb_crc
hcrc = zlib.crc32(bytes(k[CAP_HDR:CAP_HDR + 48])) & 0xffffffff
struct.pack_into('<I', k, CAP_HDR + 48, hcrc)          # header_crc
print('dtb_size=%d dtb_crc=%#x header_crc=%#x' % (new_total, newcrc, hcrc))

open(KERN_OUT, 'wb').write(k)

# 6) 自检
h = struct.unpack('<14I', k[CAP_HDR:CAP_HDR+56])
print('verify header_crc =', hex(zlib.crc32(k[CAP_HDR:CAP_HDR+48]) & 0xffffffff), 'stored', hex(h[12]))
print('verify dtb_crc   =', hex(zlib.crc32(k[DTB_OFF_IN_KERNEL:DTB_OFF_IN_KERNEL+new_total]) & 0xffffffff), 'stored', hex(h[11]))
print('verify dtb_size  =', h[10])
print('tail zero after dtb:', set(k[DTB_OFF_IN_KERNEL+new_total:]))
print('OUT', KERN_OUT, len(k))
