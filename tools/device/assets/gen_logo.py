#!/usr/bin/env python3
"""生成 SY108 品牌标识（与免登录状态页左上角的 .mark 完全一致）。

状态页的实现是纯 CSS：
  .mark     38x38 圆角 13px，linear-gradient(140deg, #4f6bed, #7c8ff5)
  ::before  inset 11px，2px 白环
  ::after   inset 5px，2px 白环（仅上/右），rotate(-35deg)
这里按同一比例渲染成位图/矢量，供 LuCI 主题的 logo 与 favicon 使用。
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
os.makedirs(OUT, exist_ok=True)

S = 1024                      # 超采样画布
BOX = 38.0                    # CSS 里的基准尺寸
k = S / BOX                   # 缩放系数
C1 = (0x4f, 0x6b, 0xed)       # --accent
C2 = (0x7c, 0x8f, 0xf5)       # --accent-2


def gradient(size, c1, c2, deg=140.0):
    """linear-gradient(deg, c1, c2)：deg 以“向上”为 0°、顺时针为正。"""
    rad = math.radians(deg)
    dx, dy = math.sin(rad), -math.cos(rad)     # 屏幕坐标 y 向下
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = (size - 1) / 2.0
    t = (xx - cx) * dx + (yy - cy) * dy
    t = (t - t.min()) / (t.max() - t.min())
    t = t[..., None]
    arr = np.array(c1) * (1 - t) + np.array(c2) * t
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def build(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    kk = size / BOX

    # 圆角方块底（半径 13/38 ≈ 34.2%）
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=13 * kk, fill=255)
    img.paste(gradient(size, C1, C2).convert("RGBA"), (0, 0), mask)

    d = ImageDraw.Draw(img)
    # 内圈白环
    i1 = 11 * kk
    d.ellipse([i1, i1, size - 1 - i1, size - 1 - i1],
              outline=(255, 255, 255, 235), width=max(1, round(2 * kk)))
    # 外圈弧形（只画上/右两段，等价 rotate(-35deg)）
    i2 = 5 * kk
    d.arc([i2, i2, size - 1 - i2, size - 1 - i2],
          start=-125, end=-35, fill=(255, 255, 255, 110),
          width=max(1, round(2 * kk)))
    return img


def svg():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 38" width="38" height="38">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.643" y2="0.766">
      <stop offset="0" stop-color="#4f6bed"/>
      <stop offset="1" stop-color="#7c8ff5"/>
    </linearGradient>
  </defs>
  <rect width="38" height="38" rx="13" fill="url(#g)"/>
  <circle cx="19" cy="19" r="8" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="2"/>
  <path d="M11.5 10.75A10.5 10.5 0 0 1 27.25 26.5" fill="none"
        stroke="#fff" stroke-opacity=".43" stroke-width="2" stroke-linecap="round"/>
</svg>
"""


big = build(1024)
big.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "logo-256.png"))
big.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "logo-192.png"))
big.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, "logo-64.png"))
open(os.path.join(OUT, "logo.svg"), "w", encoding="utf-8").write(svg())
print("written to", OUT)
