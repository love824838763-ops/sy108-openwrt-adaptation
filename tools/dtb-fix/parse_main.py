# -*- coding: utf-8 -*-
"""解析 main kernel capsule 布局，定位 DTB"""
import os, struct, zlib

FN = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main_kernel.bin')
d = open(FN, 'rb').read()
print('file size', len(d), hex(len(d)))

# ANDROID 头
magic, ksize, kaddr, rsize, raddr, ssize, saddr, tags, page = struct.unpack('<8s8I', d[0x200:0x228])
print('ANDROID magic=%r kernel_size=%d kernel_addr=%#x ramdisk_size=%d page=%d' % (magic, ksize, kaddr, rsize, page))

base = 0xA00
h = struct.unpack('<14I', d[base+0x80:base+0x80+56])
names = 'magic version target gzip_size image_size image_memory_size gzip_crc image_crc ramdisk_size ramdisk_crc dtb_size dtb_crc header_crc'.split()
H = dict(zip(names, h))
for n in names:
    print('  %-20s %d / %#x' % (n, H[n], H[n]))
print('header_crc check:', hex(zlib.crc32(d[base+0x80:base+0x80+48]) & 0xffffffff), 'vs', hex(H['header_crc']))

pay = base + 0x1000
print('payload @%#x  end=%#x' % (pay, pay + H['gzip_size']))
rd_off = pay + H['gzip_size']
print('ramdisk @%#x size=%d end=%#x  md5crc=%#x' % (rd_off, H['ramdisk_size'], rd_off + H['ramdisk_size'],
      zlib.crc32(d[rd_off:rd_off+H['ramdisk_size']]) & 0xffffffff))

# 搜 DTB
import re
cands = []
pos = 0
while True:
    i = d.find(b'\xd0\x0d\xfe\xed', pos)
    if i < 0:
        break
    if i + 40 <= len(d):
        tot = struct.unpack('>I', d[i+4:i+8])[0]
        if tot == H['dtb_size'] and i + tot <= len(d):
            c = zlib.crc32(d[i:i+tot]) & 0xffffffff
            cands.append((i, tot, c, c == (H['dtb_crc'] & 0xffffffff)))
    pos = i + 1
print('DTB candidates:')
for i, tot, c, ok in cands:
    print('  @%#x size=%d crc=%#x match=%s  gap_after=%d' % (i, tot, c, ok, len(d) - (i + tot)))

if cands:
    off = cands[0][0]
    tot = cands[0][1]
    print('\n--- tail hex from DTB end ---')
    tail = d[off+tot:]
    print('tail len', len(tail))
    print(tail[:80].hex())
    print('\n--- bytes before DTB ---')
    print('prev 32:', d[off-32:off].hex())
