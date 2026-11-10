# 对比原作者：本仓库的改动与增强清单

基线：[jason-liu-4980/sy108-mainline](https://github.com/jason-liu-4980/sy108-mainline) 首个公开版本
（2026-10-18 源码 / 2026-10-28 xuxin1955 云编译固件），在**另一台 SY108 实机**（某品牌旗舰手机配套款）上适配验证。

原作者在 README 中自述：仅基于一台硬件适配、仅实测过中国联通卡、USB 3.0 SuperSpeed 偶发不稳。
以下条目正是在这个"单机验证"基础上的增量工作——同款不同批次硬件差异是真实存在的。

---

## A. 硬件兼容性（最有复用价值）

### A1. DTB 修复：`dr_mode="otg"` → `peripheral` ⭐核心贡献
- **现象**：刷入原版固件后 USB 功能完全不起，Windows/macOS 全部无法识别，设备只能靠 WiFi 进。
- **根因**：`main.dtb` 中 USB 节点 `dr_mode="otg"`，本批次硬件的 `dwc3-of-simple` 驱动拒绝绑定（error -95），UDC 无法 configured。
- **修复**：将 `dr_mode` 改为 `peripheral`，把 `usb-role-switch`、`role-switch-default-mode`、`sprd,pamu3-offload` 等属性替换为 FDT_NOP，重算 `dtb_crc` / `header_crc`，镜像总长不变。
- **工具**：`tools/dtb-fix/fix_capsule.py`（含 DTB 解析/对比工具 `fdt2.py`、`dtbdiff.py`）。
- **意义**：证明上游"仅单机验证"的自述属实，同款硬件存在批次差异；其他遇到 USB 全死的用户可直接复用此修复。

### A2. USB 跨平台验证矩阵
上游只提到 Windows 可用。本仓库补充实测：Windows 10/11、macOS、iPadOS、Android 全部免驱（CDC NCM，`ncm-software` profile），并给出 Windows 侧路由 metric 调整工具（`tools/windows/`）让 WiFi 优先、USB 保留直连调试。

## B. 蜂窝网络适配

### B1. CMHK（中国移动香港）实体卡适配
- 原作者仅实测中国联通；本仓库验证了香港 CMHK 实体 SIM：**APN `cmhk` + PDP `IPV4V6` + 认证 `none`**（auto 模式会错误选成 Webbing `wbdata`，双栈激活需约 25 秒属正常）。
- 排错记录（CME ERROR 149/28 等）见 `docs/project-report.md`。

### B2. APN 自动识别系统（原版没有）⭐
- `tools/device/apn-auto.sh`：读 SIM IMSI（MCC+MNC）→ 查表 → 自动应用 APN，对标 Android/oFono 机制。
- 配套数据库：`apn-auto.db`（1029 个运营商，源自 LineageOS `apns-conf.xml`，含本机实测覆盖条目）+ `apn-country.db`（167 国中文名）。
- 换卡自动检测（cron + 开机钩子，ICCID 变化才动作，查不到的运营商保持现状——安全兜底）。

### B3. 智能选频 `band-auto` v2（原版没有）⭐
- **手机式自动为主**：默认不锁频，基带全频段自由切换（掉一个频段自动回退别的频段，不会一掉就没网）。
- 信号持续差时才逐频段实测下载速率，**速率优先、信号次之**；快 15% 且实测 ≥10Mbps 才干预（全网拥塞样本不可靠就不锁）。
- 干预时锁定的是**频段组**（赢家 + 实测相近频段，最多 3 个，组内可自动切换），而非单频段——v1 曾因锁死单频段 n1 导致掉信号即断网。
- 三重保险：锁定 2h 自动解锁（TTL）；锁定期间掉网连续 2 次立即解锁回 auto（看门狗）；只管理 band-auto 自己上的锁，不干扰手动 `bandlock`。
- 重要发现：**信号好 ≠ 网速快**（实测 n78 信号 -78dBm 仅 23Mbps，n79 信号 -96dBm 却 47Mbps，取决于小区拥挤度），因此必须速率探针而不是看信号格数。
- 附带 `bandlock` 工具（支持单频段 / `g=n78,n79` 频段组 / auto，含开机恢复锁定，弥补 ubus `band_lock` 不进配置的缺陷）。
- 扫描期间状态页显示"正在优化网络"提示条，避免误报网络故障。
- 扫描后自愈：扫描结束自动验证 PDP 并补修 APN（逐段切频会打断数据连接）；自动模式下掉网连续 2 次也自动重连。
- 防过度扫描：全网拥塞结论（too-slow-no-lock）与维持现状一样进 2 小时长冷却；扫描后清零"信号差"计数，避免冷却一到立刻重扫；速率探针 5MB→2MB（单轮扫描流量 -60%）。
- **2026-11-10 稳定性修复**（实机复现后补）：
  1. **无卡期间不再攒「信号差」计数**：旧逻辑只看 SINR/RSRP，没 SIM 时读到 -99/-140 占位值，每 5 分钟 `POOR+1`；插卡瞬间立刻触发一轮 7~8 分钟全频段扫描，把刚注册好的网络反复锁崩。现在 `cell.state` 为 `waiting_sim` / `connecting` / `waiting_registration` 时直接清零计数并跳过扫描，看门狗也不再做无效 APN 重试。
  2. **扫描中间态不再落盘**：逐频段测试原先调用 `bandlock <频段>`，会把单频段写进 `/etc/bandlock.mode`；一旦扫描被 kill/断电/重启中断，该频段（可能是无覆盖的 n28/n3）会被 `rc.local` 开机永久恢复，导致开机即断网。现在改用 `scan_lock()` 直接走 ubus，不写持久化标记。
  3. **异常退出 trap 补解锁**：kill / 断电时自动 `bandlock auto` + 清 HOLD 文件，保证回到手机式全频段。

## C. 用户体验（原版没有的免登录状态页体系）

| 功能 | 说明 |
|---|---|
| 免登录状态页 | `http://192.168.66.1/` 中文白话界面，每项带小字说明，普通人可读；技术细节（PCI/RSRQ/ARFCN）收进折叠行 |
| 运营商识别显示 | 自动显示「运营商 · 国家」（接 apn-auto 数据库） |
| 流量统计 | 本次/累计流量，**跨重启累计**；针对无电池设备的断电场景做了原子写入 + 回绕立即持久化加固 |
| 网速体验 | 「快/一般/慢」人话评级，不用看数字 |
| Captive portal | 断网自动弹状态页（nft 拦 HTTP 探测 DNAT 到本地 portal），联网时不打扰；**band-auto 扫描期间抑制弹窗**（扫描切频必然短暂掉网，不弹就不劫持浏览） |
| LuCI 只读锁 | root/view 网页端只读防误改（SSH 保留写权限，`luci-write on|off` 临时解锁） |

## D. 工程与救砖

- **无按键救砖手册** + SPD/FDL 工具链整理（`unisoc-reboot autodloader` 会擦 SPL、PowerShell `-shl` 导致 CRC 算 0 等坑位记录，见 `docs/project-report.md`）。
- MTD 读取必须 `bs=2048`、分区表偏移等实操细节。
- 时区修正（HKT）、登录按钮相对路径等小修。

## E. 有意不改动的部分

- **核心系统**（内核、蜂窝守护进程、LuCI 框架、启动链）全部保持原作者设计，未做重构。
- 未启用 `sprd,pamu3-offload`（USB3 硬件加速）：SSH 走 USB，改动风险大于收益；上游也自述 SuperSpeed 不稳。

---

## 一句话总结

**系统是 jason-liu-4980 的；本仓库贡献的是"另一台机器上跑起来"的全部增量：DTB 兼容修复（A1）+ CMHK/自动 APN（B）+ 智能选频（B3）+ 免登录状态页体系（C）+ 救砖文档（D）。**
