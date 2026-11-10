# 致谢与出处（CREDITS）

本仓库是社区成果的**二次适配**，一切核心能力归功于以下原作者与项目。若您认为任何内容的归属标注不准确，请开 Issue 指出，我们立即更正。

## 核心系统（本仓库运行所依赖，非本仓库所有）

| 项目 | 作者 | 说明 | 链接 |
|---|---|---|---|
| **sy108-mainline** | **jason-liu-4980** | SY108 OpenWrt 平台集成 + 用户态服务（蜂窝/AT/短信/LuCI 管理页）。2026-10-18 首次公开 | https://github.com/jason-liu-4980/sy108-mainline |
| **linux-udx710** | **jason-liu-4980** | UDX710 内核驱动与设备树（Linux 7.3.0）——解决原厂 4.14 内核 USB NCM/ECM 不可用的关键 | 同作者仓库 |
| **sy108-uboot-spl** | **jason-liu-4980** | SPL + U-Boot 启动器 | 同作者仓库 |
| 成品固件云编译 | **xuxin1955** | GitHub Actions 自动编译并发布固件包（tag `2026.10.28-*`，我们适配的基线） | https://github.com/xuxin1955/Actions-immortalwrt/releases |

## 上游逆向与工具链（原作者致谢过，此处一并列出）

- LeoChen-CoreMind / UDX710-TOOLS
- 1orz / project-cpe
- UnisocBypass
- spd_flasher
- 紫光展锐（UNISOC）开源 BSP

## 本仓库内包含的第三方内容

| 内容 | 来源 | 许可/说明 |
|---|---|---|
| `tools/device/apn-auto.db`（APN 数据库） | LineageOS `apns-conf.xml`（AOSP 派生） | Apache License 2.0；本仓库仅做格式转换（mcc\|mnc\|… 管道分隔）并追加少量实测覆盖条目 |
| `tools/device/apn-country.db`（MCC 国家表） | ITU E.212 MCC 分配 + 常见公开映射 | 事实性数据 |
| 硬件拆解/焊点信息（`docs/solder-guide.md`） | 公开拆解资料 + 魔改圈改装文章（PCB 型号 Dorado_Y1.00_PCB） | **仅文字描述，不搬运图片** |
| DTB 修复思路 | 本仓库作者的实机排错 | MIT（见 LICENSE） |

## 引用建议

如果您基于本仓库解决了问题并写文章/发帖，请同时提及上游：

> 系统来自 jason-liu-4980/sy108-mainline（固件由 xuxin1955 云编译），DTB 修复与适配工具来自本仓库。
