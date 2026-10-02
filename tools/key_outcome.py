import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'src' / 'video'
OUT = ROOT / 'src' / 'assets' / 'GENERAL' / 'lose-win'
NO_BG = SOURCE / 'no-bg'
SPAN = 700
MARGIN = 24
SIDE_FADE = 20
TOP_FADE = 36
FOOT_FADE = 36
SEEN = 8
HOLD = 24
FADE = 40
RELIGHT_HOLD = 16
RELIGHT_FADE = 32
FIRE_RATIO = 0.67
CRF = '18'
WEBM_CRF = '12'
DECODE = 'zscale=matrixin=709:rangein=limited:chromalin=left:range=full:filter=bicubic,format=gbrp'
TO_420 = 'zscale=rangein=full:primariesin=709:transferin=709:primaries=709:transfer=709:matrix=709:range=limited:chromal=left:filter=bilinear,format=yuv420p'
TO_420A = ('zscale=rangein=full:primariesin=709:transferin=709:primaries=709:transfer=709:matrix=709:range=limited:filter=bilinear,format=yuva444p,'
           'scale=flags=bilinear+accurate_rnd:in_h_chr_pos=0:in_v_chr_pos=0:out_h_chr_pos=0:out_v_chr_pos=128,format=yuva420p')
TO_444A = 'zscale=rangein=full:primariesin=709:transferin=709:primaries=709:transfer=709:matrix=709:range=limited:filter=bilinear,format=yuva444p10le'
TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

CLIPS = {
    'ricklow-victory': dict(src='win_Seedance 2.5 Reference_2026-09-29_15-05-38.mp4', cyan=True, loop=None),
    'ricklow-defeat': dict(src='win_Seedance 2.5 Reference_2026-09-29_13-31-04.mp4', cyan=True, loop=86, blend=8),
    'confar-victory': dict(src='win_Seedance 2.5 Reference_2026-09-29_13-31-28.mp4', cyan=True, loop=None),
    'confar-defeat': dict(src='win_Seedance 2.5 Reference_2026-09-29_13-31-44.mp4', cyan=True, loop=72, blend=12),
    'ardell-victory': dict(src='win_Seedance 2.5 Reference_2026-09-29_13-53-31.mp4', cyan=False, loop=None),
    'ardell-defeat': dict(src='win_Seedance 2.5 Reference_2026-09-29_13-53-23.mp4', cyan=False, loop=80, blend=12),
}
PLAIN_GREEN = {'12-55-41', '13-02-56', '13-53-23', '13-53-31'}


def probe(path):
    fields = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate',
                             '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout.strip().split(',')
    num, den = fields[2].split('/')
    return int(fields[0]), int(fields[1]), int(num) / int(den)


def read_frames(path):
    w, h, fps = probe(path)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', DECODE, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3), fps


def hue_sat(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    span = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, (g - b) / span % 6, np.where(mx == g, (b - r) / span + 2, (r - g) / span + 4)) * 60
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    return hue, sat, mx


def screen_like(rgb, cyan):
    hue, sat, val = hue_sat(rgb)
    top = 195 if cyan else 165
    return (hue > 78) & (hue < top) & (sat > 0.22) & (val > 0.25)


