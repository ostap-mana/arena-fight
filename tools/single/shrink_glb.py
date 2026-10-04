import io
import os
import re
import sys
import json
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))
import optimize_glb as og

FLOAT, BYTE, UBYTE, SHORT, USHORT, UINT = og.FLOAT, og.BYTE, og.UBYTE, og.SHORT, og.USHORT, og.UINT
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = og.ARRAY_BUFFER, og.ELEMENT_ARRAY_BUFFER
FLAT_NORMAL = (128, 128, 255)


def texture_roles(gltf):
    roles = {}

    def mark(info, role):
        if not info:
            return
        tex = gltf["textures"][info["index"]]
        src = tex.get("source", (tex.get("extensions", {}).get("EXT_texture_webp") or {}).get("source"))
        if src is not None:
            roles.setdefault(src, role)

    for m in gltf.get("materials", []):
        mark(m.get("normalTexture"), "normal")
        pbr = m.get("pbrMetallicRoughness", {})
        mark(pbr.get("baseColorTexture"), "color")
        mark(m.get("emissiveTexture"), "color")
        mark(m.get("occlusionTexture"), "data")
        mark(pbr.get("metallicRoughnessTexture"), "data")
    return roles


def encode_image(data, role, profile):
    img = Image.open(io.BytesIO(data))
    alpha = og.image_alpha(data)
    img = img.convert("RGBA" if alpha else "RGB")
    side = profile["normal_max"] if role == "normal" else profile["tex_max"]
    if role == "normal" and side == 0:
        img = Image.new("RGB", (4, 4), FLAT_NORMAL)
    elif max(img.size) > side:
        k = side / max(img.size)
        img = img.resize((max(4, round(img.width * k)), max(4, round(img.height * k))), Image.LANCZOS)
    buf = io.BytesIO()
    quality = profile["normal_quality"] if role == "normal" else profile["quality"]
    img.save(buf, "WEBP", quality=quality, alpha_quality=profile["alpha_quality"], method=6)
    return buf.getvalue()


def keep_clip(name, profile):
    if re.search(profile["drop_clips"], name):
        return False
    keep = profile.get("keep_clips")
    return not keep or bool(re.search(keep, name))


