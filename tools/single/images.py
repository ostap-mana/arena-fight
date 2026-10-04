import io
import sys
import json
from PIL import Image

FLAT_NORMAL = (128, 128, 255)


def has_alpha(img):
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA").getchannel("A").getextrema()[0] < 250
    return False


def fit(img, side, scale):
    w, h = img.size
    k = min(1.0, scale, side / max(w, h)) if side else min(1.0, scale)
    if k >= 1.0:
        return img
    return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def encode(job):
    with open(job["src"], "rb") as f:
        img = Image.open(io.BytesIO(f.read()))
        img.load()
    if job.get("flat_normal"):
        img = Image.new("RGB", (4, 4), FLAT_NORMAL)
    alpha = has_alpha(img)
    img = img.convert("RGBA" if alpha else "RGB")
    img = fit(img, job.get("max", 0), job.get("scale", 1.0))
    buf = io.BytesIO()
    if job.get("lossless"):
        img.save(buf, "WEBP", lossless=True, quality=100, method=6, exact=alpha)
    else:
        img.save(buf, "WEBP", quality=job.get("quality", 70), alpha_quality=job.get("alpha_quality", 80), method=6, exact=alpha)
    data = buf.getvalue()
    with open(job["out"], "wb") as f:
        f.write(data)
    return {"out": job["out"], "size": len(data), "w": img.width, "h": img.height, "alpha": alpha}


def main(argv):
    jobs = json.load(open(argv[0], encoding="utf8"))
    print(json.dumps([encode(j) for j in jobs]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
