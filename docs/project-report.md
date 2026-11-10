> 本文是适配过程的完整踩坑记录。系统本身属于 [jason-liu-4980/sy108-mainline](https://github.com/jason-liu-4980/sy108-mainline)，本文只记录**第三方适配增量**。文中个人信息（IMSI/本机路径）已脱敏。

# SY108 5G 通信壳改造项目 · 完整报告

> 项目周期：2026-11-08 ～ 2026-11-09（约 24 小时密集作业）
> 设备：Soyealink/数源 SY108-688 5G 通信壳（某品牌旗舰手机配套款，保护壳形态；UNISOC UDX710 平台，改装卡槽，插香港 CMHK 实体 SIM）
> 报告日期：2026-11-09

---

## 〇、项目成果一览（TL;DR）

| 目标 | 结果 |
|---|---|
| Windows 免驱 USB 上网 | ✅ 完成（UsbNcm Host Device，`192.168.66.7`） |
| Mac / iPad / Android 免驱识别 | ✅ 完成（NCM 是全平台标准协议，主线内核原生支持） |
| 刷入 OpenWrt 主线固件 | ✅ 完成（OpenWrt 25.12.5 r33051，Main 系统持久启动） |
| 香港 CMHK 实体卡上网 | ✅ 完成（APN `cmhk`，实测下行最高 205 Mbps） |
| 免登录状态页（运行/网络/频段信号） | ✅ 完成（`http://192.168.66.1/`，右上角可登录 LuCI） |
| 断网自动弹状态页（captive portal） | ✅ 完成（WAN 断 15 秒自动开启，恢复自动关闭） |
| LuCI 网页只读锁（防误改） | ✅ 完成（root/view 网页均只读，SSH 可临时解锁） |
| 电脑日常走 WiFi（USB 仅调试） | ✅ 完成（USB metric 90 / WiFi metric 30，直连路由保留） |
| 救砖工具链 | ✅ 已打通（免按键进下载模式 + RAM 启动 SPL + mtdutils 写回） |

**一句话总结**：把一台只能 Windows RNDIS 上网的 4.14 内核旧壳，改造成了 OpenWrt 主线内核（Linux 7.3）驱动的全平台免驱 5G 上网设备，中途从"变砖"状态完整救回，并做了全套易用性配套。

---

## 一、设备与背景

### 1.1 硬件概况

- **型号**：SY108-688（某品牌旗舰手机配套的保护壳形态 5G 通信壳，改装卡槽版，无按键、无 RESET 孔，总线供电 = 拔 USB 线即断电重启）
- **SoC**：UNISOC UDX710（展讯），aarch64，512 MB RAM
- **原厂系统**：Linux 4.14.98 + ofono 蜂窝栈 + connman + 自研 8080 Web 后台（Go+Vue 闭源）
- **USB**：原厂仅 RNDIS（PID 0x4038），仅 Windows 能联网
- **序列号**：90PSHSY68842CX2B0701884

### 1.2 分区布局（精确，从原厂 bootargs 提取）

```
mtd0 splloader   0x000000  256 KiB   （无备份分区！单点）
mtd1 uboot       0x040000  1280 KiB
mtd2 sml         0x180000  768 KiB
mtd3 trustos     0x240000  128 KiB
mtd4 ubootbak    0x260000  1280 KiB
mtd5 smlbak      0x3A0000  768 KiB
mtd6 trustosbak  0x460000  128 KiB
mtd7 ubipac      0x480000  251 MiB   （UBI，含 23 个卷）
总计 256 MiB（0x10000000）
```

⚠️ 与社区 R106 固件的分区表**不同**（R106 的 trustos 是 1024 KiB，ubipac 起点偏移差 1.75 MiB）——**R106 的分区 XML 绝对不能直接套用**。

### 1.3 项目缘起

1. 用户最初只想让 Mac/iPad 也能用这个壳上网（原厂 RNDIS 只有 Windows 认）
2. 调研发现原厂 4.14 内核的 USB gadget 驱动有致命缺陷（详见 3.2），用户态无解
3. 社区已有 SY108 专用 OpenWrt 项目（`jason-liu-4980/sy108-mainline`，主线内核 7.3 + CDC-NCM），从根本上绕开旧内核缺陷
4. 决定刷 OpenWrt，由此展开"备份 → 救砖准备 → 刷机 → 适配 → 配套"的完整工程

---

## 二、时间线（阶段总览）

| 阶段 | 时间 | 内容 | 结果 |
|---|---|---|---|
| 1. 原厂固件探索 | 11-08 白天 | ADB/shell 摸底、8080 后台替换开源版 | 修好原厂"读不到信息"的 bug |
| 2. 跨平台尝试（原厂固件） | 11-08 晚 | NCM/ECM 逐一实测 | ❌ 全部失败（内核级缺陷），回退 RNDIS |
| 3. 安全备份 | 11-08 晚 | mtd0~7 全量 + 9 个 UBI 卷逻辑备份 | ✅ 302 MB，MD5 全核对 |
| 4. 救砖工具链 | 11-08 深夜～11-09 上午 | spd_dump/BSL 协议/驱动/FDL | ✅ 免按键进下载模式打通 |
| 5. 变砖与救砖 | 11-09 01:00～12:30 | autodloader 擦掉 SPL → RAM 注入 → mtdutils 写回 | ✅ 持久修复，冷启动自愈 |
| 6. 刷入 OpenWrt | 11-09 13:00～14:25 | sysupgrade + DTB 修复（dr_mode） | ✅ Main 启动，NCM 网口通 |
| 7. 蜂窝适配 | 11-09 15:00 | CMHK APN/PDP 配置 | ✅ 80～205 Mbps |
| 8. 配套工程 | 11-09 15:30～17:15 | 状态页、portal、LuCI 锁、WiFi 优先 | ✅ 全部落地 |

---

## 三、遇到的坑（按类别，本报告核心章节）

### 3.1 原厂固件与设备机制的坑

| # | 坑 | 现象 | 根因 | 解决 |
|---|---|---|---|---|
| 1 | 8080 后台接口崩溃 | `/api/get/sysinfo`、`/api/get/network` 报错读不到信息 | 设备无 bash（只有 busybox sh）；ofono 版本缺 `GetServingCellInformation` | 换开源 `ofono-server`（8080.real）+ supervisor 包装脚本自动重启 |
| 2 | 8080 进程杀不掉 | `EADDRINUSE`，新服务起不来 | 旧进程监听 IPv6 `:::8080`，旧脚本只扫了 `/proc/net/tcp` | 用 socket inode（tcp+tcp6）→ `/proc/*/fd` 反查 PID |
| 3 | **改 USB 模式重启后被强制还原** | 写了 `mode.cfg=1/2`，重启又变回 RNDIS | **`/etc/init.d/hostname.sh` 第 24-25 行硬编码 `echo 3 > /mnt/data/mode.cfg`**，每次开机强制写回 | 改掉该行才能持久化模式（OpenWrt 下不存在此问题） |
| 4 | 拔 USB 线 = 断电重启 | 测试中设备反复重启 | 通信壳总线供电，无内置电池 | `mode_tmp.cfg` 一次性方案不能跨设备用；跨主机测试必须持久化配置 |
| 5 | 换主机后"识别不到" | iPad/Mac 插上没反应 | 网卡出现需约 90 秒 | 等待即可，不是故障 |
| 6 | `usbenum.sh mode2` 残缺 | 切模式直接报错 `isself: not found`，USB 全死 | 厂商脚本在本固件上不完整 | 弃用；预设 360s 自动重启安全网兜底回退 |
| 7 | `udhcpd` 进程查不到 | `pidof udhcpd` 永远为空 | busybox applet 进程名是 `busybox.nosuid` | 用 pidfile + `kill -0` 判断 |
| 8 | adb shell 脚本自杀 | 遍历 /proc 时命令被截断 | `case "$c" in *dhcp_usb*)` 匹配到执行命令的 shell 自身 | 拆字符串：`P2="dhcp""_usb"` |
| 9 | `setsid` 启动的脚本活不下来 | adb shell 退出后进程消失 | busybox 环境限制 | 用 `start-stop-daemon --background` |

### 3.2 USB 网络模式的坑（原厂 4.14 内核，全部死路）

这是"为什么要刷 OpenWrt"的根本原因：

| 模式 | 枚举 | 数据面 | 结论 |
|---|---|---|---|
| RNDIS (mode3, PID 0x4038) | ✅ Windows 识别 | ✅ 正常 | 唯一可用，但仅 Windows |
| NCM (mode1, PID 0x4040) | ✅ Windows 识别 `UsbNcm Host Device` | ❌ RX 全丢 | 内核日志刷屏 `Wrong NDP SIGN` |
| ECM (mode2, PID 0x4039) | ✅ 出现网卡（Windows 无驱动 Code 28） | ❌ TX 冻结 | `tx_packets` 永不增长 |

**关键教训**：
1. **NCM 的 `Wrong NDP SIGN` 是 4.14 内核已知 bug**（`f_ncm.c` 的 `ndp_sign` 只在 `SET_NTB_FORMAT` 分支赋值，Windows 主机不发该请求 → 校验失败全丢包）。内核 v5.18+ 已修。有 3 行补丁但需内核源码重编，风险高。
2. **ECM 的 TX 冻结**：`udhcpd` 明明发了 17 次 OFFER，`tx_packets` 一包不涨 —— 包在进发送队列前就被丢（`f_ecm in_ep->enabled=false` 路径）。用户态无解。
3. **误判教训**：`ping6 ff02::1` 有回包曾被当作"回程正常"，实际是自己 ping 自己（回包地址就是 usb0 自身的 EUI-64）。**判定方向性必须看 `tx_packets`/`rx_packets` 计数器，不能靠 ping**。
4. Windows 不支持 USB 双 configuration，"ECM+RNDIS 并存"不可行，只能探测重建（xg_multi 方案），但本壳 ECM 数据面本身是死的，重建也无用。
5. **最终结论：原厂 4.14 固件下跨平台联网无解，必须换内核** → 引出 OpenWrt 路线。

### 3.3 救砖与刷机链路的坑（最凶险的一段）

| # | 坑 | 现象 | 根因 | 解决 |
|---|---|---|---|---|
| 1 | **`unisoc-reboot autodloader` 会擦掉 SPL** | 进下载模式后永远回不到正常系统 | 展锐平台已知行为（社区多处警告），splloader 被擦成 ECC 不可纠正坏页 | ⚠️ **永远不要执行**；已擦则必须写回 mtd0 |
| 2 | PowerShell CRC 全算成 0 | 发出的帧全错，设备 BSL 状态机卡死 | `[byte]0x05 -shl 8 == 0`（`-shl` 保持 8 位宽度） | 强制 `[int]$b -shl 8`；加 `-SelfTest` 金帧校验（10 项 PASS 才准连设备） |
| 3 | 给 FDL 发错校验方式的帧 = 必 STALL | 端点卡死，只能物理拔插恢复 | BootROM 用 CRC16-CCITT，FDL 阶段用 SUM，且偶数字节要字节交换 | 拿到确定性应答后**绝不换校验方式重试**（此坑踩了 4 次） |
| 4 | BootROM 只支持下载命令 | 发 `READ_CHIP_TYPE` 等 info 命令无回帧 + 端点 STALL | 命令分层：`0x00~0x04` 是 BootROM 组，读写分区是 FDL2 组 | BootROM 阶段只发握手+下载，绝不发 info |
| 5 | R106 分区表与本机不匹配 | 若按 R106 XML 写 ubipac 必错位变砖 | trustos 128K vs 1024K，ubipac 偏移差 1.75 MiB | 只用 R106 FDL 作 DDR/NAND 初始化；进 FDL2 后第一条必须 `p` 核对真实分区表 |
| 6 | FDL2 写 splloader 的 END_DATA 挂死 | 写 4 块全 ACK，提交无回包 | 参考实现"提交后整段校验不过就 while(1)"，该区 ECC 已坏 → 永远卡死 | **FDL2 写分区对本机注定失败**，改走设备内 mtdutils |
| 7 | `dd` 到 `/dev/mtdblock0` 假成功 | dd 报成功但零变化，随后 NAND 卡死看门狗复位 | mtdblock 路径在坏页上不可靠 | 弃用；必须 `mtdutils 4 mtd0 0 1`（擦）→ `mtdutils` 写 → 按页回读 |
| 8 | mtdchar 读取 MD5 对不上 | 同一分区读两次 MD5 不同，误判"写入失败" | 内核 mtdchar 多页读 bug：**必须 `bs=2048`（writesize）**，`bs=4096` 或 `cat` 读的是脏缓冲 | 一律 `dd bs=2048` 读取校验 |
| 9 | 分块备份错位 | 拼出的镜像无效（备份 16MiB 处 == 设备 1MiB 处） | `dd bs=1M skip=$i count=16` 的 $i 只推进 1MiB | 改 `skip=$((i*16))` 重做 |
| 10 | UBI 物理快照 MD5 对不上 | 整盘 MD5 与设备不一致 | UBI 磨损均衡持续搬动 PEB（7/16 MATCH 属正常） | 改做**卷级逻辑备份**（9 个卷 MD5 双向全 MATCH） |
| 11 | `while read <<EOF` 循环只跑第一项 | 备份脚本半途而废 | 循环里调 adb 吞掉 stdin | 改 `for SPEC in ...; do set -- $SPEC` |
| 12 | 普通权限无法重置 USB 端点 | 端点 STALL 后各种软复位全失败 | Intel xHCI 不支持用户态 VBUS 断电 IOCTL；设备树 API 全要管理员 | 提权 Disable/Enable-PnpDevice（软断电）或物理拔插 2~3 秒 |
| 13 | `Start-Process -Verb RunAs` 提权 bat 无效 | 双击无 UAC 弹窗 | `.bat` 的 runas 关联在部分系统不生效 | 提权 **powershell.exe** 而非 bat；或右键"以管理员身份运行" |
| 14 | BSL 状态机被错误帧打死 | 之后所有写超时 | 见 #2/#3 | 物理断电（拔插）是唯一恢复手段 |

**救砖链最终打通的路径（保命，务必记住）**：
1. **免按键进下载模式**：设备有 `/usr/bin/unisoc-reboot autodloader`（绕过 adbd）—— ⚠️ **但它会擦 SPL，除非已做好写回准备，否则绝不用**。安全入口是冷上电瞬间的 boot_diag 窗口（`spd_dump --wait` 抓）。
2. **RAM 启动**：把备份 `mtd0.img` 当 FDL1 送 `0x28007000` + no-verify stub `0x3F28` + EXEC → 52 秒后 Linux 起来（SPL 加载地址与 FDL1 相同，这是无按键救砖最短路径）。
3. **写回 SPL**：设备内 `mtdutils 4 mtd0 0 1` 擦 → `dd if=/run/spl.img of=/dev/mtd0 bs=2048 conv=fsync` → `dd if=/dev/mtd0 bs=2048 | md5sum` 核对 → `reboot`。
4. **验证判据**：读出的 splloader 与 `mtd0.img` MD5 一致（`b74445185371cda7af8af229b84a378d`）= 修复成功。

### 3.4 OpenWrt 刷入与适配的坑

| # | 坑 | 现象 | 根因 | 解决 |
|---|---|---|---|---|
| 1 | **Main 系统 USB 完全不可用** | `/sys/class/udc/` 空，`S50udx-usb` 报 `Device controller absent`；健康检查卡住 | **`main.dtb` 的 `dr_mode="otg"` 与 `dwc3-of-simple` 驱动不兼容**（error -95: Explicit host or peripheral mode required），dwc3 core 从不创建 | 修 DTB：`dr_mode` 改 `peripheral`，NOP 掉 `usb-role-switch` 等 3 个属性，重算 CRC，保持镜像长度不变 |
| 2 | boot-accept-health 卡住 | trial 预算耗尽回退 Recovery | 健康检查要求 UDC + DHCP 就绪（正是 #1 导致） | 修好 DTB 后 `udx-boot-state accept` 返回 rc=0，自动进 Main |
| 3 | DTB 改动后镜像损坏 | 无法启动 | FDT 头部有 dtb_crc/header_crc（crc32 前 48 字节） | `fix_capsule.py` 自动重算全部校验和 |
| 4 | dropbear 无 sftp | paramiko open_sftp 失败 | OpenWrt 默认不带 sftp 子系统 | 自写 `rput.py`（SSH stdin 上传，二进制安全） |
| 5 | git bash 路径转换 | `/mnt/...` 参数被 MSYS 转成 Windows 路径 | MSYS 默认路径转换 | `MSYS_NO_PATHCONV=1` 必须写死在命令行（塞进变量无效） |

### 3.5 蜂窝网络（香港 CMHK）的坑

| # | 坑 | 现象 | 根因 | 解决 |
|---|---|---|---|---|
| 1 | **APN 误判** | 配了 `wbdata` 一直不通 | auto 模式错误选择 Webbing（MVNO）的 APN；这张卡是 CMHK | 从 SIM 直接读 EF_SPN=`CMHK`、EF_APN=PLMN 454-12，改 `cmhk` |
| 2 | `CME ERROR: 149/28` | PDP 激活被本地拒绝 | `pdp_type=IP` 不行，**CMHK 双栈必须 `IPV4V6`** | `pdp_type=IPV4V6` + `apn=cmhk` |
| 3 | AT 响应"超时" | `at_debug` 报 response timed out | CMHK 双栈激活要约 25 秒，属正常慢响应 | 等待即可，不是失败 |
| 4 | `internet` APN 被拒 | 部分资料写 CMHK 用 `internet` | 本卡实测被拒 CME 149 | 以 `cmhk` 为准 |
| 5 | `AT+CNMP?` 不支持 | 查询锁网失败 | 本 modem 不支持（CME 4） | 锁网用 `AT+COPS=1,2,"45412",7` |
| 6 | 速率只有几 Mbps | 偶发掉速 | 频段切换瞬态 / 网络侧调度拥塞 / CMHK 储值卡 30GB 后限速 | 先查余量；锁 n79 可稳定但需写开机脚本（ubus，不写 uci） |
| 7 | `signal` 只有 `csq:99` | 状态页读不到信号 | 常规 status 不含 RSRP/SINR | 走 `serving_refresh` 异步操作 + 30 秒文件缓存 |

**最终可用配置（`/etc/config/udx-cellular`，已持久化）**：
```
modem.cid='1'  modem.apn='cmhk'  modem.pdp_type='IPV4V6'
modem.auth_method='none'  modem.apn_mode='manual'
modem.roaming='1'  modem.automatic_connect='1'  modem.radio_enabled='1'
modem.nr_capability='sa_nsa'
```
断线约 5 秒自动重拨（实测 `AT+CGACT=0` 后自愈）。

**香港运营商 APN 备查**：CMHK=`cmhk`（漫游 `roaming.cmhk.com`）；3HK=`mobile`/`3hk`/`three.com.hk`；csl/1010/1O1O=`mobile`/`internet`/`hk.csl`；SmarTone=`smartone`。要点：认证 None、协议 IPv4/IPv6、MCC 454。

### 3.6 状态页 / Captive Portal 的坑

| # | 坑 | 现象 | 根因 | 解决 |
|---|---|---|---|---|
| 1 | **DNS 劫持不触发弹窗** | dnsmasq 劫持了域名但 Windows 不弹 | Windows 有 WiFi+USB 双网卡时，NCSI 探测走系统首选 DNS（WiFi 的） | 必须用 **nft 在 output/prerouting 拦 TCP/80**，不依赖 DNS |
| 2 | DNAT 到自己地址无效 | 502 | `dnat to 192.168.66.99:88` 在 prerouting 不生效 | DNAT 到 **`127.0.0.1:88`** + `route_localnet=1`（注意入接口是 `uncm0` 不是 br-usb） |
| 3 | 停 cellular 测试 → 设备硬重启 | USB 全掉线 30 分钟 | `stop udx-cellular` 触发 `udx-runtime` PMIC 看门狗 | 测试断网必须用 `portal-ctl force`，**绝不能停 cellular** |
| 4 | 删 USB 默认路由 → 弹窗失效 | NCSI 不再探测 USB 接口 | Windows 对无默认路由的接口不做 NCSI 探测 | 保留高 metric（90）默认路由，只调整优先级 |
| 5 | dnsmasq confdir 路径错 | 劫持配置不生效 | confdir 名带 cfg 后缀（`/tmp/dnsmasq.cfg01411c.d/`），不是 `/tmp/dnsmasq.d/` | 按实际 confdir 写 |
| 6 | jsonfilter 不支持连字符 key | `@.ipv4-address[0].address` 报错 | jsonfilter 语法限制 | 改用 sed 从 ubus 文本输出提取 |
| 7 | 温度显示离谱 | 数值大 10 倍 | `thermal_zone*/temp` 单位是**毫摄氏度** | `/1000` |
| 8 | 信号等级表达歧义 | `6/10` 易误读；SINR 差但 RSRP 好时偏乐观 | 旧判据二选一 | 改语义标签（极佳/良好/中等/偏弱/很差），SINR+RSRP **取 min**（保守） |

### 3.7 LuCI 管理锁定的坑

- busybox **无 adduser** → `view` 账户手动写 `/etc/passwd` + `/etc/shadow`（复用 root 的 `$5$` hash）
- rpcd 权限模型：`login[0]` root 移除 `write='*'`、`login[1]` view 仅 `read='*'` → 网页任何写操作返回 `Access denied`（-32002）
- **SSH 不走 rpcd**，保持可写；`/usr/bin/luci-write on|off|status` 临时解锁网页
- 误改风险点已锁死：网络/防火墙/蜂窝配置网页均只读

### 3.8 Windows 侧的坑

| # | 坑 | 解决 |
|---|---|---|
| 1 | PowerShell 5.1 把 UTF-8 无 BOM 中文脚本读成 ANSI → "意外的标记 }" | **所有 .ps1 必须存 UTF-8 带 BOM** |
| 2 | `.bat` 里 `powershell -Command` 多行 `^` 续行解析崩 | 一律 `powershell -File xxx.ps1` |
| 3 | bat 的 `>>` 重定向与 ps1 的 `Out-File -Append` 抢文件锁 | 统一由 ps1 写日志 |
| 4 | git bash 里 `curl -o /dev/null` 被 MSYS 转成 Windows 路径 → 测速数据全假（6 B/s） | 测速用 Python 或 PowerShell 的 `NUL` |
| 5 | USB metric 25 < WiFi 30 → 有卡时流量走卡，卡断网不自动回退 WiFi | USB metric 调 90、WiFi 30；配 wan-autoswitch 计划任务自动调 metric |
| 6 | 幽灵默认路由（Realtek Disconnected） | 删除 `192.168.1.1` 幽灵路由 |
| 7 | 改 metric 非管理员报 Windows Error 5 | 提权脚本 + 计划任务（`schtasks.exe` 被安全策略黑名单 → 用 `Register-ScheduledTask`） |
| 8 | Cloudflare 测速端点对无 UA 的 Python 返回 403 | 加 UA |
| 9 | `node --check` 校验 JS 时 MSYS 把 /tmp/x.js 转成 Windows 路径找不到 | 用绝对路径 `tools/device/chk.js` |

### 3.9 工具链/环境杂坑

- `MSYS_NO_PATHCONV=1` 塞进 shell 变量 `$ADB` 不生效（变量展开不产生 env 前缀）→ 必须写死在命令行
- pyserial 用 overlapped I/O，对 sprdvcom 驱动 `WriteFile` 必然超时 → 只能用 .NET `SerialPort` 同步方式（DTR/RTS 必须在 `Open()` 前设）
- `SetupDiGetDeviceInterfaceDetailW` 的 DevicePath 在 x64 起于 **offset 4** 不是 8（取错会得到假的权限拒绝）
- 修正过的 IOCTL 数值：`HCD_DISABLE_PORT=0x220430`、`HCD_ENABLE_PORT=0x220434`、`RESET_HUB=0x22044C`（usbiodef.h 原文）
- 设备侧无 veth/dummy 内核模块 → 无法用虚拟网卡做 DHCP 闭环测试，只能真实主机验证
- 提权执行被环境安全策略拦截时（工具侧不能代跑 UAC），交付桌面 bat 由用户双击完成

---

## 四、最终解决方案与现状

### 4.1 系统架构（最终形态）

```
[Windows/Mac/iPad/Android]
        │ USB（NCM，免驱）
        ▼
┌─ SY108 · OpenWrt 25.12.5（Main，root=/dev/ubiblock0_21）─┐
│  usb gadget: ncm-software → uncm0 → br-usb 192.168.66.1   │
│  dnsmasq: DHCP+DNS 下发 192.168.66.x                       │
│  firewall: usbmgmt→wan NAT（masq）                        │
│  wwan0 ← udx-cellular ← CMHK SIM（APN cmhk / IPV4V6）     │
│  uhttpd:80   → 免登录状态页 /www/index.html + sy108status  │
│  uhttpd:88   → portal（仅断网时由 nft 劫持启用）           │
│  LuCI: root/view 只读，SSH 可写，luci-write 临时解锁       │
│  portal-watch: WAN 断 15s 开 portal / 恢复自动关           │
└────────────────────────────────────────────────────────────┘
```

### 4.2 关键技术决策

1. **DTB 修复而非改驱动**：`dr_mode="otg"` → `"peripheral"`，NOP 掉 `usb-role-switch`/`role-switch-default-mode`/`sprd,pamu3-offload`，重算 dtb_crc/header_crc，镜像总长 7,191,040 B 不变（等长替换，吃掉尾部零填充）。
2. **USB gadget profile 用 `ncm-software`**（与 Recovery 一致）：NCM 是 Windows(内置)/macOS/iPadOS/Android/Linux 全平台原生支持的唯一协议。
3. **Windows 侧 USB metric 90 / WiFi 30**：日常走 WiFi，USB 保留 `192.168.66.0/24` 直连路由（调试/状态页可达）+ 高 metric 默认路由（保证 NCSI 探测 → 弹窗可用）。
4. **Portal 三层架构**：状态页（免登录）+ 独立 uhttpd:88 + nft 网络层拦截（不依赖 DNS）+ portal-watch 自动开关。
5. **网页只读 + SSH 可写**的权限分离：防误改与可维护性兼顾。

### 4.3 当前状态（2026-11-09 17:00 验证）

- 系统：OpenWrt 25.12.5 r33051-f5dae5ece4，Main 持久启动（重启 12.8s 恢复 SSH）
- USB：`UsbNcm Host Device`，Windows `192.168.66.7/24`，一切免驱
- 蜂窝：CMHK，断线 5 秒自动重拨；实测下行 80～205 Mbps（n79 四流 205 峰值）、上传 44 Mbps、延迟 12-25ms
- 温度：SoC 51.7°C / PA 46.5°C（余量充足）；内存 34/200 MB；闪存 2 坏块（出厂即有，未增长）
- 状态页/portal/LuCI 锁/WiFi 优先：全部生效，重启自愈已验证

### 4.4 速率瓶颈说明（不是故障）

实测证明瓶颈在**射频 SINR / 单载波带宽**（n79 SINR 6-12 时 96-205 Mbps，切换瞬间跌到几 Mbps），不在 USB/APN/TCP。

**USB 3.0 结论（2026-11-10 复核更正）**：早期记录写的「换 USB 3.0 线缆即可解锁 SuperSpeed」是**错误推测**，现已证伪。实测：设备侧 DWC3 `maximum-speed=super-speed`、gadget `max_speed=super-speed`、设备树 `maximum-speed` 为空、`phy-names=usb2-phy usb3-phy`（软件侧**完全没有限速**），但 `current_speed=high-speed`，Windows 枚举在 `ACPI(HS07)`（High-Speed 分支）。原因是**外侧母座（充电/连电脑那颗）物理上只引出 USB2 的 D+/D- 线对**，SuperSpeed 差分对只存在于内侧插手机的公头上。改装圈的公开经验也印证：「USB3.0 需全链路闭环，2.0 口和 3.0 口不能同时使用」。

USB 段实测吞吐 42.7 MB/s（约 342 Mbps），而空口单流仅 16 Mbps、4 路并发约 75 Mbps —— **USB 段是空口的 4 倍以上，即使换成 SuperSpeed 也不会提升网速**。优化杠杆：改善摆放/遮挡与 SINR > 选对频段（避开 n1 的 20 MHz 小带宽）> 供电与散热稳定 > 换 USB3 线（收益≈0）。

补充：CMHK 公开实测（ManHungTech, 2025-08）显示 **n1 平均下行 74.64 Mbps、多次不足 100 Mbps**（该运营商 n1 仅 20 MHz 带宽），而 n78 平均 293 Mbps；UDX710 / 春藤 V510 **不支持载波聚合**，单载波带宽无法叠加。这与「顶多 100、上不了 200」的体验吻合，属于网络侧与基带规格的先天上限，不是本适配引入的故障。

---

## 五、关键文件与固件清单

> 全部已分类归档到 `<本地归档目录>/`（详见同目录 `README_文件索引.md`）。
> 原工作区 `<本地工作目录>/` 保留不动（桌面 SY108-*.bat 启动器依赖该路径）。

| 类别 | 归档目录 | 核心内容 |
|---|---|---|
| 报告与索引 | `01_报告与索引/` | 本报告、文件索引 |
| 固件镜像 | `02_固件镜像/` | **main_kernel_fixed.bin**（修复后 Main 内核，核心成果）、sysupgrade.bin、uboot、各 dtb |
| DT 修复工具 | `03_DT修复与镜像工具/` | fix_capsule.py、fdt2.py、dtbdiff.py 等 |
| 刷机救砖工具 | `04_刷机救砖工具/` | bsl_fdl.py、spd_dump、FDL、驱动、无按键救砖手册 |
| 设备端脚本 | `05_设备端配置脚本/` | rsh/rput/rget、LuCI 锁、portal 控制、蜂窝操作 |
| 状态页/Portal | `06_状态页与Portal/` | index.html、sy108status.cgi、wanhealth.cgi |
| Windows 网络工具 | `07_Windows网络工具/` | usb-net-setup、wifiprio、wan-autoswitch |
| 备份镜像 | `08_备份镜像/` | mtd0-7 全量、9 个 UBI 卷、修复前 boot 卷（**保命数据**） |
| 参考文档 | `09_参考文档/` | 分区表、调研资料、架构笔记 |

**保命三件套**（丢什么都不能丢这三个）：
1. `08_备份镜像/full/mtd0-splloader.img`（splloader，无备份分区的单点，MD5 `b74445185371cda7af8af229b84a378d`）
2. `08_备份镜像/volumes/`（9 个 UBI 卷，尤其 prodnv/fixnv 校准数据）
3. `04_刷机救砖工具/无按键救砖手册.md`（完整操作链）

---

## 六、回滚与救砖要点（保命索引）

### 6.1 回滚到原厂固件
- 设备侧留有 `/home/root/revert_rndis.sh`（原厂固件时代）；OpenWrt 下可用 `restore_factory.sh` 整体回滚
- 原厂 mtd4 ubootbak 未动；`boot_vol_before_dtbfix.img` 是 DTB 修复前的 boot 卷快照
- 刷机前原厂状态：`idProduct=0x4038`、`mode.cfg=3`、8080 面板 HTTP 200

### 6.2 变砖急救顺序
1. 先试：拔线 2~3 秒插回（真 POR，多数状态可自愈）
2. 不行：桌面 `SY108-5-one-click-fix.bat`（右键管理员运行，四级软恢复）
3. 停在 4D00（下载模式）：`bsl_fdl.py --stage splash` RAM 启动（零写入）
4. SPL 已坏：`repair_run.py` → mtdutils 写回 mtd0（源固定 mtd0.img，fail-closed 设计）
5. 终极：spd_dump + FDL2（进 FDL2 第一条必须 `p` 核对分区表；**禁用 R106 XML 整体刷**）

### 6.3 绝对禁区
- ❌ `unisoc-reboot autodloader`（会擦 SPL，除非备好写回流程）
- ❌ 按 R106 `udx710-module.xml` 写 ubipac（错位 1.75 MiB 必砖）
- ❌ `REPARTITION` 命令（size 单位是 MB，256KiB 会写成 0 MB 毁分区表）
- ❌ FDL 阶段混用校验方式（CRC16 ↔ SUM 切换 = 端点 STALL）
- ❌ `stop udx-cellular` 造断网测试（PMIC 看门狗硬重启）
- ❌ dd 到 `/dev/mtdblock0`（假成功后 NAND 卡死）
- ❌ 读 mtd 用 `bs=4096` 或 `cat` 校验（必须 `bs=2048`）

---

## 七、遗留事项与优化建议

| 事项 | 优先级 | 说明 |
|---|---|---|
| ~~USB 3.0 线缆/端口~~ | ❌ 已证伪 | 2026-11-10 复核：软件侧无限速，但外侧母座物理上只有 USB2 线对；USB 段实测 342 Mbps 远高于空口，换线无收益（详见 4.4） |
| ~~流量统计~~ | ✅ 已解决 | 18:30 轮已加跨重启累计流量（见附录） |
| 锁 n79 开机脚本 | ✅ 已解决 | `bandlock n79|auto|status` + rc.local 开机恢复（见附录） |
| IPv6 半残 | 低 | CMHK 只下发 IPv4，wan6 pending；ULA 已抑制，影响极小 |
| portal 仅完全断网时弹 | 低 | "信号弱也弹"与用户需求"有网不弹"冲突，故意不做 |
| `Hi-SOYEASY108` 残留 USB 节点 | 可忽略 | 设备管理器 Error 状态，不影响功能，可清理 |

---

## 九、优化轮记录（2026-11-09 18:30）

1. **流量统计（跨重启累计）**：`sy108status.cgi` 新增 `traffic` 字段（`rx/tx` 累计 + `boot_rx/boot_tx` 本次开机），状态页"网络连接"卡片新增「本次流量 / 累计流量」两行。实现：读 `wwan0` 计数器，检测回绕/重启累加基数，live 态存 `/tmp`，每 5 分钟持久化到 `/root/traffic.state`（NAND 磨损可控，关机最多丢 5 分钟统计）。**用途**：CMHK 储值卡 30GB 后限速，随时看余量。
2. **登录按钮相对化**：去掉硬编码 `192.168.66.1`，按当前 host 动态生成 LuCI 地址（portal 弹窗场景也能正确跳转）。
3. **时区修正**：`/etc/TZ = HKT-8` + `uci system.timezone='HKT-8'`，设备日志/`date` 显示香港时间。
4. **锁频工具**：`/usr/bin/bandlock n79|n78|n41|auto|status`；标记文件 `/etc/bandlock.mode` + `/etc/rc.local` 开机自动恢复（弥补 band_lock 不进 uci 的缺陷）。用法：速率不稳时 `bandlock n79`，恢复 `bandlock auto`。
5. **USB 口诊断结论（当时推测，2026-11-10 已更正）**：Windows 侧链路 = UsbNcm → `USB\ROOT_HUB30`（Intel xHCI 3.10）→ 主机口确为 USB 3.0。当时推测 high-speed 的剩余变量是线缆与协商；后续复核证实**外侧母座物理上只引出 USB2 线对**，软件侧无限速（见 4.4）。仍**不建议**为 `sprd,pamu3-offload` 改动 DTB（SSH 走 USB，挂了需全套救砖）。

---

## 十、APN 自动识别轮（2026-11-09 19:00）

**需求**：换 SIM 卡后无需手动配置——识别到哪个国家/运营商，就自动切换 APN（对标 Android/oFono 的 MCC/MNC 供给机制）。

**实现**（原理：SIM IMSI 前 5-6 位 = MCC+MNC，唯一标识国家+运营商）：

| 组件 | 位置 | 作用 |
|---|---|---|
| `/usr/bin/apn-auto` | 设备端 | `show/apply/check/status/on/off` 六个子命令 |
| `/etc/apn-auto.db` | 设备端 | 1029 条 MCC/MNC → APN 映射（LineageOS apns-conf.xml + CMHK 实测覆盖） |
| `/etc/apn-country.db` | 设备端 | 167 个 MCC → 国家中文名 |
| cron `*/2` + rc.local | 设备端 | 每 2 分钟检测换卡（ICCID 变化才动作）+ 开机检测 |
| 状态页「运营商」行 | 页面 | 显示 `识别运营商 · 国家`（CGI 从数据库查） |

**工作流**：读 IMSI → 查表（MNC 先 3 位后 2 位）→ 命中则调 `ubus call udx.cellular apn` 应用 → 轮询 operation_status 等结果（CMHK 双栈激活约 25 秒属正常）→ 以读回 `profile.apn` 为准判定成功。未命中数据库则不动现有配置（安全兜底）。

**实测**：IMSI 45412******33（已脱敏） → 识别「中国香港 / CMHK」→ 建议 `cmhk + IPV4V6 + none` → 与当前一致（无需更改）✓；apply/check/status 全流程通过；页面 JSON 新增 `cell.country`/`cell.carrier` ✓。

**坑**：Windows 生成的 .db 是 CRLF 换行，`cut` 取值会带 `\r` 混入 JSON 导致解析失败（"Invalid control character"）——**设备端文本文件必须 LF**，已清理并在生成脚本中固定。

**手动控制**：`apn-auto off` 关闭自动切换（改用手动 APN 时先关掉）；`apn-auto apply` 立即按识别结果切换；数据库缺运营商时手动往 `/etc/apn-auto.db` 加一行 `mcc|mnc|apn|pdp|auth|user|pass|名称` 即可。

---

## 十一、稳定性迭代轮（2026-11-09 晚）

**背景**：晚高峰实测出现"连上一下又断"与"管理网站进不去"两类反馈，逐层排查后收敛为 4 个根因，全部修复：

| 根因 | 表现 | 修复 |
|---|---|---|
| band-auto v1 锁死单频段 | 锁 n1 后掉信号即无退路，反复断网 | **v2 手机式重写**：默认全频段自动；仅快 15% 且 ≥10Mbps 才干预；锁「频段组」（组内可自动切换）；掉网 2 次/2 小时 TTL 双保险自动解锁 |
| 扫描后 PDN 未恢复 | 逐段切频打断数据连接，扫完不重连 | 扫描结束自动验证 PDP + 补修 APN；自动模式掉网连续 2 次也自愈重连 |
| 扫描期间 portal 弹窗劫持 | 切频每段断 ~25s，portal 15s 就弹 captive portal，浏览器被劫持（"网站进不去"的真身） | portal-watch 检测 `/tmp/band-auto.scan` 标志：扫描期间抑制弹窗（已弹的强制关闭） |
| 拥塞时过度扫描 | "全网都慢"结论只冷却 30min，晚高峰每半小时断线扫一轮 | too-slow-no-lock 并入 2h 长冷却；扫描后清零信号差计数；探针 5MB→2MB 省流量 |

**顺带修复**：LuCI 登录会话时长澄清与加固——`luci.sauth.sessiontime` 本就是 3600s（1 小时，早前"6 分钟过期"是误读 rpcd 执行超时）；rpcd 执行超时 360→600s（固件硬上限，设 3600 会 crash loop——`killall rpcd` 后重启才能干净注册 session 对象，只看 ps 不够）。

**体检基线（修复后全绿）**：OpenWrt 25.12.5，内存 33/203MB，温度 35-36°C，CMHK pdp_active，手机式自动选频无锁，portal OFF，只读锁生效，dmesg 零 undervolt（电容改装后供电干净）。

---

## 八、经验教训（可复用方法论）

1. **先备份后动手**：全量 mtd + 卷级逻辑备份 + MD5 双向核对，是后面敢刷敢修的底气。本次 SPL 变砖能救回，全靠 mtd0.img。
2. **判据要客观**：方向性问题看计数器（tx_packets），不看 ping；写入是否成功看回读 MD5，不看 dd 返回值。
3. **协议代码先自测再连设备**：`-SelfTest` 金帧校验（本次 10 项）避免了大量"设备娇气"的误判——实际多数是自己的 CRC 算错。
4. **给测试留安全网**：任何可能失联的改动（切 USB 模式、动网络）都预设自动回退（定时重启/看门狗标记文件）。
5. **区分"枚举成功"与"数据面通"**：网卡出现 ≠ 能收发包，必须逐向验证。
6. **社区同源项目价值巨大**：R106 FDL、sy108-mainline OpenWrt、4bitFox 救砖指南、xg_multi 方案——但**分区表/参数绝不可照搬**，必须本机实测核对。
7. **写文档实时跟上**：本项目的踩坑记录（工作日志）让 24 小时内的 30+ 个坑全部有据可查，本报告即由此提炼。

---

*报告完。文件索引见同目录 `README_文件索引.md`。*
