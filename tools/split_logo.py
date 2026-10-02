import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "assets", "fx", "S_Invokers_Logo.png")
OUT = os.path.join(ROOT, "public", "assets", "img")
TITLE_ROWS = 88
RING_X = (187, 273)


def ring_mask(alpha):
    solid = alpha[:TITLE_ROWS] > 8
    labels, _ = ndimage.label(solid, structure=np.ones((3, 3)))
    ring_ids = [
        i for i, (ys, xs) in enumerate(ndimage.find_objects(labels), 1)
        if xs.start >= RING_X[0] and xs.stop <= RING_X[1]
    ]
    _, (iy, ix) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
    nearest = labels[iy, ix]
    mask = np.zeros(alpha.shape, bool)
    mask[:TITLE_ROWS] = np.isin(nearest, ring_ids) & (alpha[:TITLE_ROWS] > 0)
    return mask


def ring_center(mask):
    ys, xs = np.nonzero(mask)
    return (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, max(np.ptp(xs), np.ptp(ys)) + 1


def main():
    img = np.array(Image.open(SRC).convert("RGBA"))
    mask = ring_mask(img[..., 3])
    cx, cy, size = ring_center(mask)
    side = int(np.ceil(size / 2 + 2)) * 2

    base = img.copy()
    base[mask, 3] = 0
    Image.fromarray(base).save(os.path.join(OUT, "logo_base.png"))

    ring = np.zeros_like(img)
    ring[mask] = img[mask]
    canvas = Image.new("RGBA", (side, side))
    left, top = int(round(cx - side / 2)), int(round(cy - side / 2))
    canvas.paste(Image.fromarray(ring), (-left, -top))
    canvas.save(os.path.join(OUT, "logo_ring.png"))

    w, h = img.shape[1], img.shape[0]
    print(f"logo {w}x{h}  ring {side}px at ({left},{top})")
    print(f"css left {left / w * 100:.4f}%  top {top / h * 100:.4f}%  width {side / w * 100:.4f}%")


if __name__ == "__main__":
    sys.exit(main())
