import sys
import json
import numpy as np
from PIL import Image
from scipy import ndimage

src, meta_path, out_png, out_webp = sys.argv[1:5]
HEIGHT = int(sys.argv[5]) if len(sys.argv) > 5 else 440
FADE = float(sys.argv[6]) if len(sys.argv) > 6 else 0.24

meta = json.load(open(meta_path))[0]
FLIP = len(sys.argv) > 7 and sys.argv[7] == "1"
im = Image.open(src).convert("RGBA")
if FLIP:
    im = im.transpose(Image.FLIP_LEFT_RIGHT)
a = np.asarray(im).astype(np.float32)
W, H = im.size
fx = (lambda u: 1 - u) if FLIP else (lambda u: u)
tip = np.array([fx(meta["tip"][0]) * W, meta["tip"][1] * H])
contact = np.array([fx(meta["contact"][0]) * W, meta["contact"][1] * H])

mask = a[..., 3] > 10
lab, n = ndimage.label(mask)
if n > 1:
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = 1 + int(np.argmax(sizes))
    grown = ndimage.binary_dilation(lab == keep, iterations=3)
    a[..., 3] *= grown

ys, xs = np.nonzero(a[..., 3] > 10)
w = a[ys, xs, 3]
centroid = np.array([np.average(xs, weights=w), np.average(ys, weights=w)])
axis = centroid - tip
axis /= np.linalg.norm(axis)
proj = (xs - tip[0]) * axis[0] + (ys - tip[1]) * axis[1]
far = np.percentile(proj, 99.5)
yy, xx = np.mgrid[0:H, 0:W]
p = ((xx - tip[0]) * axis[0] + (yy - tip[1]) * axis[1]) / far
k = np.clip((1 - p) / FADE, 0, 1)
k = k * k * (3 - 2 * k)
a[..., 3] *= k

ys, xs = np.nonzero(a[..., 3] > 6)
pad = int(0.02 * H)
x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad)
y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad)
crop = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA").crop((x0, y0, x1, y1))
scale = HEIGHT / crop.height
crop = crop.resize((round(crop.width * scale), HEIGHT), Image.LANCZOS)
crop.save(out_png)
crop.save(out_webp, "WEBP", quality=90, method=6, alpha_quality=100)
cw, ch = x1 - x0, y1 - y0
res = {
    "size": crop.size,
    "tip": [round((tip[0] - x0) / cw, 4), round((tip[1] - y0) / ch, 4)],
    "contact": [round((contact[0] - x0) / cw, 4), round((contact[1] - y0) / ch, 4)],
}
print(json.dumps(res))
