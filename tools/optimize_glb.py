import io
import os
import re
import sys
import json
import struct
import subprocess
import tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GLB_DIR = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "glb"))
LOBBY_CLIPS = re.compile(r"(LOB(_\d+)?|^Idle)$")
ROT_TOL = 0.0015
POS_TOL = 0.0008
SCALE_TOL = 0.001
ALBEDO_QUALITY = 90
ALPHA_QUALITY = 75
MESHOPT_TOOL = os.path.join(HERE, "meshopt_glb.mjs")
MESHOPT = "EXT_meshopt_compression"

FLOAT, BYTE, UBYTE, SHORT, USHORT, UINT = 5126, 5120, 5121, 5122, 5123, 5125
DTYPE = {FLOAT: np.float32, BYTE: np.int8, UBYTE: np.uint8, SHORT: np.int16, USHORT: np.uint16, UINT: np.uint32}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def meshopt(*args):
    subprocess.run(["node", MESHOPT_TOOL, *args], check=True, stdout=subprocess.DEVNULL)


def read_glb(path):
    data = open(path, "rb").read()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    off = 20 + json_len
    bin_len = struct.unpack_from("<I", data, off)[0]
    return gltf, data[off + 8:off + 8 + bin_len]


def write_glb(path, gltf, bin_data):
    js = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    js += b" " * ((4 - len(js) % 4) % 4)
    bin_data += b"\0" * ((4 - len(bin_data) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_data)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bin_data), 0x004E4942))
        f.write(bin_data)


class Source:
    def __init__(self, gltf, bin_data):
        self.g = gltf
        self.bin = bin_data

    def view_bytes(self, vi):
        v = self.g["bufferViews"][vi]
        o = v.get("byteOffset", 0)
        return self.bin[o:o + v["byteLength"]]

    def accessor(self, ai):
        a = self.g["accessors"][ai]
        n = COMPONENTS[a["type"]]
        dt = np.dtype(DTYPE[a["componentType"]])
        v = self.g["bufferViews"][a["bufferView"]]
        base = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = v.get("byteStride") or dt.itemsize * n
        raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=base)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], dt.itemsize * n), strides=(stride, 1))
        arr = np.ascontiguousarray(rows).view(dt).reshape(a["count"], n)
        if a.get("normalized"):
            arr = normalized_to_float(arr, a["componentType"])
        return arr


def normalized_to_float(arr, ctype):
    if ctype == BYTE:
        return np.maximum(arr.astype(np.float32) / 127.0, -1.0)
    if ctype == UBYTE:
        return arr.astype(np.float32) / 255.0
    if ctype == SHORT:
        return np.maximum(arr.astype(np.float32) / 32767.0, -1.0)
    if ctype == USHORT:
        return arr.astype(np.float32) / 65535.0
    return arr.astype(np.float32)


class Builder:
    def __init__(self):
        self.chunks = []
        self.size = 0
        self.views = []
        self.accessors = []
        self.dedupe = {}

    def view(self, data, target=None, stride=None):
        pad = (4 - self.size % 4) % 4
        if pad:
            self.chunks.append(b"\0" * pad)
            self.size += pad
        v = {"buffer": 0, "byteOffset": self.size, "byteLength": len(data)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        self.chunks.append(data)
        self.size += len(data)
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, atype, target=None, normalized=False, minmax=False, stride=None, share=False):
        arr = np.ascontiguousarray(arr, dtype=DTYPE[ctype])
        n = COMPONENTS[atype]
        if stride and stride != arr.dtype.itemsize * n:
            padded = np.zeros((arr.shape[0], stride), np.uint8)
            padded[:, :arr.dtype.itemsize * n] = arr.reshape(arr.shape[0], -1).view(np.uint8)
            data = padded.tobytes()
        else:
            data = arr.tobytes()
            stride = None
        key = (data, ctype, atype, normalized) if share else None
        if key and key in self.dedupe:
            return self.dedupe[key]
        a = {"bufferView": self.view(data, target, stride), "componentType": ctype, "count": int(arr.shape[0]), "type": atype}
        if normalized:
            a["normalized"] = True
        if minmax:
            flat = arr.reshape(arr.shape[0], -1).astype(np.float64)
            a["min"] = [float(x) for x in flat.min(axis=0)]
            a["max"] = [float(x) for x in flat.max(axis=0)]
        self.accessors.append(a)
        idx = len(self.accessors) - 1
        if key:
            self.dedupe[key] = idx
        return idx

    def data(self):
        return b"".join(self.chunks)


