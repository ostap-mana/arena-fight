import sys
import json
import subprocess
import numpy as np


def decode(path, rate):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def encode(samples, rate, out, codec):
    args = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-", "-c:a", "libmp3lame"]
    if codec.get("vbr") is not None:
        args += ["-q:a", str(codec["vbr"])]
    else:
        args += ["-b:a", f"{codec['kbps']}k"]
    args += ["-ar", str(rate), "-ac", "1", out]
    subprocess.run(args, input=np.clip(samples, -1, 1).astype(np.float32).tobytes(), check=True)


def ramp(n, rising):
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    curve = np.sin(t * np.pi / 2) if rising else np.cos(t * np.pi / 2)
    return curve.astype(np.float32)


def spectrum(x, hop, size=2048, bands=48):
    n = (len(x) - size) // hop
    if n <= 0:
        return np.zeros((0, bands), dtype=np.float32)
    window = np.hanning(size).astype(np.float32)
    idx = np.arange(size)[None, :] + hop * np.arange(n)[:, None]
    mag = np.abs(np.fft.rfft(x[idx] * window, axis=1))
    edges = np.unique(np.geomspace(2, mag.shape[1] - 1, bands + 1).astype(int))
    out = np.stack([mag[:, a:b].sum(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1)
    out = np.log1p(out)
    out -= out.mean(axis=1, keepdims=True)
    out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
    return out


def loop_length(x, start, length, xfade, rate, low=0.8, high=1.2, compare=8.0):
    hop = 512
    seg = x[start:]
    spec = spectrum(seg[: int((length * high) + compare * rate + 4096)], hop)
    window = int(compare * rate) // hop
    head = spec[:window]
    best, best_score = length // hop, -1e9
    for cand in range(int(length * low) // hop, int(length * high) // hop):
        tail = spec[cand:cand + window]
        if len(tail) < window:
            break
        score = float(np.mean(np.sum(head * tail, axis=1)))
        if score > best_score:
            best, best_score = cand, score
    coarse = best * hop
    probe = seg[:xfade] if xfade else seg[: int(0.05 * rate)]
    best_off, best_dot = 0, -1e18
    for off in range(-hop, hop + 1, 2):
        at = coarse + off
        if at < 0 or at + len(probe) > len(seg):
            continue
        dot = float(np.dot(probe, seg[at:at + len(probe)]))
        if dot > best_dot:
            best_off, best_dot = off, dot
    return coarse + best_off, best_score


def music(job, rate):
    x = decode(job["src"], rate)
    start = int(job.get("start", 0) * rate)
    length = int(job["length"] * rate)
    xfade = int(job.get("xfade", 0) * rate)
    if job.get("loop") and xfade and start + int(length * 1.2) + xfade + int(8.0 * rate) < len(x):
        length, score = loop_length(x, start, length, xfade, rate)
        sys.stderr.write("loop %s %.3fs similarity %.3f%s" % (job.get("name", ""), length / rate, score, chr(10)))
    seg = x[start:start + length + xfade].copy()
    if len(seg) < length + xfade:
        seg = np.pad(seg, (0, length + xfade - len(seg)))
    out = seg[:length].copy()
    if job.get("loop") and xfade:
        out[:xfade] = seg[:xfade] * ramp(xfade, True) + seg[length:length + xfade] * ramp(xfade, False)
    else:
        fade_out = int(job.get("fadeOut", 0) * rate)
        if fade_out:
            out[-fade_out:] *= ramp(fade_out, False)
    fade_in = int(job.get("fadeIn", 0) * rate)
    if fade_in:
        out[:fade_in] *= ramp(fade_in, True)
    out *= job.get("gain", 1.0)
    encode(out, rate, job["out"], job["codec"])
    return {"out": job["out"], "seconds": round(len(out) / rate, 3)}


def trim_tail(seg, rate, floor_db):
    level = 10 ** (floor_db / 20)
    loud = np.nonzero(np.abs(seg) > level)[0]
    if not len(loud):
        return seg[: int(0.05 * rate)]
    end = min(len(seg), loud[-1] + int(0.04 * rate))
    return seg[:end]


def sprite(job, rate):
    x = decode(job["src"], rate)
    gap = int(job.get("gap", 0.03) * rate)
    parts = []
    table = {}
    at = 0
    for name, start_ms, dur_ms, cap in job["keys"]:
        a = int(start_ms / 1000 * rate)
        b = int((start_ms + dur_ms) / 1000 * rate)
        seg = trim_tail(x[a:b].copy(), rate, job.get("floor", -48))
        limit = int(cap * rate)
        if len(seg) > limit:
            seg = seg[:limit]
            fade = min(len(seg), int(job.get("capFade", 0.25) * rate))
            seg[-fade:] *= ramp(fade, False)
        parts.append(seg)
        parts.append(np.zeros(gap, dtype=np.float32))
        table[name] = [round(at / rate * 1000, 1), round(len(seg) / rate * 1000, 1)]
        at += len(seg) + gap
    out = np.concatenate(parts) if parts else np.zeros(gap, dtype=np.float32)
    encode(out, rate, job["out"], job["codec"])
    return {"out": job["out"], "sprite": table, "seconds": round(len(out) / rate, 3)}


def main(argv):
    job = json.load(open(argv[0], encoding="utf8"))
    rate = job["rate"]
    results = {"music": [music(m, m.get("rate", rate)) for m in job.get("music", [])], "sprites": [sprite(s, s.get("rate", rate)) for s in job.get("sprites", [])]}
    print(json.dumps(results))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
