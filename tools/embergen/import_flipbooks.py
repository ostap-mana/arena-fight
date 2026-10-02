import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'fx', 'eg')
SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'books.json')
MANIFEST = os.path.join(OUT, 'flipbooks.json')
RUNTIME_KEYS = ('grid', 'frames', 'fps', 'loop', 'color', 'size', 'pivot', 'billboard', 'palette',
                'soft', 'additive', 'emissive', 'opacity', 'aspect', 'capacity', 'fog', 'smoke',
                'randomRot', 'renderOrder', 'mvStrength')


def load(path, mode='RGBA'):
    return np.asarray(Image.open(path).convert(mode)).astype(np.float32) / 255.0


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def resize(arr, size):
    if arr.shape[0] == size and arr.shape[1] == size:
        return arr
    chans = [arr] if arr.ndim == 2 else [arr[..., i] for i in range(arr.shape[2])]
    out = []
    for c in chans:
        im = Image.fromarray(c.astype(np.float32), 'F').resize((size, size), Image.LANCZOS)
        out.append(np.asarray(im))
    return out[0] if arr.ndim == 2 else np.stack(out, -1)


def grid_frames(arr, cols, rows):
    h, w = arr.shape[:2]
    fh, fw = h // rows, w // cols
    return fh, fw


def edge_fade(arr, cols, rows, px):
    if px <= 0:
        return arr
    fh, fw = grid_frames(arr, cols, rows)
    ramp_x = np.clip(np.minimum(np.arange(fw), fw - 1 - np.arange(fw)) / px, 0, 1)
    ramp_y = np.clip(np.minimum(np.arange(fh), fh - 1 - np.arange(fh)) / px, 0, 1)
    mask = np.outer(ramp_y, ramp_x)
    tile = np.tile(mask, (rows, cols))
    return arr * (tile[..., None] if arr.ndim == 3 else tile)


def build_premul(src, entry):
    rgba = load(src['color'])
    if 'alpha' in src:
        rgba[..., 3] = load(src['alpha'], 'L')
    if entry.get('straight'):
        rgba[..., :3] *= rgba[..., 3:4]
    gain = entry.get('gain', 1.0)
    rgba[..., :3] = np.clip(rgba[..., :3] * gain, 0, 1)
    return rgba


def build_heat(src, entry):
    base = load(src['color'])
    alpha = load(src['alpha'], 'L') if 'alpha' in src else base[..., 3]
    if 'heat' in src:
        heat = luminance(load(src['heat'], 'RGB'))
    else:
        rgb = base[..., :3]
        warm = np.clip(rgb[..., 0] - rgb[..., 2] * 0.6, 0, 1)
        heat = np.clip(np.maximum(luminance(rgb) - alpha * entry.get('smokeLevel', 0.12), 0) * 0.5 + warm * 0.8, 0, 1)
    lit = luminance(load(src['lit'], 'RGB')) if 'lit' in src else np.clip(luminance(base[..., :3]) / np.maximum(alpha, 1e-3), 0, 1)
    heat = np.clip(heat * entry.get('heatGain', 1.0), 0, 1) ** entry.get('heatGamma', 1.0)
    return np.stack([heat, lit * alpha, np.zeros_like(heat), alpha], -1)


def encode(arr, path, srgb, quality):
    arr = np.clip(arr, 0, 1)
    if srgb:
        arr = arr.copy()
        arr[..., :3] = arr[..., :3] ** (1 / 2.2)
    img = Image.fromarray((arr * 255 + 0.5).astype(np.uint8), 'RGBA')
    img.save(path, quality=quality, exact=True, method=6, alpha_quality=100)
    return os.path.getsize(path)


def import_book(key, entry):
    src = entry['src']
    cols, rows = entry['grid']
    color = entry.get('color', 'premul')
    arr = build_heat(src, entry) if color == 'heat' else build_premul(src, entry)
    arr = edge_fade(arr, cols, rows, entry.get('edgeFade', 2))
    size = entry.get('texSize', 1024)
    arr = resize(arr, size)
    file = entry.get('file', key)
    nbytes = encode(arr, os.path.join(OUT, f'{file}.webp'), color != 'heat', entry.get('quality', 88))
    meta = {'file': file}
    for k in RUNTIME_KEYS:
        if k in entry:
            meta[k] = entry[k]
    meta.setdefault('color', color)
    print(f'{key}: {size}px {cols}x{rows} {nbytes // 1024} KB')
    return meta


def main():
    spec = json.load(open(SPEC, encoding='utf-8'))
    keys = sys.argv[1:] or list(spec)
    manifest = json.load(open(MANIFEST, encoding='utf-8')) if os.path.exists(MANIFEST) else {}
    for key in keys:
        entry = spec[key]
        if not all(os.path.exists(p) for p in entry['src'].values()):
            print(f'{key}: missing source, skipped')
            continue
        manifest[key] = import_book(key, entry)
    for stale in [k for k in manifest if k.startswith('test_')]:
        if any(k in manifest for k in spec):
            manifest.pop(stale)
            p = os.path.join(OUT, f'{stale}.webp')
            if os.path.exists(p):
                os.remove(p)
    json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