def quant_normals(n):
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return np.clip(np.round(n / ln * 127.0), -127, 127).astype(np.int8)


def quant_weights(w):
    s = w.sum(axis=1, keepdims=True)
    s[s == 0] = 1
    w = w / s * 255.0
    q = np.floor(w).astype(np.int32)
    rem = 255 - q.sum(axis=1)
    frac = w - q
    order = np.argsort(-frac, axis=1)
    for k in range(4):
        add = (rem > k).astype(np.int32)
        np.add.at(q, (np.arange(len(q)), order[:, k]), add)
    return np.clip(q, 0, 255).astype(np.uint8)


def reduce_keys(t, v, path):
    n = len(t)
    if n <= 2:
        return t, v
    if path == "rotation":
        def err(a, b, seg, w):
            q = v[a] + (v[b] - v[a]) * w[:, None]
            q /= np.linalg.norm(q, axis=1, keepdims=True)
            d = np.clip(np.abs((q * v[seg]).sum(axis=1)), 0.0, 1.0)
            return float((2.0 * np.arccos(d)).max())
        tol = ROT_TOL
    else:
        def err(a, b, seg, w):
            p = v[a] + (v[b] - v[a]) * w[:, None]
            return float(np.abs(p - v[seg]).max())
        tol = SCALE_TOL if path == "scale" else POS_TOL
    keep = [0]
    a = 0
    while a < n - 1:
        best = a + 1
        b = a + 2
        while b < n:
            seg = np.arange(a + 1, b)
            w = (t[seg] - t[a]) / max(t[b] - t[a], 1e-9)
            if err(a, b, seg, w) > tol:
                break
            best = b
            b += 1
        keep.append(best)
        a = best
    keep = np.array(keep)
    return t[keep], v[keep]


def webp_bytes(data, lossless, has_alpha, max_side=None):
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGBA" if has_alpha else "RGB")
    if max_side and max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    buf = io.BytesIO()
    if lossless:
        img.save(buf, "WEBP", lossless=True, method=6, exact=True)
    else:
        img.save(buf, "WEBP", quality=ALBEDO_QUALITY, alpha_quality=ALPHA_QUALITY, method=6, exact=True)
    return buf.getvalue()


def riff_chunks(data):
    pos, chunks = 12, []
    while pos + 8 <= len(data):
        tag = data[pos:pos + 4]
        size = struct.unpack_from("<I", data, pos + 4)[0]
        chunks.append((tag, data[pos + 8:pos + 8 + size]))
        pos += 8 + size + (size & 1)
    return chunks


def riff_join(chunks):
    body = b"WEBP"
    for tag, payload in chunks:
        body += tag + struct.pack("<I", len(payload)) + payload + (b"\0" if len(payload) & 1 else b"")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def requantize_alpha(data):
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return data
    chunks = riff_chunks(data)
    alpha = next((p for t, p in chunks if t == b"ALPH"), None)
    if alpha is None or (alpha[0] >> 4) & 3:
        return data
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=ALBEDO_QUALITY, alpha_quality=ALPHA_QUALITY, method=6, exact=True)
    fresh = next((p for t, p in riff_chunks(buf.getvalue()) if t == b"ALPH"), None)
    if fresh is None or len(fresh) >= len(alpha):
        return data
    return riff_join([(t, fresh if t == b"ALPH" else p) for t, p in chunks])


def image_alpha(data):
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGBA", "LA", "P"):
        return False
    return bool((np.asarray(img.convert("RGBA"))[..., 3] < 250).any())


def read_plain(path):
    gltf, bin_data = read_glb(path)
    if MESHOPT not in gltf.get("extensionsUsed", []):
        return gltf, bin_data
    fd, plain = tempfile.mkstemp(suffix=".glb")
    os.close(fd)
    try:
        meshopt("--decode", path, plain)
        return read_glb(plain)
    finally:
        os.remove(plain)


