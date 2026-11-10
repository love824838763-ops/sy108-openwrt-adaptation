# SY108 5G 通信壳 OpenWrt 适配笔记与工具

> **⚠️ 重要声明（请先读）**
>
> 本仓库 **不是** SY108 的 OpenWrt 系统本身，也不主张任何原创系统的所有权。
> 真正的系统属于以下原作者，本仓库只是**第三方适配笔记、兼容性修复工具和辅助脚本**的集合：
>
> | 组成 | 原作者 / 来源 |
> |---|---|
> | OpenWrt 平台 + 用户态服务（蜂窝/AT/短信/LuCI） | [jason-liu-4980/sy108-mainline](https://github.com/jason-liu-4980/sy108-mainline) |
> | UDX710 内核驱动与设备树（Linux 7.3.0） | jason-liu-4980 的 `linux-udx710` |
> | SPL + U-Boot 启动器 | jason-liu-4980 的 `sy108-uboot-spl` |
> | 成品固件云编译 | [xuxin1955/Actions-immortalwrt](https://github.com/xuxin1955/Actions-immortalwrt) Releases |
> | APN 数据库 | LineageOS `apns-conf.xml`（Apache-2.0） |
>
> 首次公开：源码 2026-10-18（jason-liu-4980），成品固件 2026-10-28（xuxin1955）。
> 详细致谢见 [CREDITS.md](CREDITS.md)。使用本仓库前请遵守各上游项目的许可证。

English: adaptation notes and helper tools for running OpenWrt on the Soyealink SY108 5G phone case
(UNISOC UDX710). **The core system is NOT ours** — it belongs to
[jason-liu-4980/sy108-mainline](https://github.com/jason-liu-4980/sy108-mainline). What is here:
a DTB fix that brings a dead USB port back, carrier/APN adaptation, band selection, a login-free
status page, a graded LuCI guard, and Windows routing helpers. See [CREDITS.md](CREDITS.md).

---

## 这个仓库解决什么问题

上游固件在一台机器上验证通过，换到另一台同款硬件时出现了 USB 全死。本仓库是**在第二台实机上的适配增量**：

| 问题 | 解决 | 位置 |
|---|---|---|
| 刷完 USB 完全不识别（`/sys/class/udc/` 空、`dwc3` error -95） | 修 DTB：`dr_mode` otg→peripheral，NOP role-switch 属性，重算 CRC | [`tools/dtb-fix/`](tools/dtb-fix/README.md) |
| 换张卡要手动配 APN | 按 IMSI 的 MCC/MNC 查表自动切 APN，换卡自动检测 | [`tools/device/`](tools/device/README.md) |
| 频段选得差、掉速 | 智能选频：默认自动，只在明确更优时锁「频段组」 | [`tools/device/`](tools/device/README.md) |
| 想看状态但没有登录态 | 免登录状态页 + 断网引导页，中英双语 | [`tools/device/`](tools/device/README.md) |
| LuCI 要么全开放要么全锁死 | 分级守卫：普通设置放行，危险操作红色确认 | [`tools/device/`](tools/device/README.md) |
| 插上 USB 后电脑不走 WiFi / 不出网 | Windows 路由与度量脚本 | [`tools/windows/`](tools/windows/README.md) |

改动对比原作者的完整清单见 [IMPROVEMENTS.md](IMPROVEMENTS.md)（A 硬件兼容 / B 蜂窝适配 / C 界面与管控 / D 工程救砖）。

## 快速开始

前提：设备已刷入上游 OpenWrt 固件，能通过 USB 网卡访问 `192.168.66.1`，SSH 可登录。

```bash
# 0) 电脑侧依赖（只影响传输工具，设备端脚本是纯 shell）
pip install paramiko

# 1) 克隆
git clone https://github.com/love824838763-ops/sy108-openwrt-adaptation.git
cd sy108-openwrt-adaptation

# 2) 先确认 USB 是否正常 —— 不正常就先做 DTB 修复，别往下走
ssh root@192.168.66.1 'ls /sys/class/udc/'
#   有内容 → 跳过 DTB；空 → 见 tools/dtb-fix/README.md

# 3) 上传并部署状态页 / 引导页 / 分级守卫（幂等，自动备份原件）
#    设备固件的 dropbear 没有 sftp，scp/sftp 都不可用，用附带的 rput.py
for f in tools/device/*; do
  [ -f "$f" ] && python tools/device/rput.py "$f" "/tmp/sy108-ui/$(basename $f)"
done
python tools/device/rsh.py 'sh /tmp/sy108-ui/install-web-ui.sh'

# 4) 蜂窝（可选）：先只看不改
python tools/device/rsh.py 'sh /tmp/sy108-ui/apn-auto.sh show'
python tools/device/rsh.py 'sh /tmp/sy108-ui/bandlock.sh status'

# 5) 电脑侧路由（Windows，管理员运行）
#    tools/windows/usb-net-setup.bat   → 上网走 WiFi，USB 仍可管设备
```

部署脚本末尾会打印 6 项 HTTP 自检。回滚方式见 [tools/device/README.md](tools/device/README.md#回滚)。

## 文档地图

| 文档 | 内容 |
|---|---|
| [IMPROVEMENTS.md](IMPROVEMENTS.md) | **对比原作者的改动清单**，每条含现象、根因、验证。想知道「做了什么」看这里 |
| [docs/project-report.md](docs/project-report.md) | 完整踩坑记录：分区布局、刷机流程、十个坑与解法 |
| [docs/compatibility.md](docs/compatibility.md) | 原厂系统详解 + 全部已知不兼容点 |
| [docs/solder-guide.md](docs/solder-guide.md) | 供电改造与焊接位置 |
| [tools/dtb-fix/README.md](tools/dtb-fix/README.md) | USB 全死的修复流程，以及两个**换固件必须重新定位**的偏移量 |
| [tools/device/README.md](tools/device/README.md) | 设备端脚本逐个说明、部署位置、三条红线、回滚命令 |
| [tools/windows/README.md](tools/windows/README.md) | 三个路由脚本的差别与适用场景 |
| [CREDITS.md](CREDITS.md) | 致谢与出处 |

## 设备与实测环境

- **设备**：Soyealink SY108-688 5G 通信壳（保护壳形态的 5G 模块，配套某品牌旗舰手机，具体适配机型以实物铭牌为准；UNISOC UDX710 平台，512MB RAM，2022 年前后国内运营商定制款）
- **原厂系统**：Linux 4.14.98（厂商内核）+ ofono + 自研 8080 Web 后台，USB 仅 RNDIS（只有 Windows 认）
- **目标**：刷入 OpenWrt 后作为 USB NCM 网卡 + 便携路由器使用，Windows / macOS / iPadOS / Android 免驱
- **实测环境**：中国香港 CMHK 实体 SIM（本仓库的蜂窝参数以该卡为准，作者原版仅实测过中国联通）
- **状态页**：`http://192.168.66.1/`，免登录，中/英切换，五栏（概览 / 信号 / 功率 / 设备 / 关于）。含实时速率、上行发射状态、耗电估算、刷机日期与累计通电运行。**功率与耗电是只读估算，不是实测**，见 [IMPROVEMENTS.md](IMPROVEMENTS.md) C2 / C3 节
- **管理后台**：`http://192.168.66.1/cgi-bin/luci/`。普通设置直接放行；危险操作弹红色确认并写明「不能怎么设置 / 会导致什么」；恢复出厂与刷机需输入确认词。恢复出厂入口：**System → System maintenance**
- **一键部署**：`tools/device/install-web-ui.sh`（幂等，7 步流程，末尾 6 项 HTTP 自检）

**不包含**（有意排除）：固件二进制、工厂镜像/备份、拆解照片（版权归原文所有，见 CREDITS）、任何个人信息（IMSI / ICCID / 本机路径等已脱敏）。

## 已验证 / 未验证

诚实标注边界，避免误用：

| 项 | 状态 |
|---|---|
| DTB 修复 | ✅ 本机实测：修复后 Windows / macOS / Linux 均识别为 NCM 网卡 |
| APN 自动识别 | ✅ CMHK 实测；其他运营商依赖数据库覆盖，未逐一验证 |
| 智能选频 | ✅ 实测可用；代价是切频瞬间断流数秒 |
| 状态页 / 引导页 | ✅ 四平台浏览器 + 中英 + 浅深主题；390px 窄屏逐屏核对 |
| LuCI 分级守卫 | ✅ 守卫逻辑 DOM 自检 15/15；登录页浅深 × 中英四组截图确认 |
| LuCI **内页**视觉 | ⚠️ 只改了颜色令牌与图标，未做像素级验证（该主题视图懒加载，无头浏览器截不到内页） |
| Windows 路由脚本 | ✅ 本机 Win11 实测；其他版本行为可能不同 |
| 其他批次硬件 | ❌ 未验证。DTB 差异恰恰说明同款不同批次可能不一样，请先确认症状与本仓库一致 |

## 风险提示与免责声明

- **本仓库按"现状"提供，不作任何明示或暗示的担保**。刷机、改 DTB、拆机焊接均有**变砖 / 损坏 / 失去保修风险**，操作前务必完整备份（尤其 SPL 分区，变砖后唯一救星）；因操作本仓库内容造成的任何损失，贡献者不承担责任。
- 上游项目自述仅在一台硬件上验证；本仓库的 DTB 修复恰恰证明**同款不同批次存在差异**——其他批次设备可能需要不同的适配。
- 本仓库不提供固件包，请到上游 Releases 获取，或自行按上游文档编译；使用前请遵守各上游项目的许可证。
- 修改设备射频/网络配置可能受当地法规约束，使用者自行确保合规。

## License

本仓库自有代码（脚本/工具/文档）采用 [MIT License](LICENSE)。
其中包含的第三方内容（如 LineageOS APN 数据库）版权归其各自所有者，见 [CREDITS.md](CREDITS.md)。
