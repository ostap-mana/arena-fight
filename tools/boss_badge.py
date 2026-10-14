import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_hud import OUT, BATTLE_HUD_BUNDLE, images_of

PORTRAIT_BUNDLE = "2286af0338"
PORTRAIT = "S_DEM141_Large"
BADGE = "S_HUD_BossBadge"
SCALE = 1.5
HEADROOM = 40
WINDOW_CENTRE = (85, 87)
WINDOW_RADIUS = 47
FACE_ZOOM = 1.45
FACE_SHIFT = -0.06
POP_HALF_WIDTH = 0.55
POP_FLOOR = 0.35
POP_FEATHER = 2.2
EDGE_FEATHER = 0.6
HOT_FLOOR = 0.5
HOT_BLUR = 2.0
HOT_TINT = (255, 238, 170)
HOT_MIX = 0.65
QUALITY = 92


def premultiplied_resize(img, size):
    return img.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def window_mask(size, cx, cy, r):
    diamond = Image.new("L", size, 0)
    ImageDraw.Draw(diamond).polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=255)
    diamond = diamond.filter(ImageFilter.GaussianBlur(EDGE_FEATHER * SCALE))
    pop = Image.new("L", size, 0)
    half = r * POP_HALF_WIDTH
    ImageDraw.Draw(pop).rectangle([cx - half, 0, cx + half, cy - r * POP_FLOOR], fill=255)
    pop = pop.filter(ImageFilter.GaussianBlur(POP_FEATHER * SCALE))
    return np.maximum(np.asarray(diamond, float), np.asarray(pop, float))


def molten(layer):
    rgba = np.asarray(layer).astype(float) / 255
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    hi, lo = rgb.max(axis=2), rgb.min(axis=2)
    saturation = np.where(hi > 0, (hi - lo) / np.maximum(hi, 1e-6), 0)
    warm = np.clip((rgb[..., 1] - rgb[..., 2]) / 0.2, 0, 1) * (rgb[..., 0] >= rgb[..., 1])
    heat = np.clip((hi - HOT_FLOOR) / 0.35, 0, 1) * np.clip((saturation - 0.4) / 0.25, 0, 1) * warm * alpha
    glow = np.asarray(Image.fromarray(np.round(heat * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(HOT_BLUR * SCALE)), float) / 255
    heat = np.clip(np.maximum(heat, glow * 0.85), 0, 1)
    tint = np.array(HOT_TINT, float) / 255
    colour = np.clip(rgb * (1 - HOT_MIX) + tint * HOT_MIX, 0, 1)
    out = np.dstack([colour, heat])
    out[out[..., 3] < 1 / 255, :3] = 0
    return Image.fromarray(np.round(out * 255).astype(np.uint8), "RGBA")


def main():
    hud, _ = images_of(BATTLE_HUD_BUNDLE)
    faces, _ = images_of(PORTRAIT_BUNDLE)
    if hud is None or faces is None:
        print("bundle not found", file=sys.stderr)
        return 1
    badge = hud[BADGE].image.convert("RGBA")
    face = faces[PORTRAIT].image.convert("RGBA")
    badge = premultiplied_resize(badge, (round(badge.width * SCALE), round(badge.height * SCALE)))
    pad = round(HEADROOM * SCALE)
    size = (badge.width, badge.height + pad)
    cx, cy, r = WINDOW_CENTRE[0] * SCALE, WINDOW_CENTRE[1] * SCALE + pad, WINDOW_RADIUS * SCALE

    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(badge, (0, pad))

    side = round(2 * r * FACE_ZOOM)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.paste(premultiplied_resize(face, (side, side)), (round(cx - side / 2), round(cy - side / 2 + FACE_SHIFT * side)))
    alpha = np.asarray(layer.getchannel("A"), float) * window_mask(size, cx, cy, r) / 255
    layer.putalpha(Image.fromarray(np.round(alpha).astype(np.uint8), "L"))
    canvas.alpha_composite(layer)
    hot = molten(layer)

    rgba = np.asarray(canvas).copy()
    rgba[rgba[..., 3] == 0, :3] = 0
    canvas = Image.fromarray(rgba, "RGBA")
    left, top, right, bottom = canvas.getbbox()
    canvas = canvas.crop((left, top, right, bottom))
    hot = hot.crop((left, top, right, bottom))
    path = os.path.join(OUT, "wave", "boss-crest.webp")
    canvas.save(path, format="WEBP", quality=QUALITY, alpha_quality=100, method=6)
    hot_path = os.path.join(OUT, "wave", "boss-crest-hot.webp")
    hot.save(hot_path, format="WEBP", quality=QUALITY, alpha_quality=90, method=6)
    w, h = canvas.size
    print(f"wave/boss-crest.webp  {w}x{h}  {os.path.getsize(path)} B")
    print(f"wave/boss-crest-hot.webp  {w}x{h}  {os.path.getsize(hot_path)} B")
    print(f"aspect h/w {h / w:.4f}  window centre x {(cx - left) / w:.4f} y {(cy - top) / h:.4f}  left vertex x {(cx - r - left) / w:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
