# `tools/dtb-fix/` — USB 全死的 DTB 修复

本仓库**最有复用价值**的部分：修 `dr_mode="otg"` 导致的 USB 完全不可用。

## 症状

刷入上游固件后，Windows / macOS / Linux 全部无法识别这个 USB 网卡，设备只能靠 WiFi 进 LuCI：

```
/sys/class/udc/            # 空
S50udx-usb                 # 报 Device controller absent
dmesg                      # dwc3-of-simple ... error -95
```

`-95` 是 `-EOPNOTSUPP`：`dwc3-of-simple` 驱动要求**明确**的主/从模式，而 DTB 里是 `dr_mode="otg"`，
再加上 `usb-role-switch` 相关属性后驱动拒绝绑定，`dwc3` core 从不创建 → UDC 不存在 → USB gadget 起不来。

## 修复

把 `dr_mode` 改成 `peripheral`，NOP 掉 3 个 role-switch 属性，重算 CRC，**保持镜像总长不变**：

| 步骤 | 动作 |
|---|---|
| 1 | 扫描 DTB struct 块，定位 `/soc/ipa-bus/usb3@29100000/usb@29100000` |
| 2 | 三个属性等长替换为 `FDT_NOP`（`usb-role-switch`、`role-switch-default-mode`、`sprd,pamu3-offload`），不影响任何偏移 |
| 3 | `dr_mode` 值 `otg\0`（4B）→ `peripheral\0`（11B），块变大 → 更新 header 的 `size_dt_struct`、`off_dt_strings`、`totalsize` |
| 4 | 回填进 `main_kernel.bin` 的 capsule，重算 `dtb_size` / `dtb_crc` / `header_crc` |
| 5 | 自检：三段 CRC 重算比对 + DTB 尾部必须全零 |

## 用法

```bash
cd tools/dtb-fix/
# 需要两个输入（从固件包里取，见下）
#   main.dtb
#   main_kernel.bin
python3 fix_capsule.py
# 产出
#   main_fixed.dtb          修好的 DTB（可单独用于 dtbdiff 验证）
#   main_kernel_fixed.bin   修好的内核镜像（刷这个）
```

## ⚠️ 两个常量是**固件版本专属**，换版本必须重新定位

```python
DTB_OFF_IN_KERNEL = 0x6CD200   # DTB 在 kernel 镜像中的偏移
KERNEL_TOTAL      = 7191040    # 镜像总长（脚本要求等长）
CAP_BASE          = 0xA00      # capsule 头位置
```

换固件后先跑 `parse_main.py` 打印 ANDROID 头与 capsule 头，确认新的 `dtb_size` / 偏移，再改这三个常量。
硬套旧偏移写进去 = 刷成砖。

## 配套分析工具

| 文件 | 用途 |
|---|---|
| `parse_main.py` | 解析 `main_kernel.bin` 的 ANDROID 头与 capsule 头，打印各段偏移与 CRC，用来定位 DTB |
| `fdt2.py` | FDT 解析器（按 4 字节对齐正确处理 `BEGIN_NODE` / `PROP`），可打印节点树与属性值 |
| `fdt.py` | 早期版本的解析器，保留作对照 |
| `dtbdiff.py` | 对比 `main.dtb` 与 `recovery.dtb` 的节点/属性差异 —— **定位问题的起点**：两份 DTB 都在同一台机器上，recovery 的 USB 是正常的，差异就出在 `dr_mode` 与那三个属性 |
| `locate_drmode.py` | 单独演示「定位某节点某属性并做等长/变长替换」，看懂偏移算术用 |

## 建议的排查顺序

```
1. 解包固件 → 取出 main_kernel.bin
2. parse_main.py          # 确认 DTB 在镜像里的偏移与长度
3. 切出 main.dtb
4. dtbdiff.py             # main vs recovery，看 USB 节点差在哪
5. fix_capsule.py         # 修 + 重算 CRC
6. 自检输出三段 CRC 必须全部 verify 通过、tail 必须全零
7. 只刷 main 分区
```

## 刷机红线

- **R106 分区的 partition XML 不要用**：trustos 尺寸不同，`ubipac` 偏移差 1.75 MiB。
- FDL2 进去第一条命令必须是 `p`（打印分区表）核对，再动手。
- **绝不执行 `unisoc-reboot autodloader`**：会擦 splloader，而 mtd0 没有备份分区。
- 刷之前把 `mtd0` 备份出来，且校验必须 `bs=2048` 读 —— `dd` 到 `/dev/mtdblock0` 是假成功。

> 本仓库不含固件二进制。`main_kernel_fixed.bin` 属于固件衍生品，请自行按上述流程生成，或到上游
> Releases 取未修改版本后自行修复。
