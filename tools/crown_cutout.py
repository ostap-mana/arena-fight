import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 900

rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
peak = rgb.max(-1)

dark = peak < 10
labels, _ = ndimage.label(dark)
edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
background = np.isin(labels, edge_labels[edge_labels > 0])

near = ndimage.binary_dilation(background, iterations=3) & ~background
alpha = np.ones(peak.shape, np.float32)
alpha[background] = 0
alpha[near] = np.clip(peak[near] / 48.0, 0, 1)

safe = np.maximum(alpha, 1e-3)[..., None]
colour = np.where(alpha[..., None] > 0, np.clip(rgb / safe, 0, 255), 0)

ys, xs = np.where(alpha > 0.02)
pad = 6
y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgb.shape[0])
x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgb.shape[1])
rgba = np.dstack([colour, alpha * 255])[y0:y1, x0:x1].round().astype(np.uint8)

out = Image.fromarray(rgba, "RGBA")
height = round(out.height * width / out.width)
out = out.resize((width, height), Image.LANCZOS)
out.save(dst, "WEBP", quality=86, alpha_quality=90, method=6)
print("crop", (x0, y0, x1, y1), "out", out.size, "transparent", round(float((alpha == 0).mean()), 3))
