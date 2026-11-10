# `tools/device/` — 设备端脚本与页面

这里的文件**跑在 SY108 设备上**（OpenWrt / busybox ash），少数几个是**在电脑上跑**的传输工具。
全部为纯 shell / 静态前端，不依赖 Python（除标注「PC 侧」的脚本）。

```
把所有文件传到设备 /tmp/sy108-ui/ 后，一条命令完成 UI 与守卫部署：
  sh /tmp/sy108-ui/install-web-ui.sh
```

> ⚠️ 三条红线（违反要救砖或硬重启）
> 1. **绝不要 `stop udx-cellular`** —— 会触发 PMIC 看门狗硬重启。要测断网用 `portal-ctl force`。
> 2. **绝不要 `unisoc-reboot autodloader`** —— 会擦 splloader，而 mtd0 没有备份分区。
> 3. 锁频、改 APN 前先确认有可用的 SSH 通道，否则改完连不上设备只能拆机。

---

## 一、状态页与断网引导（部署到 `/www`）

| 文件 | 部署到 | 说明 |
|---|---|---|
| `index.html` | `/www/index.html` | 免登录状态页。五个栏目（概览 / 信号 / 功率 / 设备 / 关于），中英切换、浅深主题，全内联无外部依赖。数据来自 `sy108status.cgi` |
| `portal.html` | `/www/portal/index.html` | 断网引导页（`:88`）。5 秒自动复检，区分无卡 / 未注册 / 扫描中 / 已恢复，附排查步骤 |
| `sy108status.cgi` | `/www/cgi-bin/sy108status` | 状态 JSON 接口。输出信号、速率、流量、上行功率估算、耗电估算、系统信息 |
| `wanhealth.cgi` | `/www/cgi-bin/wanhealth` | 极简探针：蜂窝通了返回 `{"wan":1,"ip":"..."}`，否则 `{"wan":0}`。供**电脑侧**做自动故障切换用；无鉴权，仅 `br-usb` 可达 |
| `portal.cgi` | 参考实现 | 早期 captive portal 重定向入口：匹配 `*connecttest*` `*ncsi*` `*generate_204*` 等探测路径后 302 到状态页。当前方案已改为「nft DNAT 到 `127.0.0.1:88` + 引导页」，本文件保留作参考 |
| `example-ncsi-302.sh` | 参考实现 | **示例**：最简 NCSI 302 实现，看不懂 `portal.cgi` 时可参考这 6 行 |

## 二、蜂窝网络与选频（部署到 `/usr/bin`，加 cron）

| 文件 | 依赖 | 说明 |
|---|---|---|
| `apn-auto.sh` | `/etc/apn-auto.db`、`/etc/apn-country.db` | **按卡自动切 APN**。读取 IMSI 的 MCC/MNC 查表 → 应用运营商 APN/PDP/鉴权。`show` 看识别结果、`apply` 立即应用、`check` 供 cron 换卡检测、`on/off` 开关。查不到的运营商**保持现状**（安全兜底） |
| `apn-auto.db` | — | APN 库，格式 `mcc\|mnc\|apn\|pdp\|auth\|user\|pass\|carrier` |
| `apn-country.db` | — | MCC → 国家名映射，状态页显示「CMHK · 中国香港」用 |
| `band-auto.sh` | — | **智能选频**。像手机一样默认不锁频；只有信号持续差才扫描，且赢家需比当前快 15% 且实测 ≥10 Mbps 才锁定，并锁「频段组」而非单频段。`run` 周期检查、`scan` 强制扫描、`status`、`log` |
| `bandlock.sh` | — | **手动**锁频。`bandlock n79` 单频段、`bandlock g=n78,n79` 频段组、`bandlock auto` 恢复自动。设置记在 `/etc/bandlock.mode`，由 `rc.local` 开机恢复（`udx.band_lock` 本身不进 uci，重启会丢） |
| `runtime-tick.sh` | — | 累计通电运行时间采样器，cron 每 5 分钟。原理：`/proc/uptime` 重启归零，检测到回绕就把上一段累加。状态存 `/root/runtime.state` |

## 三、传输与调试工具（**PC 侧运行**，需要 `pip install paramiko`）