def optimize(path, out_path=None, lobby=None, max_tex=None):
    before = os.path.getsize(path)
    gltf, bin_data = read_plain(path)
    src = Source(gltf, bin_data)
    lobby = lobby if lobby is not None else bool(re.search(r"_lob(_m)?\.glb$", path))
    b = Builder()
    remap = {}
    used_quant = False

    def keep_acc(ai):
        if ai not in remap:
            a = gltf["accessors"][ai]
            arr = src.accessor(ai)
            remap[ai] = b.accessor(arr, a["componentType"] if not a.get("normalized") else FLOAT, a["type"], minmax="min" in a)
        return remap[ai]

    attr_cache = {}
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            new_attrs = {}
            for name, ai in prim["attributes"].items():
                key = (name, ai)
                if key not in attr_cache:
                    a = gltf["accessors"][ai]
                    arr = src.accessor(ai)
                    if name == "NORMAL":
                        attr_cache[key] = b.accessor(quant_normals(arr), BYTE, "VEC3", ARRAY_BUFFER, normalized=True, stride=4)
                        used_quant = True
                    elif name == "WEIGHTS_0":
                        attr_cache[key] = b.accessor(quant_weights(arr.astype(np.float64)), UBYTE, "VEC4", ARRAY_BUFFER, normalized=True)
                    elif name == "JOINTS_0" and arr.max() < 256:
                        attr_cache[key] = b.accessor(arr.astype(np.uint8), UBYTE, "VEC4", ARRAY_BUFFER)
                    elif name.startswith("COLOR_"):
                        attr_cache[key] = b.accessor(np.round(np.clip(arr, 0, 1) * 255), UBYTE, a["type"], ARRAY_BUFFER, normalized=True)
                    elif name.startswith("TEXCOORD_") and arr.min() >= 0.0 and arr.max() <= 1.0:
                        attr_cache[key] = b.accessor(np.round(arr * 65535), USHORT, "VEC2", ARRAY_BUFFER, normalized=True)
                        used_quant = True
                    else:
                        attr_cache[key] = b.accessor(arr, a["componentType"] if not a.get("normalized") else FLOAT, a["type"], ARRAY_BUFFER, minmax=name == "POSITION")
                new_attrs[name] = attr_cache[key]
            prim["attributes"] = new_attrs
            if "indices" in prim:
                key = ("indices", prim["indices"])
                if key not in attr_cache:
                    idx = src.accessor(prim["indices"]).reshape(-1)
                    ctype = USHORT if idx.max() < 65535 else UINT
                    attr_cache[key] = b.accessor(idx, ctype, "SCALAR", ELEMENT_ARRAY_BUFFER)
                prim["indices"] = attr_cache[key]

    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = keep_acc(skin["inverseBindMatrices"])

    anims = gltf.get("animations", [])
    if lobby:
        anims = [a for a in anims if LOBBY_CLIPS.search(a["name"])]
    keys_before = keys_after = 0
    for anim in anims:
        for ch in anim["channels"]:
            s = anim["samplers"][ch["sampler"]]
            if "_done" in s:
                continue
            t = src.accessor(s["input"]).reshape(-1).astype(np.float64)
            v = src.accessor(s["output"]).astype(np.float64)
            path_ = ch["target"]["path"]
            keys_before += len(t)
            if s.get("interpolation", "LINEAR") == "LINEAR" and path_ in ("rotation", "translation", "scale"):
                t, v = reduce_keys(t, v, path_)
            keys_after += len(t)
            s["input"] = b.accessor(t.astype(np.float32), FLOAT, "SCALAR", minmax=True, share=True)
            if path_ == "rotation":
                s["output"] = b.accessor(np.round(np.clip(v, -1, 1) * 32767), SHORT, "VEC4", normalized=True, share=True)
            else:
                s["output"] = b.accessor(v.astype(np.float32), FLOAT, "VEC3" if v.shape[1] == 3 else "VEC4", share=True)
            s["_done"] = True
        for s in anim["samplers"]:
            s.pop("_done", None)
    gltf["animations"] = anims
    if not anims:
        gltf.pop("animations", None)

    normal_images = set()
    for m in gltf.get("materials", []):
        nt = m.get("normalTexture")
        if nt is not None:
            tex = gltf["textures"][nt["index"]]
            normal_images.add(tex.get("source", (tex.get("extensions", {}).get("EXT_texture_webp") or {}).get("source")))
    webp_used = "EXT_texture_webp" in gltf.get("extensionsUsed", [])
    for ii, im in enumerate(gltf.get("images", [])):
        data = src.view_bytes(im["bufferView"])
        too_big = max_tex and max(Image.open(io.BytesIO(data)).size) > max_tex
        if im.get("mimeType") == "image/png" or too_big:
            data = webp_bytes(data, ii in normal_images, image_alpha(data), max_tex)
            im["mimeType"] = "image/webp"
            webp_used = True
        elif im.get("mimeType") == "image/webp" and ii not in normal_images:
            data = requantize_alpha(data)
        im["bufferView"] = b.view(data)
    if webp_used:
        for tex in gltf.get("textures", []):
            if "source" in tex:
                src_i = tex.pop("source")
                tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": src_i}
        used = gltf.setdefault("extensionsUsed", [])
        if "EXT_texture_webp" not in used:
            used.append("EXT_texture_webp")
        req = gltf.setdefault("extensionsRequired", [])
        if "EXT_texture_webp" not in req:
            req.append("EXT_texture_webp")
    if used_quant:
        for k in ("extensionsUsed", "extensionsRequired"):
            lst = gltf.setdefault(k, [])
            if "KHR_mesh_quantization" not in lst:
                lst.append("KHR_mesh_quantization")

    gltf["accessors"] = b.accessors
    gltf["bufferViews"] = b.views
    blob = b.data()
    gltf["buffers"] = [{"byteLength": len(blob) + (4 - len(blob) % 4) % 4}]
    target = out_path or path
    write_glb(target, gltf, blob)
    meshopt(target)
    after = os.path.getsize(target)
    log("%s: %.2f MB -> %.2f MB, clips %d, keys %d -> %d" % (os.path.basename(path), before / 1048576, after / 1048576, len(anims), keys_before, keys_after))
    return after


