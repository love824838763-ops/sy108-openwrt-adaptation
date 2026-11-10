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

English summary: Adaptation notes and auxiliary tools for running OpenWrt on the Soyealink SY108 5G phone case (UNISOC UDX710). **The core system is NOT ours** — it belongs to [jason-liu-4980/sy108-mainline](https://github.com/jason-liu-4980/sy108-mainline). This repo only contains a DTB compatibility fix, carrier adaptation notes, and helper scripts. See [CREDITS.md](CREDITS.md).

---

## 本仓库包含什么

全部内容是在 jason-liu-4980 首个公开版本（2026-10-28 固件）基础上，于**另一台实机**上适配验证的增量工作。详见 [IMPROVEMENTS.md](IMPROVEMENTS.md)（对比原作者做了哪些改动/增强）。

| 目录 | 内容 |
|---|---|
| `tools/dtb-fix/` | **DTB 兼容性修复工具**（`fix_capsule.py` 等）——修复 `dr_mode="otg"` 导致 USB 全死的问题，本仓库最有复用价值的部分 |
| `tools/device/` | 设备端辅助脚本：自动 APN 识别、智能选频、免登录状态页、captive portal、LuCI 只读锁等 |
| `tools/windows/` | Windows 侧路由/优先级小工具 |
| `docs/` | 项目总报告（踩坑记录）、[原厂系统与不兼容清单](docs/compatibility.md)、供电电容焊接指南 |

**不包含**（有意排除）：固件二进制、工厂镜像/备份、拆解照片（版权归原文所有，见 CREDITS）、任何个人信息（IMSI/ICCID/本机路径等已脱敏）。

## 快速了解

- **设备**：Soyealink SY108-688 5G 通信壳（保护壳形态的 5G 模块，配套某品牌旗舰手机，具体适配机型以实物铭牌为准；UNISOC UDX710 平台，512MB RAM，2022 年前后国内运营商定制款）
- **原厂系统**：Linux 4.14.98（厂商内核）+ ofono + 自研 8080 Web 后台，USB 仅 RNDIS（只有 Windows 能用）——详见 [docs/compatibility.md](docs/compatibility.md)（原厂系统详解 + 全部已知不兼容点）
- **目标**：刷入 OpenWrt 后作为 USB NCM 网卡 + 便携路由器使用，Windows/macOS/iPadOS/Android 免驱
- **实测环境**：中国香港 CMHK 实体 SIM（本仓库的蜂窝参数以该卡为准，作者原版仅实测过中国联通）
- **状态页**：`http://192.168.66.1/`（免登录，中文白话界面；含信号质量、实时速率、上行发射状态与耗电估算，均为只读监测，详见 [IMPROVEMENTS.md](IMPROVEMENTS.md) C2 节）

## 风险提示与免责声明

- **本仓库按"现状"提供，不作任何明示或暗示的担保**。刷机、改 DTB、拆机焊接均有**变砖/损坏/失去保修风险**，操作前务必完整备份（尤其 SPL 分区，变砖后唯一救星）；因操作本仓库内容造成的任何损失，贡献者不承担责任。
- 上游项目自述仅在一台硬件上验证；本仓库的 DTB 修复恰恰证明**同款不同批次存在差异**——其他批次设备可能需要不同的适配。
- 本仓库不提供固件包，请到上游 Releases 获取，或自行按上游文档编译；使用前请遵守各上游项目的许可证。
- 修改设备射频/网络配置可能受当地法规约束，使用者自行确保合规。

## License

本仓库自有代码（脚本/工具/文档）采用 [MIT License](LICENSE)。
其中包含的第三方内容（如 LineageOS APN 数据库）版权归其各自所有者，见 [CREDITS.md](CREDITS.md)。
