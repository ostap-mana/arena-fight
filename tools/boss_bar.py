import os
import sys
import glob
import warnings
import numpy as np
import UnityPy
from PIL import Image

warnings.filterwarnings("ignore")
UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "src", "assets", "GENERAL", "HUD", "bars"))

BUNDLE = "c60b75c4b2"
FRAME = "S_HUD_HP_BossBar"
FILL = "S_HUD_BossTopBarHPFill"
BAR_LEFT = 226
FILL_TIP = 10
TINT = (0.96, 0.0, 0.0)
WIDTH = 900


def sprites(names):
    path = glob.glob(os.path.join(AA, BUNDLE + "*.bundle"))[0]
    found = {}
    for obj in UnityPy.load(path).objects:
        if obj.type.name != "Sprite":
            continue
        data = obj.read()
        if data.m_Name in names and data.m_Name not in found:
            found[data.m_Name] = data.image.convert("RGBA")
    return found


def is_gold(px):
    return px[3] > 200 and px[0] > 150 and px[1] > 120


def interior(frame):
    a = np.asarray(frame).astype(int)
    h, w = a.shape[:2]
    cx = w // 2
    gold_rows = [y for y in range(h) if is_gold(a[y, cx])]
    top = next(y for y in gold_rows if y < h // 2 and not is_gold(a[y + 1, cx]))
    bottom = next(y for y in gold_rows if y > top + 1)
    mask = np.zeros((h, w), dtype=np.uint8)
    for y in range(top + 1, bottom):
        left = cx
        while left > 0 and not is_gold(a[y, left - 1]):
            left -= 1
        right = cx
        while right < w - 1 and not is_gold(a[y, right + 1]):
            right += 1
        mask[y, left:right + 1] = 255
    return mask


def shrink(img, size):
    return img.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def main():
    art = sprites({FRAME, FILL})
    frame = art[FRAME]
    alpha = np.asarray(frame)[..., 3]
    rows = np.nonzero(alpha[:, BAR_LEFT:].max(axis=1) > 12)[0]
    frame = frame.crop((BAR_LEFT, 0, frame.width, int(rows.max()) + 1))
    mask = interior(frame)
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    body = art[FILL].crop((0, 0, art[FILL].width - FILL_TIP, art[FILL].height))
    fill = body.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    tinted = np.asarray(fill).astype(np.float64)
    for c, k in enumerate(TINT):
        tinted[..., c] *= k
    tinted[..., 3] = mask[y0:y1, x0:x1]
    fill = Image.fromarray(np.round(tinted).astype(np.uint8), "RGBA")
    k = WIDTH / frame.width
    out_frame = shrink(frame, (WIDTH, round(frame.height * k)))
    out_fill = shrink(fill, (round(fill.width * k), round(fill.height * k)))
    os.makedirs(OUT, exist_ok=True)
    out_frame.save(os.path.join(OUT, "boss-frame.webp"), format="WEBP", lossless=True, method=6)
    out_fill.save(os.path.join(OUT, "boss-fill.webp"), format="WEBP", lossless=True, method=6)
    fw, fh = frame.size
    print(f"boss-frame.webp {out_frame.width}x{out_frame.height}  source {fw}x{fh}")
    print(f"boss-fill.webp {out_fill.width}x{out_fill.height}  box x {x0}..{x1} y {y0}..{y1}")
    print(f"aspect {fh / fw:.5f}")
    print(f"insets left {x0 / fw * 100:.3f}% right {(fw - x1) / fw * 100:.3f}% top {y0 / fh * 100:.3f}% bottom {(fh - y1) / fh * 100:.3f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
