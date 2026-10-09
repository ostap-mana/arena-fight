import io
import sys
import json
from PIL import Image


def fit(img, side):
    w, h = img.size
    k = min(1.0, side / max(w, h)) if side else 1.0
    if k >= 1.0:
        return img, False
    return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS), True


def reduce_bits(img, bits):
    if not bits or bits >= 8:
        return img
    drop = 8 - bits
    half = 1 << (drop - 1)
    return img.point(lambda v: min(255, (v >> drop << drop) + half))


def encode(job):
    with open(job["src"], "rb") as f:
        source = f.read()
    img = Image.open(io.BytesIO(source))
    img.load()
    mode = "RGBA" if img.mode in ("RGBA", "LA", "PA") else "RGB"
    img = img.convert(mode)
    img, resized = fit(img, job.get("max", 0))
    buf = io.BytesIO()
    if job.get("normal"):
        img = reduce_bits(img, job.get("bits", 8))
        img.save(buf, "WEBP", lossless=True, quality=100, method=6, exact=mode == "RGBA")
    elif resized:
        img.save(buf, "WEBP", quality=job.get("quality", 90), alpha_quality=100, method=6, exact=mode == "RGBA")
    else:
        return source
    data = buf.getvalue()
    return data if resized or len(data) < len(source) else source


def main():
    jobs = json.load(sys.stdin)
    for job in jobs:
        with open(job["out"], "wb") as f:
            f.write(encode(job))


if __name__ == "__main__":
    main()