| 文件 | 用法 |
|---|---|
| `rsh.py` | `rsh.py "命令"` —— 执行远程 shell，打印 stdout 与 rc |
| `rput.py` | `rput.py <本地> <远程> [权限]` —— 经 SSH stdin 直写文件（无 sftp、无 base64，二进制安全） |
| `rget.py` | `rget.py <远程> <本地>` —— 下载文件，二进制安全 |
| `cellop.py` | `cellop.py <ubus方法> [json参数]` —— 调 `udx.cellular` 并等异步结果 |
| `atq.py` | `atq.py "AT+CSQ" "AT+COPS?"` —— 批量跑 AT 命令（走 `at_debug`，不是真串口） |

连接参数走环境变量，不用改代码：

```bash
export SY108_HOST=192.168.66.1   # 默认值
export SY108_PORT=22
export SY108_USER=root
export SY108_PASS=admin          # 设置了就只试这一个；不设置则依次试固件常见默认密码
```

> 设备固件的 dropbear **没有 sftp 子系统**，所以不能用 scp/sftp，必须走上面这几个脚本。

## 四、LuCI 权限、守卫与主题

| 文件 | 部署到 | 说明 |
|---|---|---|
| `luci-guard.js` | `/www/luci-static/sy108/luci-guard.js` | **分级守卫**。只拦六类动作：恢复出厂、刷机、重启、USB 模式、蜂窝服务、SSH 开关。其余设置静默放行。拦截时弹红色窗口，写明「不能怎么设置 / 会导致什么」；恢复出厂需输入 `RESET`、刷机需输入 `FLASH`。页面顶部另有一条可折叠的红线提醒 |
| `luci-write.sh` | `/usr/bin/luci-write` | 写权限总闸。`on`（默认）分级保护、`off` 应急全只读、`status` 查看。排查误改或临时借人时用 |
| `lock_luci.sh` | `/usr/bin/lock_luci`（可选） | 只添加 `view` 只读账户，不动 `root`。不想让人用 root 登后台时用 |
| `mkview.sh` | `/usr/bin/mkview`（可选） | 创建 `view` / `admin` 账户（密码同 root），配合上一条 |
| `luci-brand.css` | 追加到主题 `main.css` / `login.css` 末尾 | 品牌化覆盖块：主色 `#4f6bed`、图标尺寸、中文字体、滚动条、登录页标题替换。**可整段删除回滚** |
| `luci-theme-apply.sh` | 设备上直接运行 | 把 `luci-brand.css` 幂等地贴到 Outline / Aurora 主题（从标记行截断再追加，跑多次不会叠加），并替换 `logo.png` / `favicon.svg` |
| `assets/gen_logo.py` | PC 侧 | 生成图标：按状态页 `.mark` 的几何参数渲染 64/192/256 px PNG 与 SVG |
| `udx-signal-polish.css`<br>`udx-signal-polish.js` | `/www/luci-static/udx/` | 给上游信号看板外挂浅色模式与「← 设备状态」返回入口。原文件只插两行引用，不动逻辑 |

## 五、部署与维护

| 文件 | 说明 |
|---|---|
| `install-web-ui.sh` | **一键部署**（7 步）：备份原件 → 状态页/断网页/CGI → 信号看板外挂 → 守卫注入 → 解除 rpcd 全锁 → 累计运行采样 → 6 项 HTTP 校验。幂等，重复跑不会重复注入 |
| `portal-ctl.sh` | captive portal 开关：`on` / `off` / `status` / `force`（锁定当前状态，测试用）/ `unforce` |
| `portal-watch.sh` | 守护进程：断网 ≥15 秒才激活 portal，恢复后关闭。避免 5 秒自愈重拨造成抖动 |
| `portal-watch.init` | procd 服务定义，`/etc/init.d/portal-watch` |

### 回滚

所有覆盖操作的原件都在 `/root/ui-backup-<日期>/`，可直接 `cp` 回去。整个 UI 想退回原厂形态：

```sh
cp /root/ui-backup-*/www_index.html /www/index.html
# LuCI 主题：删掉 main.css / login.css 末尾的
# "/* --- SY108 UI consistency overlay" 之后整段即可
```

### 验证清单

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/                      # 状态页 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:88/                   # 引导页 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/cgi-bin/sy108status   # JSON 200
sh -n /www/cgi-bin/sy108status                                                  # 语法检查
```
