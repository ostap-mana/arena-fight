import sys
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/assets/vfx/tex/T_FX_Move_Click_1_1_A.webp'
TARGET = ROOT / 'src/assets/GENERAL/HUD/gear/guide-arrow.webp'
GREEN = (69, 242, 90)
GAP = 0.375


def shape(img):
    rgba = img.convert('RGBA')
    r, g, b, a = rgba.split()
    lum = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return ImageChops.multiply(a, lum)


def tile(src, dst):
    img = Image.open(src)
    mask = shape(img)
    w, h = mask.size
    out = Image.new('RGBA', (w + round(w * GAP), h), GREEN + (0,))
    solid = Image.new('RGBA', (w, h), GREEN + (255,))
    solid.putalpha(mask)
    out.paste(solid, (0, 0))
    out.save(dst, 'WEBP', quality=90, alpha_quality=90, method=6, exact=True)
    print(dst, out.size, dst.stat().st_size)


if __name__ == '__main__':
    tile(Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE, Path(sys.argv[2]) if len(sys.argv) > 2 else TARGET)
