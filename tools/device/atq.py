#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量执行 AT 命令 用法: atq.py "AT+CSQ" "AT+COPS?" ..."""
import sys
from cellop import execute

for cmd in sys.argv[1:]:
    r = execute('at_debug', {'command': cmd, 'timeout': 25})
    if isinstance(r, dict) and 'response' in r:
        resp = r['response'].replace('\r\n', ' | ').strip()
        print('>>> %-32s ok=%s  %s' % (cmd, r.get('success'), resp))
    elif isinstance(r, dict):
        err = r.get('error') or (r.get('result') or {}).get('error') or 'failed'
        print('>>> %-32s FAIL  %s' % (cmd, err))
    else:
        print('>>> %-32s %s' % (cmd, r))
