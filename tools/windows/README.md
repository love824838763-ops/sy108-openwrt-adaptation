# `tools/windows/` — Windows 侧路由与优先级小工具

双击 `.bat` 即可（`.bat` 只是用 `-ExecutionPolicy Bypass` 起同名 `.ps1`，方便绕过默认执行策略）。
**都需要管理员权限**（改路由和网卡设置要提权）。运行结果写在同目录 `*-result.txt`。

## 为什么需要这些

插上 USB 网卡后，Windows 会同时存在两条默认路由：WiFi 和 USB，而且经常出现**电脑不出网**或
「明明连着 WiFi 却走了很慢的 USB」。典型诱因：

- USB 网卡接口度量（metric）低于 WiFi → 所有流量都往 USB 走
- 曾经拔掉的网卡留下了「幽灵默认路由」，指向一个已经不存在的网关
- 网卡节能把 USB 网卡休眠，链路断断续续

## 三个脚本

| 脚本 | 做什么 | 什么时候用 |
|---|---|---|
| `usb-net-setup` | USB 度量设 **90**、补一条 `0.0.0.0/0 via 192.168.66.1`（metric 90）、清理幽灵路由、关网卡节能 | **上网走 WiFi，但仍要能访问状态页 / SSH** 的推荐配置。USB 保留路由是为了让 Windows 对 USB 做 NCSI 探测（才能正确识别「已连接」） |
| `usb-noroute` | 删掉 USB 网卡上的默认路由，保留 `192.168.66.0/24` 直连 | **完全不让 USB 承载任何上网流量**，只用来管理设备（状态页、SSH） |
| `wifiprio` | USB 度量设 **60**、关节能、清幽灵路由 | 反过来：**让 USB（5G 卡）当主出口**，WiFi 只作管理/备份 |

> 度量数值越小优先级越高。Windows 自动度量通常给 WiFi 约 30–50、USB 以太网约 25–35，
> 所以默认情况下 USB 常常抢走默认路由——这正是需要手动指定的原因。

## 用法

```
右键 usb-net-setup.bat → 以管理员身份运行
查看同目录 usb-net-setup-result.txt 里的 final default routes 段确认结果
```

关键输出长这样，能一眼看出谁在承载流量：

```
--- final default routes ---
  via 192.168.1.1   alias=WLAN       routeMetric=0   if=12
  via 192.168.66.1  alias=以太网 3   routeMetric=90  if=18
```

## 注意

- `Set-NetIPInterface` / `New-NetRoute` 在部分系统上会被策略拒绝（事件里能看到
  `The request is not supported`），脚本会把失败原因写进 `*-result.txt` 而不是静默跳过。
- 不要同时跑 `usb-noroute` 和 `usb-net-setup`，两者对 USB 默认路由的处理是相反的，后跑的生效。
- 这些设置是**运行时**的，重启或重新插拔网卡后可能被系统覆盖，需要时重跑一次。
- 针对 USB 网卡的识别条件是 `InterfaceDescription` 含 `Ncm` 或 `RNDIS`。若你的固件把
  USB 模式切成 MBIM/ECM，需自行调整匹配条件。
