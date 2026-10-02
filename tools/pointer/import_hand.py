import sys
import json
import math
import numpy as np
from PIL import Image
from scipy import ndimage

src, out_webp = sys.argv[1:3]
tip = np.array([float(v) for v in sys.argv[3].split(",")])
axis_deg = float(sys.argv[4])
target_deg = float(sys.argv[5])
mirror = sys.argv[6] == "1"
height = int(sys.argv[7])

rgba = np.asarray(Image.open(src).convert("RGBA")).astype(np.float64) / 255.0
H, W = rgba.shape[:2]
if mirror:
    rgba = rgba[:, ::-1]
    tip = np.array([W - 1 - tip[0], tip[1]])
    axis_deg = 180.0 - axis_deg
premul = np.dstack([rgba[..., :3] * rgba[..., 3:4], rgba[..., 3]])

theta = math.radians(target_deg - axis_deg)
c, s = math.cos(theta), math.sin(theta)
rot = np.array([[c, -s], [s, c]])
c_src = np.array([(W - 1) / 2, (H - 1) / 2])
corners = np.array([[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) - c_src
spun = corners @ rot.T
ow = int(math.ceil(spun[:, 0].max() - spun[:, 0].min())) + 1
oh = int(math.ceil(spun[:, 1].max() - spun[:, 1].min())) + 1
c_out = np.array([(ow - 1) / 2, (oh - 1) / 2])

yy, xx = np.mgrid[0:oh, 0:ow].astype(np.float64)
dx, dy = xx - c_out[0], yy - c_out[1]
sx = c * dx + s * dy + c_src[0]
sy = -s * dx + c * dy + c_src[1]
out = np.dstack([ndimage.map_coordinates(premul[..., k], [sy, sx], order=3, mode="constant", cval=0.0) for k in range(4)])
out = np.clip(out, 0.0, 1.0)
out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])
tip_out = rot @ (tip - c_src) + c_out

ys, xs = np.nonzero(out[..., 3] > 6 / 255)
pad = 4
x0, x1 = max(0, xs.min() - pad), min(ow, xs.max() + 1 + pad)
y0, y1 = max(0, ys.min() - pad), min(oh, ys.max() + 1 + pad)
out = out[y0:y1, x0:x1]
tip_out -= [x0, y0]

ch, cw = out.shape[:2]
scale = height / ch
nw = round(cw * scale)
chans = [np.asarray(Image.fromarray(out[..., k].astype(np.float32), "F").resize((nw, height), Image.LANCZOS)) for k in range(4)]
small = np.clip(np.dstack(chans), 0.0, 1.0)
alpha = small[..., 3:4]
straight = np.where(alpha > 1e-4, small[..., :3] / np.maximum(alpha, 1e-4), 0.0)
img = np.dstack([np.clip(straight, 0, 1), alpha])
Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(out_webp, "WEBP", quality=90, method=6, alpha_quality=100, exact=True)
print(json.dumps({"size": [nw, height], "contact": [round(tip_out[0] / cw, 4), round(tip_out[1] / ch, 4)]}))
