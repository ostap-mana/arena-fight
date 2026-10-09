import io
import sys
import json
from multiprocessing import Pool
from PIL import Image, ImageChops

FLAT_NORMAL = (128, 128, 255)


def has_alpha(img):
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA").getchannel("A").getextrema()[0] < 250
    return False


def is_gray(img):
    rgb = img.convert("RGB")
    r, g, b = rgb.split()
    return ImageChops.difference(r, g).getextrema()[1] <= 3 and ImageChops.difference(g, b).getextrema()[1] <= 3


def fit(img, side, scale):
    w, h = img.size
    k = min(1.0, scale, side / max(w, h)) if side else min(1.0, scale)
    if k >= 1.0:
        return img
    return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def webp(img, job, alpha):
    buf = io.BytesIO()
    if job.get("lossless"):
        img.save(buf, "WEBP", lossless=True, quality=100, method=6, exact=alpha)
    else:
        img.save(buf, "WEBP", quality=job.get("webp_quality", job.get("quality", 70)), alpha_quality=job.get("alpha_quality", 80), method=6, exact=alpha)
    return buf.getvalue()


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
    alpha = has_alpha(img)
    img = img.convert("RGBA" if alpha else "RGB")
    img = fit(img, job.get("max", 0), job.get("scale", 1.0))
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
