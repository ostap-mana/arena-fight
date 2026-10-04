import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TEX_DIR = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "glb", "tex"))
MASK_SUFFIX = "_MSES.webp"
STEPS = (4, 4, 1, 1)


def posterize(img):
    luts = []
    for step in STEPS[:len(img.getbands())]:
        luts += [min(255, int(round(v / step)) * step) for v in range(256)]
    return img.point(luts)


def save_mask(img, path):
    img.save(path, "WEBP", lossless=True, exact=True, method=6)


def pack(path):
    before = os.path.getsize(path)
    img = Image.open(path)
    img.load()
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    packed = posterize(img)
    tmp = path + ".tmp.webp"
    save_mask(packed, tmp)
    if os.path.getsize(tmp) < before:
        os.replace(tmp, path)
    else:
        os.remove(tmp)
    after = os.path.getsize(path)
    print("%s: %d KB -> %d KB" % (os.path.basename(path), before // 1024, after // 1024), flush=True)
    return after


def main(argv):
    paths = argv or sorted(os.path.join(TEX_DIR, f) for f in os.listdir(TEX_DIR) if f.startswith("T_LOB_") and f.endswith(MASK_SUFFIX))
    for p in paths:
        pack(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
