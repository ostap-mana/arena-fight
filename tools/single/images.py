import io
import sys
import json
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageChops

FLAT_NORMAL = (128, 128, 255)
VISIBLE = 0.5 / 255


def has_alpha(img):
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA").getchannel("A").getextrema()[0] < 250
    return False


def is_gray(img):
    rgb = img.convert("RGB")
    r, g, b = rgb.split()
    return ImageChops.difference(r, g).getextrema()[1] <= 3 and ImageChops.difference(g, b).getextrema()[1] <= 3


def resample(plane, size):
    return np.asarray(Image.fromarray(plane, "F").resize(size, Image.LANCZOS))


def fit_rgba(img, size):
    src = np.asarray(img, dtype=np.float32) / 255
    alpha = np.clip(resample(src[..., 3], size), 0, 1)
    out = np.empty((size[1], size[0], 4), np.float32)
    out[..., 3] = alpha
    shown = alpha > VISIBLE
    for c in range(3):
        straight = resample(src[..., c], size)
        weighted = resample(src[..., c] * src[..., 3], size) / np.maximum(alpha, VISIBLE)
        out[..., c] = np.where(shown, weighted, straight)
    return Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")


def fit(img, side, scale):
    w, h = img.size
    k = min(1.0, scale, side / max(w, h)) if side else min(1.0, scale)
    if k >= 1.0:
        return img
    size = (max(1, round(w * k)), max(1, round(h * k)))
    if img.mode == "RGBA":
        return fit_rgba(img, size)
    return img.resize(size, Image.LANCZOS)


ALPHA_STEPS = (70, 72, 74, 75, 76, 78, 80, 85, 90, 100)


def shape_alpha(img, job):
    floor = job.get("alpha_floor", 0)
    binary = job.get("alpha_binary", False)
    if img.mode != "RGBA" or not (floor or binary):
        return img
    arr = np.array(img)
    a = arr[..., 3]
    arr[..., 3] = np.where(a > 0, 255, 0) if binary else np.maximum(a, floor)
    return Image.fromarray(arr, "RGBA")


def webp_at(img, job, alpha, alpha_quality):
    buf = io.BytesIO()
    exact = alpha and job.get("exact", True)
    if job.get("lossless"):
        img.save(buf, "WEBP", lossless=True, quality=100, method=6, exact=exact)
    else:
        img.save(buf, "WEBP", quality=job.get("webp_quality", job.get("quality", 70)), alpha_quality=alpha_quality, method=6, exact=exact)
    return buf.getvalue()


def alpha_error(data, want):
    got = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA").getchannel("A"), dtype=np.int16)
    worst = int(np.abs(got - want).max())
    eaten = bool(((want >= 4) & (got == 0)).any())
    return worst, eaten


def webp(img, job, alpha):
    tolerance = job.get("alpha_tolerance")
    if not alpha or tolerance is None or job.get("lossless"):
        return webp_at(img, job, alpha, job.get("alpha_quality", 80))
    want = np.asarray(img.getchannel("A"), dtype=np.int16)
    best = None
    for step in job.get("alpha_steps", ALPHA_STEPS):
        data = webp_at(img, job, alpha, step)
        worst, eaten = alpha_error(data, want)
        if worst <= tolerance and not eaten and (best is None or len(data) < len(best)):
            best = data
    return best if best is not None else webp_at(img, job, alpha, 100)


def avif(img, job, alpha, gray):
    buf = io.BytesIO()
    sub = "4:0:0" if gray and not alpha else job.get("subsampling", "4:2:0")
    img.save(buf, "AVIF", quality=job.get("quality", 60), subsampling=sub, speed=job.get("speed", 2), icc_profile=None, exif=b"", xmp=b"")
    return buf.getvalue()


def encode(job):
    with open(job["src"], "rb") as f:
        img = Image.open(io.BytesIO(f.read()))
        img.load()
    if job.get("flat_normal"):
        img = Image.new("RGB", (4, 4), FLAT_NORMAL)
    alpha = has_alpha(img) and not job.get("opaque")
    img = img.convert("RGBA" if alpha else "RGB")
    img = shape_alpha(fit(img, job.get("max", 0), job.get("scale", 1.0)), job)
    fmt = job.get("format", "webp")
    data = None
    if fmt in ("avif", "auto") and not job.get("lossless"):
        gray = is_gray(img)
        data = avif(img, job, alpha, gray)
        kind = "avif"
        if fmt == "auto" or len(data) < 600:
            alt = webp(img, job, alpha)
            if len(alt) < len(data):
                data, kind = alt, "webp"
    if data is None:
        data, kind = webp(img, job, alpha), "webp"
    with open(job["out"], "wb") as f:
        f.write(data)
    return {"out": job["out"], "size": len(data), "w": img.width, "h": img.height, "alpha": alpha, "kind": kind}


def main(argv):
    jobs = json.load(open(argv[0], encoding="utf8"))
    with Pool() as pool:
        results = pool.map(encode, jobs, chunksize=1)
    print(json.dumps(results))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