def shrink(path, out_path, profile):
    gltf, bin_data = og.read_glb(path)
    src = og.Source(gltf, bin_data)
    og.ROT_TOL = profile["rot_tol"]
    og.POS_TOL = profile["pos_tol"]
    og.SCALE_TOL = profile["scale_tol"]
    b = og.Builder()
    remap = {}

    def keep_acc(ai):
        if ai not in remap:
            a = gltf["accessors"][ai]
            remap[ai] = b.accessor(src.accessor(ai), a["componentType"] if not a.get("normalized") else FLOAT, a["type"], minmax="min" in a)
        return remap[ai]

    attr_cache = {}
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            attrs = {}
            for name, ai in prim["attributes"].items():
                key = (name, ai)
                if key not in attr_cache:
                    a = gltf["accessors"][ai]
                    arr = src.accessor(ai)
                    if name == "NORMAL":
                        attr_cache[key] = b.accessor(og.quant_normals(arr), BYTE, "VEC3", ARRAY_BUFFER, normalized=True, stride=4)
                    elif name == "TANGENT":
                        attr_cache[key] = b.accessor(np.clip(np.round(arr * 127.0), -127, 127), BYTE, "VEC4", ARRAY_BUFFER, normalized=True)
                    elif name == "WEIGHTS_0":
                        attr_cache[key] = b.accessor(og.quant_weights(arr.astype(np.float64)), UBYTE, "VEC4", ARRAY_BUFFER, normalized=True)
                    elif name == "JOINTS_0" and arr.max() < 256:
                        attr_cache[key] = b.accessor(arr.astype(np.uint8), UBYTE, "VEC4", ARRAY_BUFFER)
                    elif name.startswith("COLOR_"):
                        attr_cache[key] = b.accessor(np.round(np.clip(arr, 0, 1) * 255), UBYTE, a["type"], ARRAY_BUFFER, normalized=True)
                    elif name.startswith("TEXCOORD_") and arr.min() >= 0.0 and arr.max() <= 1.0:
                        attr_cache[key] = b.accessor(np.round(arr * 65535), USHORT, "VEC2", ARRAY_BUFFER, normalized=True)
                    else:
                        attr_cache[key] = b.accessor(arr, a["componentType"] if not a.get("normalized") else FLOAT, a["type"], ARRAY_BUFFER, minmax=name == "POSITION")
                attrs[name] = attr_cache[key]
            prim["attributes"] = attrs
            targets = prim.get("targets")
            if targets:
                prim["targets"] = [{n: keep_acc(ai) for n, ai in t.items()} for t in targets]
            if "indices" in prim:
                key = ("indices", prim["indices"])
                if key not in attr_cache:
                    idx = src.accessor(prim["indices"]).reshape(-1)
                    attr_cache[key] = b.accessor(idx, USHORT if idx.max() < 65535 else UINT, "SCALAR", ELEMENT_ARRAY_BUFFER)
                prim["indices"] = attr_cache[key]

    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = keep_acc(skin["inverseBindMatrices"])

    anims = [a for a in gltf.get("animations", []) if keep_clip(a.get("name", ""), profile)]
    keys_before = keys_after = 0
    for anim in anims:
        for ch in anim["channels"]:
            s = anim["samplers"][ch["sampler"]]
            if "_done" in s:
                continue
            t = src.accessor(s["input"]).reshape(-1).astype(np.float64)
            v = src.accessor(s["output"]).astype(np.float64)
            target = ch["target"]["path"]
            keys_before += len(t)
            if s.get("interpolation", "LINEAR") == "LINEAR" and target in ("rotation", "translation", "scale"):
                t, v = og.reduce_keys(t, v, target)
            keys_after += len(t)
            s["input"] = b.accessor(t.astype(np.float32), FLOAT, "SCALAR", minmax=True, share=True)
            if target == "rotation":
                s["output"] = b.accessor(np.round(np.clip(v, -1, 1) * 32767), SHORT, "VEC4", normalized=True, share=True)
            else:
                s["output"] = b.accessor(v.astype(np.float32), FLOAT, "VEC3" if v.shape[1] == 3 else "VEC4", share=True)
            s["_done"] = True
        for s in anim["samplers"]:
            s.pop("_done", None)
    gltf["animations"] = anims
    if not anims:
        gltf.pop("animations", None)

    roles = texture_roles(gltf)
    for ii, im in enumerate(gltf.get("images", [])):
        data = src.view_bytes(im["bufferView"])
        data = encode_image(data, roles.get(ii, "color"), profile)
        im["mimeType"] = "image/webp"
        im["bufferView"] = b.view(data)
    if gltf.get("images"):
        for tex in gltf.get("textures", []):
            if "source" in tex:
                tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": tex.pop("source")}
        for k in ("extensionsUsed", "extensionsRequired"):
            lst = gltf.setdefault(k, [])
            if "EXT_texture_webp" not in lst:
                lst.append("EXT_texture_webp")
    for k in ("extensionsUsed", "extensionsRequired"):
        lst = gltf.setdefault(k, [])
        if "KHR_mesh_quantization" not in lst:
            lst.append("KHR_mesh_quantization")

    for a in b.accessors:
        for k in ("min", "max"):
            if k in a:
                a[k] = [float("%.6g" % x) for x in a[k]]
    gltf["accessors"] = b.accessors
    gltf["bufferViews"] = b.views
    blob = b.data()
    gltf["buffers"] = [{"byteLength": len(blob) + (4 - len(blob) % 4) % 4}]
    og.write_glb(out_path, gltf, blob)
    return {"file": os.path.basename(path), "before": os.path.getsize(path), "after": os.path.getsize(out_path), "clips": len(anims), "keys": [keys_before, keys_after]}


def main(argv):
    jobs = json.load(open(argv[0], encoding="utf8"))
    report = [shrink(j["src"], j["out"], j["profile"]) for j in jobs]
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