def push_pull(values, weights):
    levels = [(values * weights[..., None], weights)]
    while min(levels[-1][1].shape) > 4:
        v, w = levels[-1]
        levels.append((cv2.pyrDown(v), cv2.pyrDown(w)))
    v, w = levels[-1]
    filled = v / np.maximum(w, 1e-6)[..., None]
    for v, w in reversed(levels[:-1]):
        up = cv2.resize(filled, (w.shape[1], w.shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(w * 4, 0, 1)[..., None]
        filled = v / np.maximum(w, 1e-6)[..., None] * k + up * (1 - k)
    return filled


def pure_screen(rgb, cyan):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = g - np.maximum(r, b)
    if not cyan:
        return green
    return np.maximum(green, np.minimum(g, b) - r)


def clean_plate(frames, cyan):
    n, h, w, _ = frames.shape
    hh, hw = h // 2, w // 2
    small = np.stack([cv2.resize(f, (hw, hh), interpolation=cv2.INTER_AREA) for f in frames]).astype(np.float32) / 255
    shrink = np.ones((5, 5), np.uint8)
    masks = np.stack([cv2.erode(screen_like(f, cyan).astype(np.uint8), shrink) > 0 for f in small])
    plate = np.zeros((hh, hw, 3), np.float32)
    seen = np.zeros((hh, hw), np.float32)
    for y0 in range(0, hh, 32):
        chunk = small[:, y0:y0 + 32]
        mask = masks[:, y0:y0 + 32]
        strength = np.where(mask, pure_screen(chunk, cyan), -1.0)
        weight = np.exp((strength - strength.max(0)) / 0.015) * mask
        total = weight.sum(0)
        plate[y0:y0 + 32] = (chunk * weight[..., None]).sum(0) / np.maximum(total, 1e-6)[..., None]
        seen[y0:y0 + 32] = np.clip(mask.sum(0) / 3, 0, 1)
    plate = push_pull(plate, seen)
    plate = cv2.GaussianBlur(plate, (0, 0), 3)
    return cv2.resize(plate, (w, h), interpolation=cv2.INTER_LINEAR)


def aura_screen(rgb):
    hue, sat, val = hue_sat(rgb)
    screen = (hue > 100) & (hue < 195) & (sat > 0.4) & (val > 0.3)
    core = (hue >= 170) & (hue < 215) & (sat > 0.18) & (val > 0.5)
    pale = (hue >= 140) & (hue < 215) & (sat > 0.25) & (val > 0.6)
    mint = (hue >= 85) & (hue < 140) & (sat > 0.15) & (val > 0.5)
    return screen | core | pale | mint


def frame_plate(frame, lasting):
    h, w, _ = frame.shape
    small = cv2.resize(frame, (w // 2, h // 2), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    seen = cv2.erode(aura_screen(small).astype(np.uint8), np.ones((3, 3), np.uint8))
    plate = cv2.GaussianBlur(push_pull(small, seen.astype(np.float32)), (0, 0), 2)
    plate = cv2.resize(plate, (w, h), interpolation=cv2.INTER_LINEAR)
    dist = cv2.resize(cv2.distanceTransform(1 - seen, cv2.DIST_L2, 3) * 2, (w, h), interpolation=cv2.INTER_LINEAR)
    near = smooth(1 - (dist - HOLD) / FADE)[..., None]
    return plate * near + lasting * (1 - near)


def relit(frame, static, alpha):
    h, w, _ = frame.shape
    solid = (alpha > 0.5).astype(np.uint8)
    away = smooth((cv2.distanceTransform(1 - solid, cv2.DIST_L2, 3) - RELIGHT_HOLD) / RELIGHT_FADE)
    hw, hh = w // 2, h // 2
    small = cv2.resize(frame, (hw, hh), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    base = cv2.resize(static, (hw, hh), interpolation=cv2.INTER_AREA)
    clear = screen_like(small, False) & (cv2.resize(away, (hw, hh)) > 0.5)
    seen = cv2.erode(clear.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
    offset = cv2.GaussianBlur(push_pull(small - base, seen), (0, 0), 6)
    return static + cv2.resize(offset, (w, h), interpolation=cv2.INTER_LINEAR) * away[..., None]


def plates(frames, cyan):
    lasting = clean_plate(frames, cyan)
    if cyan:
        return lambda i: frame_plate(frames[i], lasting)
    return lambda i: relit(frames[i], lasting, key_with(frames[i], lasting, False)[1])


def key_with(frame, plate, cyan, lo=0.06, hi=0.92):
    t = cyan_mix(plate, cyan)
    strength = np.maximum(screen_strength(plate, t), 0.08)
    return key_frame(frame, plate, t, strength, lo, hi)


def key(frames, cyan, i, plate_at):
    return key_with(frames[i], plate_at(i), cyan)


def screen_strength(rgb, t):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = g - np.maximum(r, b)
    cyan = np.minimum(g, b) - r
    return green * (1 - t) + cyan * t


def cyan_mix(plate, cyan):
    if not cyan:
        return np.zeros(plate.shape[:2], np.float32)
    ratio = plate[..., 2] / np.maximum(plate[..., 1], 1e-6)
    return np.clip((ratio - 0.45) / 0.4, 0, 1) ** 2


def key_frame(frame, plate, t, plate_strength, lo, hi):
    c = frame.astype(np.float32) / 255
    raw = 1 - screen_strength(c, t) / plate_strength
    screen = np.clip((raw - lo) / (hi - lo), 0, 1)
    brighter = ((c - plate) / np.maximum(1 - plate, 0.25)).max(-1)
    darker = ((plate - c) / np.maximum(plate, 0.05)).max(-1)
    floor = 0.04 + 0.14 * t
    light = np.clip((brighter - floor) / (1 - floor), 0, 1)
    glow = smooth((brighter - darker) / 0.1 + 0.5) * (1 - smooth((screen - 0.9) / 0.07))
    alpha = screen * (1 - glow) + np.minimum(screen, light) * glow
    premul = c - (1 - alpha[..., None]) * plate
    hue, sat, value = hue_sat(np.clip(premul, 0, None) / np.maximum(alpha, 1e-4)[..., None])
    magenta = smooth((sat - 0.15) / 0.2) * smooth(1 - np.abs(hue - 315) / 25)
    pink = smooth((sat - 0.15) / 0.15) * smooth(1 - np.abs(hue - 312) / 36) * smooth((value - 0.75) / 0.12)
    keep = (1 - magenta * glow * t) * (1 - pink * glow * (1 - t))
    alpha = unmix_fire(c, plate, alpha * keep)
    premul = c - (1 - alpha[..., None]) * plate
    premul = np.clip(premul, 0, None)
    r, g, b = premul[..., 0], premul[..., 1], premul[..., 2]
    warm = (1 - alpha) * smooth((r - b) / np.maximum(alpha, 1e-3) / 0.15)
    limit = np.maximum(r, b) * (1 - warm) + (r + b) / 2 * warm
    g = np.minimum(g, limit + (np.minimum(g, b) - r).clip(0) * t * (1 - warm))
    premul = np.stack([r, g, b], -1)
    premul = np.minimum(premul, alpha[..., None])
    return decontaminate(premul, alpha)


def unmix_fire(c, plate, alpha):
    hue, sat, _ = hue_sat(c)
    lean = smooth((0.3 - c[..., 2] / np.maximum(c[..., 0], 1e-3)) / 0.06)
    close = smooth(1 - (np.abs(c[..., 2] - plate[..., 2]) - 0.1) / 0.08)
    tint = smooth((hue - 42) / 4) * smooth((112 - hue) / 4) * lean * close * smooth((sat - 0.3) / 0.1)
    mixed = 1 - (c[..., 1] - FIRE_RATIO * c[..., 0]) / np.maximum(plate[..., 1] - FIRE_RATIO * plate[..., 0], 0.05)
    upper = ((c - plate) / np.maximum(1 - plate, 1e-3)).max(-1)
    lower = ((plate - c) / np.maximum(plate, 1e-3)).max(-1)
    least = np.clip(np.maximum(mixed, np.maximum(upper, lower)), 0, 1)
    return alpha * (1 - tint) + np.minimum(alpha, least) * tint


def disk(radius):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))


def decontaminate(premul, alpha, reach=3, depth=2):
    solid = (alpha > 0.97).astype(np.uint8)
    inner = cv2.erode(solid, disk(depth)).astype(np.float32)
    near = cv2.dilate(solid, disk(reach)).astype(np.float32)
    band = cv2.GaussianBlur(near * (1 - inner), (0, 0), 0.8) * (alpha > 0)
    own = premul / np.maximum(alpha, 1e-4)[..., None]
    extended = push_pull(own, inner)
    color = own * (1 - band[..., None]) + extended * band[..., None]
    return np.clip(color, 0, 1) * alpha[..., None], alpha


def straight(premul, alpha):
    color = premul / np.maximum(alpha, 1e-6)[..., None]
    return np.clip(color, 0, 1) * (alpha[..., None] > 0)


def source_config(name):
    if name in CLIPS:
        return CLIPS[name]
    path = next(SOURCE.glob(f'*{name}*.mp4'))
    return dict(src=path.name, cyan=name not in PLAIN_GREEN)


def key_clip(cfg):
    frames, fps = read_frames(SOURCE / cfg['src'])
    plate_at = plates(frames, cfg['cyan'])
    n, h, w, _ = frames.shape
    colors = np.zeros((n, h, w, 3), np.uint8)
    alphas = np.zeros((n, h, w), np.uint8)
    first = None
    for i in range(n):
        premul, alpha = key(frames, cfg['cyan'], i, plate_at)
        if first is None:
            first = premul, alpha
        colors[i] = np.round(premul * 255)
        alphas[i] = np.round(alpha * 255)
    return colors, alphas, fps, first


def body_box(alpha):
    solid = (alpha > 128).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    if count < 2:
        return None
    biggest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    x, y, bw, bh, _ = stats[biggest]
    ys, xs = np.nonzero(labels == biggest)
    return x, y, x + bw, y + bh, float(np.median(xs))


def measure(alphas):
    boxes = [body_box(a) for a in alphas]
    return [b for b in boxes if b]


def framing(alphas):
    cx = float(np.median([b[4] for b in measure(alphas)]))
    cols = np.nonzero(alphas.max(axis=(0, 1)) > SEEN)[0]
    half = max(cx - cols.min(), cols.max() + 1 - cx) + MARGIN
    width = max(SPAN, int(np.ceil(2 * half / 16)) * 16)
    return int(round(cx - width / 2)), width


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def edge_window(rows, width, x0, src_h, full_w):
    u = np.arange(width) + 0.5
    v = np.arange(rows) + 0.5
    x = x0 + u
    rim = np.minimum(u, width - u) / MARGIN
    source_rim = np.minimum(x, full_w - x) / SIDE_FADE
    horizontal = smooth(np.minimum(rim, source_rim))
    vertical = smooth(np.minimum(v / TOP_FADE, (src_h - v) / FOOT_FADE))
    return (vertical[:, None] * horizontal[None, :]).astype(np.float32)


def place(img, x0, width, rows):
    h, w = img.shape[:2]
    canvas = np.zeros((rows, width) + img.shape[2:], img.dtype)
    a, b = max(0, x0), min(w, x0 + width)
    canvas[:h, a - x0:b - x0] = img[:, a:b]
    return canvas


def seam(premul, alpha, loop, blend):
    last = len(alpha) - 1
    for j in range(blend):
        at = last - blend + 1 + j
        into = loop - blend + j
        w = (j + 1) / blend
        premul[at] = np.round(premul[at] * (1 - w) + premul[into].astype(np.float32) * w)
        alpha[at] = np.round(alpha[at] * (1 - w) + alpha[into].astype(np.float32) * w)


def content_top(alpha):
    rows = np.nonzero(alpha.max(axis=(0, 2)) > SEEN)[0]
    return int(rows.min()) if len(rows) else 0


def encode(premul, alpha, fps, loop, path):
    n, h, w, _ = premul.shape
    args = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h * 2}', '-r', f'{fps:g}', '-i', '-',
            '-vf', TO_420, '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'veryslow', '-crf', CRF,
            '-g', '48', '-movflags', '+faststart', '-an'] + TAGS
    if loop is not None:
        args += ['-force_key_frames', f'expr:eq(n,{loop})']
    proc = subprocess.Popen(args + [str(path)], stdin=subprocess.PIPE)
    for i in range(n):
        proc.stdin.write(np.concatenate([premul[i], np.repeat(alpha[i][..., None], 3, -1)], 0).tobytes())
    proc.stdin.close()
    if proc.wait():
        raise RuntimeError(f'ffmpeg failed on {path.name}')


def poster(premul, alpha, path):
    rgba = np.concatenate([straight(premul, alpha), np.clip(alpha, 0, 1)[..., None]], -1)
    Image.fromarray(np.round(rgba * 255).astype(np.uint8), 'RGBA').save(path, 'WEBP', lossless=True, quality=100, method=6)


def render(name, work):
    cfg = CLIPS[name]
    colors, alphas, fps, (first_premul, first_alpha) = key_clip(cfg)
    n, src_h, full_w = alphas.shape
    rows = int(np.ceil(src_h / 16)) * 16
    x0, width = framing(alphas)
    window = edge_window(rows, width, x0, src_h, full_w)
    premul = np.zeros((n, rows, width, 3), np.uint8)
    alpha = np.zeros((n, rows, width), np.uint8)
    for i in range(n):
        premul[i] = np.round(place(colors[i], x0, width, rows) * window[..., None])
        alpha[i] = np.round(place(alphas[i], x0, width, rows) * window)
    del colors, alphas
    if cfg['loop'] is not None:
        seam(premul, alpha, cfg['loop'], cfg['blend'])
    top = content_top(alpha)
    clip = work / f'{name}.mp4'
    still = work / f'{name}.webp'
    encode(premul, alpha, fps, cfg['loop'], clip)
    still_window = place(window, 0, width, SPAN)
    poster(place(first_premul, x0, width, SPAN) * still_window[..., None], place(first_alpha, x0, width, SPAN) * still_window, still)
    shutil.copyfile(clip, OUT / clip.name)
    shutil.copyfile(still, OUT / still.name)
    loop = 'null' if cfg['loop'] is None else f"{cfg['loop']} / {fps:g}"
    print(f"{name}: wide {width} / {SPAN}, fill {rows} / {SPAN}, top {top} / {SPAN}, loop {loop}, {n} frames @ {fps:g}fps, "
          f"{width}x{rows * 2}, {clip.stat().st_size / 1e6:.2f} MB clip, {still.stat().st_size / 1e6:.2f} MB still")


def rgba64(premul, alpha):
    rgba = np.concatenate([straight(premul, alpha), np.clip(alpha, 0, 1)[..., None]], -1)
    return np.round(rgba * 65535).astype('<u2').tobytes()


def export_no_bg(cfg, mov=False):
    frames, fps = read_frames(SOURCE / cfg['src'])
    plate_at = plates(frames, cfg['cyan'])
    n, h, w, _ = frames.shape
    stem = Path(cfg['src']).stem
    NO_BG.mkdir(exist_ok=True)
    head = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba64le', '-s', f'{w}x{h}', '-r', f'{fps:g}', '-i', '-']
    targets = {
        f'{stem}.webm': ['-vf', TO_420A, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', WEBM_CRF, '-deadline', 'good', '-cpu-used', '1',
                         '-row-mt', '1', '-auto-alt-ref', '0'],
    }
    if mov:
        targets[f'{stem}.mov'] = ['-vf', TO_444A, '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0']
    with tempfile.TemporaryDirectory() as work:
        procs = {file: subprocess.Popen(head + codec + TAGS + ['-an', str(Path(work) / file)], stdin=subprocess.PIPE)
                 for file, codec in targets.items()}
        for i in range(n):
            data = rgba64(*key(frames, cfg['cyan'], i, plate_at))
            for proc in procs.values():
                proc.stdin.write(data)
        for file, proc in procs.items():
            proc.stdin.close()
            if proc.wait():
                raise RuntimeError(f'ffmpeg failed on {file}')
            shutil.copyfile(Path(work) / file, NO_BG / file)
    sizes = ', '.join(f'{file.rsplit(".", 1)[1]} {(NO_BG / file).stat().st_size / 1e6:.1f} MB' for file in targets)
    print(f'{stem}: {n} frames {w}x{h} @ {fps:g}fps, {"cyan aura" if cfg["cyan"] else "green"} key, {sizes}')


def preview(name, frames_at):
    cfg = source_config(name)
    frames, fps = read_frames(SOURCE / cfg['src'])
    plate_at = plates(frames, cfg['cyan'])
    tiles = []
    for i in frames_at:
        premul, alpha = key(frames, cfg['cyan'], i, plate_at)
        dark = premul + (1 - alpha[..., None]) * np.array([0.06, 0.06, 0.07], np.float32)
        yy, xx = np.mgrid[:alpha.shape[0], :alpha.shape[1]]
        checker = np.where(((yy // 24 + xx // 24) % 2)[..., None] == 0, 0.95, 0.35).astype(np.float32) * np.array([1, 0.2, 0.9], np.float32)
        loud = premul + (1 - alpha[..., None]) * checker
        row = np.concatenate([frames[i].astype(np.float32) / 255, dark, loud, np.repeat(alpha[..., None], 3, -1)], 1)
        tiles.append(row)
    sheet = np.concatenate(tiles, 0)
    sheet = cv2.resize(sheet, (sheet.shape[1] // 2, sheet.shape[0] // 2), interpolation=cv2.INTER_AREA)
    out = Path(tempfile.gettempdir()) / f'key-{name}.png'
    cv2.imwrite(str(out), (np.clip(sheet, 0, 1) * 255).astype(np.uint8)[:, :, ::-1])
    print(out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('names', nargs='*')
    parser.add_argument('--preview')
    parser.add_argument('--no-bg', action='store_true')
    parser.add_argument('--mov', action='store_true')
    parser.add_argument('--out')
    args = parser.parse_args()
    if args.out:
        OUT = Path(args.out)
    if args.no_bg:
        for name in args.names or [p.stem.rsplit('_', 1)[-1] for p in sorted(SOURCE.glob('*.mp4'))]:
            export_no_bg(source_config(name), args.mov)
        sys.exit()
    names = args.names or list(CLIPS)
    if args.preview:
        for name in names:
            preview(name, [int(x) for x in args.preview.split(',')])
        sys.exit()
    with tempfile.TemporaryDirectory() as work:
        for name in names:
            render(name, Path(work))