def repack(path):
    before = os.path.getsize(path)
    gltf, bin_data = read_plain(path)
    src = Source(gltf, bin_data)
    normal_images = set()
    for m in gltf.get("materials", []):
        nt = m.get("normalTexture")
        if nt is not None:
            tex = gltf["textures"][nt["index"]]
            normal_images.add(tex.get("source", (tex.get("extensions", {}).get("EXT_texture_webp") or {}).get("source")))
    fresh = {}
    for ii, im in enumerate(gltf.get("images", [])):
        if im.get("mimeType") == "image/webp" and ii not in normal_images and "bufferView" in im:
            fresh[im["bufferView"]] = requantize_alpha(src.view_bytes(im["bufferView"]))
    blob = bytearray()
    for vi, view in enumerate(gltf["bufferViews"]):
        data = fresh.get(vi, src.view_bytes(vi))
        blob += b"\0" * ((4 - len(blob) % 4) % 4)
        view["buffer"] = 0
        view["byteOffset"] = len(blob)
        view["byteLength"] = len(data)
        blob += data
    gltf["buffers"] = [{"byteLength": len(blob) + (4 - len(blob) % 4) % 4}]
    write_glb(path, gltf, bytes(blob))
    meshopt(path)
    after = os.path.getsize(path)
    log("%s: %.2f MB -> %.2f MB (repacked)" % (os.path.basename(path), before / 1048576, after / 1048576))
    return after


def main(argv):
    paths = [a for a in argv if not a.startswith("--")] or sorted(os.path.join(GLB_DIR, f) for f in os.listdir(GLB_DIR) if f.endswith(".glb"))
    if "--repack" in argv:
        for p in paths:
            repack(p)
        return 0
    out_dir = next((a.split("=", 1)[1] for a in argv if a.startswith("--out=")), None)
    max_tex = next((int(a.split("=", 1)[1]) for a in argv if a.startswith("--max-tex=")), None)
    suffix = next((a.split("=", 1)[1] for a in argv if a.startswith("--suffix=")), "")
    for p in paths:
        name = os.path.basename(p)[:-4] + suffix + ".glb"
        out = os.path.join(out_dir or os.path.dirname(p), name) if out_dir or suffix else None
        optimize(p, out, max_tex=max_tex)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
