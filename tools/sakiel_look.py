import numpy as np
from PIL import Image

NAVY_HUE = 228 / 360
CRIMSON_HUE = 352 / 360


def hsv(img):
    a = np.asarray(img.convert("HSV"), dtype=np.float32) / 255.0
    return a[..., 0], a[..., 1], a[..., 2]


def to_rgb(h, s, v):
    a = np.stack([h, np.clip(s, 0, 1), np.clip(v, 0, 1)], axis=-1)
    hsv_img = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), "HSV")
    return np.asarray(hsv_img.convert("RGB"), dtype=np.float32)


def hue_band(h, lo, hi, soft=0.03):
    lo, hi = lo / 360, hi / 360
    rise = np.clip((h - lo) / soft + 1, 0, 1)
    fall = np.clip((hi - h) / soft + 1, 0, 1)
    return rise * fall


def ramp(x, lo, hi):
    return np.clip((x - lo) / (hi - lo), 0, 1)


def paint(img, layers):
    base = np.asarray(img.convert("RGB"), dtype=np.float32)
    out = base.copy()
    for mask, target in layers:
        out = out * (1 - mask[..., None]) + target * mask[..., None]
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGB")


def body(img):
    h, s, v = hsv(img)
    cool = hue_band(h, 255, 275, 0.01) * np.maximum(ramp(v, 0.53, 0.58) * ramp(s, 0.4, 0.45), ramp(s, 0.76, 0.84))
    warm = hue_band(h, 275, 318, 0.01) * ramp(s, 0.45, 0.52)
    mask = np.maximum(cool, warm)
    navy = to_rgb(np.full_like(h, NAVY_HUE), s * 0.5, v * 0.42)
    return paint(img, [(mask, navy)])


def weapon(img):
    h, s, v = hsv(img)
    eyes = hue_band(h, 300, 360) * ramp(s, 0.3, 0.45)
    red = np.maximum(hue_band(h, 345, 360), hue_band(h, 0, 8)) * ramp(s, 0.55, 0.65)
    bone = 1 - np.maximum(eyes, red)
    obsidian = to_rgb(np.full_like(h, NAVY_HUE), s * 0.3 + 0.08, v * 0.34)
    glow = to_rgb(h, np.minimum(1, s * 1.15), v)
    return paint(img, [(bone, obsidian), (eyes, glow)])


def wings(img):
    h, s, v = hsv(img)
    purple = hue_band(h, 235, 330)
    membrane = purple * ramp(0.52 - s, 0, 0.1)
    bone = purple * (1 - membrane)
    crimson = to_rgb(np.full_like(h, CRIMSON_HUE), 0.62 + s * 0.3, v * 0.72)
    dark = to_rgb(np.full_like(h, NAVY_HUE), s * 0.45, v * 0.38)
    return paint(img, [(membrane, crimson), (bone, dark)])
