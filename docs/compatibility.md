# 原厂系统是什么 & 已知不兼容清单（详细版）

> 本文回答两个问题：①这个壳刷 OpenWrt 之前跑的是什么系统；②哪些地方不兼容、为什么。
> 所有结论均有实机证据（ADB shell / 内核日志 / 实测计数器），推测项已标注。

---

## 一、原厂系统是什么

### 1.1 硬件身份

| 项 | 值 | 证据来源 |
|---|---|---|
| 产品 | Soyealink/数源 SY108-688 **5G 通信壳**（保护壳形态的 5G 模块，配套某品牌旗舰手机；具体适配机型请以实物铭牌为准） | 实物铭牌/形态 |
| SoC | UNISOC UDX710（展讯），aarch64，512 MB RAM，256 MiB NAND | ADB `uname -a` / bootargs |
| USB 身份 | `VID_1782&PID_4038`（展讯 RNDIS） | Windows 设备管理器 PNPDeviceID |
| 主机名 | `udx710-module` | ADB shell |

### 1.2 原厂软件栈（刷机前的"原来是什系统"）

```
┌─────────────────────────────────────────────┐
│  自研 Web 管理后台（Go + Vue，闭源）端口 8080   │  ← 管理界面"5G MIFI"
├─────────────────────────────────────────────┤
│  ofono 蜂窝栈 + connman 网络管理             │  ← 管 SIM/PDP/网络
├─────────────────────────────────────────────┤
│  Linux 4.14.98（UNISOC 厂商内核）+ busybox   │  ← 无 bash / 无 nohup / 无 timeout
├─────────────────────────────────────────────┤
│  USB gadget：仅 RNDIS（PID 0x4038）          │  ← 只有 Windows 能联网
└─────────────────────────────────────────────┘
```

- **定位**：2022 年前后国内运营商定制的"通信壳"——套在手机上给手机/电脑共享 5G 流量，无内置电池（拔 USB 线 = 断电重启）。
- **SIM 方案**：原厂是 eSIM（壳内 ofono 留有多个历史 eSIM profile）；本机是**改装卡槽**插实体 SIM（见焊接/拆解归档）。
- **进入方式**：USB 网关 `192.168.66.1`，开放 8080（Web 后台）与 5555（ADB root 免授权）——本项目全部摸底工作从这里入手。
- **原厂 Web 后台是带病的**：`/api/get/sysinfo` 崩溃（脚本调用 bash，设备只有 busybox sh）；`/api/get/network` 崩溃（ofono 版本缺 `GetServingCellInformation` 方法）；只有 `/api/get/reg` 正常。

### 1.3 现在跑的是什么（对比）

