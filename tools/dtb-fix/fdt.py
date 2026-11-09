import struct, sys
class FDT:
    def __init__(self, data):
        self.d=data
        self.magic,self.total,self.off_struct,self.off_strings,self.off_rsv,self.version,self.last_comp,self.boot_cpuid,self.size_strings,self.size_struct=struct.unpack('>10I', data[:40])
    def nodes(self):
        d=self.d; p=self.off_struct; path=[]
        while True:
            tok=struct.unpack('>I', d[p:p+4])[0]; p+=4
            if tok==1:
                end=d.index(b'\x00', p); name=d[p:end].decode('utf-8','replace'); p=end+1
                # align
                p=(p+0) if True else p
                path.append(name)
                yield ('BEGIN', '/'.join(x for x in path if x), None)
            elif tok==2:
                if path: path.pop()
            elif tok==3:
                ln,noff=struct.unpack('>II', d[p:p+8]); p+=8
                val=d[p:p+ln]; p+=ln
                end=d.index(b'\x00', self.off_strings+noff)
                nm=d[self.off_strings+noff:end].decode()
                yield ('PROP', '/'.join(x for x in path if x), (nm,val))
            elif tok==4: pass
            elif tok==9: break
            else: break
def dump(fn, filt):
    f=FDT(open(fn,'rb').read())
    print(f"\n########## {fn} (total={f.total}, ver={f.version}) ##########")
    out={}
    for kind,path,pv in f.nodes():
        if kind=='PROP' and path and filt(path):
            out.setdefault(path,[]).append(pv)
    for path in sorted(out):
        print(f"[{path}]")
        for nm,val in out[path]:
            if val and all(32<=c<127 for c in val):
                v=val.rstrip(b'\x00').decode()
            else:
                v=' '.join(f'{c:02x}' for c in val[:16]) + ('...' if len(val)>16 else '')
            print(f"    {nm} = {v}")
dump('main.dtb', lambda p: ('usb' in p.lower()))
dump('recovery.dtb', lambda p: ('usb' in p.lower()))