| | 原厂 | 现在（OpenWrt） |
|---|---|---|
| 内核 | Linux 4.14.98（厂商） | Linux 7.3.0（主线，jason-liu-4980 移植） |
| 系统 | 闭源 BusyBox 用户态 + 自研后台 | OpenWrt 25.12.5 + LuCI + ofono 替代品（udx-cellulard） |
| USB 网卡 | RNDIS（仅 Windows） | CDC-NCM（Win/macOS/iPadOS/Android 全免驱） |
| 来源 | 厂商出厂 | [jason-liu-4980/sy108-mainline](https://github.com/jason-liu-4980/sy108-mainline)（2026-10-18 首发）+ xuxin1955 云编译固件（2026-10-28） |

原厂系统已做**全量备份**（mtd0~7 + 9 个 UBI 卷，MD5 核对），随时可救回（见 `docs/project-report.md` 第六节）。

---

## 二、兼容性矩阵（实测）

### 2.1 主机识别

| 主机 | 原厂 RNDIS | 现在（NCM） |
|---|---|---|
| Windows 10/11 | ✅ 免驱 | ✅ 免驱（UsbNcm Host Device） |
| macOS | ❌ 不识别 | ✅ 免驱 |
| iPadOS | ❌ 不识别 | ✅ 免驱 |
| Android | ❌ 不识别 | ✅ 免驱（OTG 供电不稳需加电容，见 3.5） |

### 2.2 运营商

- **实测**：中国香港 CMHK 实体卡（APN `cmhk` + `IPV4V6` + `none`，下行最高 205 Mbps）。
- **原作者实测**：中国联通。
- **APN 自动识别库**：1029 个运营商（LineageOS `apns-conf.xml` 派生），查表即可自动适配，未逐卡实测。

---

## 三、已知不兼容 / 坑点详解

### 3.1 原厂 4.14 内核 USB 模式"全死路"（→ 刷 OpenWrt 的根本原因）

想让 Mac/iPad 也认，先试过原厂固件改 USB 模式，**全部失败**：

| 模式 | 枚举 | 数据面 | 根因（有日志证据） |
|---|---|---|---|
| RNDIS（mode 3）| ✅ 仅 Windows | ✅ | 默认模式，别家系统不认 RNDIS |
| NCM（mode 1）| ✅ 识别为 UsbNcm | ❌ RX 全丢 | 内核日志刷 `Wrong NDP SIGN`：`f_ncm.c` 的 `ndp_sign` 只在 `SET_NTB_FORMAT` 分支赋值，Windows 从不发该请求 → 校验失败全丢包。**Linux v5.18+ 已修**，4.14 无解（3 行补丁需重编内核，风险高） |
| ECM（mode 2）| ✅（Windows Code 28 无驱动）| ❌ TX 冻结 | `tx_packets` 永不增长，包在进发送队列前被丢（`f_ecm in_ep->enabled=false` 路径），用户态无解 |

附加坑：
- **Windows 不支持 USB 双 configuration**，"ECM+RNDIS 并存"不可行（xg_multi 探测重建方案也救不了死掉的数据面）。
- **模式改了会被强制还原**：`/etc/init.d/hostname.sh` 每次开机 `echo 3 > /mnt/data/mode.cfg` 硬编码写回 RNDIS。
- 厂商 `usbenum.sh mode2` 在本固件上残缺（`isself: not found`），切模式直接 USB 全死。

**结论：原厂固件下跨平台联网无解，必须换内核 → 引出 OpenWrt 路线。**

### 3.2 同款不同批次的 DTB 差异 ⭐（本仓库核心修复）

- **现象**：刷入原版 OpenWrt 固件后 USB 功能完全不起（`/sys/class/udc/` 空），Win/mac 全部无法识别，只能靠 WiFi 进。
- **根因**：`main.dtb` USB 节点 `dr_mode="otg"`，本批次硬件的 `dwc3-of-simple` 驱动拒绝绑定（error -95）。
- **修复**：`dr_mode` 改 `peripheral` + NOP 掉 3 个属性 + 重算 `dtb_crc`/`header_crc`（`tools/dtb-fix/fix_capsule.py`）。
- **意义**：上游自述"仅一台硬件验证"属实——**同款不同批次确实存在差异**，其他 USB 全死的用户可直接复用此修复。

### 3.3 分区表：社区 R106 方案不能照搬 ⚠️

- 本机 `trustos` 128 KiB vs R106 的 1024 KiB，`ubipac` 起点偏移差 1.75 MiB——**按 R106 的分区 XML 写入必错位变砖**。
- 救砖时 FDL2 进去**第一条必须 `p` 核对真实分区表**（详见 `docs/project-report.md` 3.3）。

### 3.4 蜂窝/运营商不兼容点

| 现象 | 根因 | 解决 |
|---|---|---|
| 配了 `wbdata` 一直不通 | auto 模式误选 Webbing（MVNO）APN，本卡是 CMHK | 读 SIM EF_SPN 确认 `cmhk`；已由 apn-auto 自动化 |
| CME ERROR 149/28 | CMHK 双栈不接受 `pdp_type=IP` | 必须 `IPV4V6` |
| AT 响应"超时" | CMHK 双栈激活要约 25 秒 | 属正常慢响应，等待即可 |
| `AT+CNMP?` 报 CME 4 | 本 modem 不支持该查询 | 锁网用 `AT+COPS=1,2,"45412",7` |
| 信号只显示 `csq:99` | 常规 status 无 RSRP/SINR | 走 `serving_refresh` 异步 + 缓存（已进状态页） |

### 3.5 硬件层不兼容/限制

| 项 | 影响 | 对策 |
|---|---|---|
| **无按键、无 RESET 孔** | 变砖后不能靠按键进下载模式 | 免按键救砖链（冷上电 boot_diag 窗口），见报告 3.3 |
| **总线供电、无内置电池** | 拔 USB 线 = 断电重启；断电丢时钟/统计 | 流量统计原子写 + 回绕持久化；测试预设自动重启安全网 |
| **Android OTG 供电不稳** | 安卓插上连一下就掉 | USB-C 供电入口焊 **10V 1000µF** 电容（见 `docs/solder-guide.md`），实测通过 |
| **mtd0 SPL 无备份分区** | 擦了就是砖（唯一救星是事前备份） | 永远不要执行 `unisoc-reboot autodloader` |
| USB3 SuperSpeed 偶发不稳 | 上游自述；实际枚举 high-speed（426 Mbps 显示值） | 未启用 `sprd,pamu3-offload`（SSH 走 USB，风险>收益）；130 Mbps 未顶到 USB2 上限 |

### 3.6 软件/工具链零星不兼容

- 设备**无 bash**（只有 busybox sh/ash）：任何依赖 bash 的脚本/后台都会崩（原厂 8080 后台即死于此）。
- busybox **无 nohup / adduser / timeout**：后台任务需 `start-stop-daemon --background` 或 `trap "" HUP` 变通。
- OpenWrt dropbear **无 sftp 子系统**：文件传输用 `tools/device/rput.py`（SSH stdin 上传）。
- LuCI 未登录返回 **403** 是该版本正常行为（登录框照常显示），不是坏了。
- rpcd **执行超时上限 600 秒**（设 3600 会 crash loop）；登录会话超时是另一配置（`luci.sauth.sessiontime`，默认 3600 秒 = 1 小时）。

---

*本文为 `docs/project-report.md` 的精简导读版；完整 50+ 坑与救砖细节见该报告。*
