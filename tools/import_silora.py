import json
import os
import struct
import sys

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
FLIP = np.array([-1.0, 1.0, -1.0])
MAT_SIGN = np.outer([-1.0, 1.0, -1.0, 1.0], [-1.0, 1.0, -1.0, 1.0])


def read_glb(path):
    data = open(path, "rb").read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    offset = 20 + length
    bin_length = struct.unpack_from("<I", data, offset)[0]
    return gltf, data[offset + 8:offset + 8 + bin_length]


def write_glb(path, gltf, blob):
    text = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    text += b" " * ((4 - len(text) % 4) % 4)
    blob += b"\0" * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
        fh.write(struct.pack("<II", len(blob), 0x004E4942) + blob)


def accessor_array(gltf, blob, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    dtype = COMPONENT[acc["componentType"]]
    width = WIDTH[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride")
    item = np.dtype(dtype).itemsize * width
    if stride and stride != item:
        rows = [np.frombuffer(blob, dtype, width, start + i * stride) for i in range(acc["count"])]
        return np.array(rows)
    return np.frombuffer(blob, dtype, acc["count"] * width, start).reshape(acc["count"], width).copy()


def to_float(arr, acc):
    if acc.get("normalized"):
        info = np.iinfo(arr.dtype)
        return np.maximum(arr.astype(np.float32) / info.max, -1.0)
    return arr.astype(np.float32)


class Packer:
    def __init__(self):
        self.blob = bytearray()
        self.views = []

    def add(self, raw, target=None):
        while len(self.blob) % 4:
            self.blob.append(0)
        view = {"buffer": 0, "byteOffset": len(self.blob), "byteLength": len(raw)}
        if target:
            view["target"] = target
        self.blob.extend(raw)
        self.views.append(view)
        return len(self.views) - 1


def rotate_node(node):
    if "translation" in node:
        x, y, z = node["translation"]
        node["translation"] = [-x, y, -z]
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        node["rotation"] = [-x, y, -z, w]
    if "matrix" in node:
        m = np.array(node["matrix"]).reshape(4, 4).T
        node["matrix"] = (m * MAT_SIGN).T.reshape(-1).tolist()


def convert(src, dst, keep_clips=None, images=None, material_patch=None):
    gltf, blob = read_glb(src)
    usage = {}
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            for name, index in prim["attributes"].items():
                usage[index] = name
            if "indices" in prim:
                usage[prim["indices"]] = "INDICES"
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            usage[skin["inverseBindMatrices"]] = "IBM"
    animations = gltf.get("animations", [])
    if keep_clips is not None:
        animations = [a for a in animations if a.get("name") in keep_clips]
    gltf["animations"] = animations
    for anim in animations:
        for ch in anim["channels"]:
            sampler = anim["samplers"][ch["sampler"]]
            usage.setdefault(sampler["input"], "TIME")
            usage[sampler["output"]] = "ANIM_" + ch["target"]["path"]

    for node in gltf["nodes"]:
        rotate_node(node)

    packer = Packer()
    new_accessors = []
    remap = {}
    for index in sorted(usage):
        kind = usage[index]
        acc = dict(gltf["accessors"][index])
        arr = accessor_array(gltf, blob, index)
        target = 34963 if kind == "INDICES" else (34962 if kind in ("POSITION", "NORMAL", "TANGENT", "TEXCOORD_0", "TEXCOORD_1", "JOINTS_0", "WEIGHTS_0", "COLOR_0") else None)
        if kind in ("POSITION", "NORMAL", "ANIM_translation"):
            arr = to_float(arr, acc) * FLIP
            acc["componentType"] = 5126
            acc.pop("normalized", None)
        elif kind == "TANGENT":
            arr = to_float(arr, acc)
            arr[:, :3] *= FLIP
            acc["componentType"] = 5126
            acc.pop("normalized", None)
        elif kind == "ANIM_rotation":
            arr = to_float(arr, acc)
            arr[:, 0] *= -1
            arr[:, 2] *= -1
            acc["componentType"] = 5126
            acc.pop("normalized", None)
        elif kind == "IBM":
            mats = arr.astype(np.float32).reshape(-1, 4, 4)
            arr = (np.transpose(mats, (0, 2, 1)) * MAT_SIGN).transpose(0, 2, 1).reshape(-1, 16)
        arr = np.ascontiguousarray(arr.astype(COMPONENT[acc["componentType"]]))
        if kind in ("POSITION", "ANIM_translation") or "min" in acc:
            flat = arr.reshape(acc["count"], -1).astype(np.float64)
            if kind in ("POSITION", "TIME", "ANIM_translation", "ANIM_rotation", "ANIM_scale") or "min" in acc:
                acc["min"] = flat.min(axis=0).tolist()
                acc["max"] = flat.max(axis=0).tolist()
        acc["bufferView"] = packer.add(arr.tobytes(), target)
        acc.pop("byteOffset", None)
        acc.pop("sparse", None)
        remap[index] = len(new_accessors)
        new_accessors.append(acc)

    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: remap[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = remap[prim["indices"]]
            prim.pop("targets", None)
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = remap[skin["inverseBindMatrices"]]
    for anim in animations:
        for sampler in anim["samplers"]:
            sampler["input"] = remap[sampler["input"]]
            sampler["output"] = remap[sampler["output"]]
    gltf["accessors"] = new_accessors

    if images is not None:
        gltf["images"] = []
        gltf["textures"] = []
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
        for name, raw in images:
            view = packer.add(raw)
            gltf["images"].append({"name": name, "mimeType": "image/webp", "bufferView": view})
            gltf["textures"].append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(gltf["images"]) - 1}}})
    else:
        kept = []
        for img in gltf.get("images", []):
            if "bufferView" in img:
                start = gltf["bufferViews"][img["bufferView"]].get("byteOffset", 0)
                length = gltf["bufferViews"][img["bufferView"]]["byteLength"]
                img = dict(img)
                img["bufferView"] = packer.add(blob[start:start + length])
            kept.append(img)
        if kept:
            gltf["images"] = kept
    if material_patch:
        for mat in gltf.get("materials", []):
            patch = material_patch(mat)
            if patch:
                mat.clear()
                mat.update(patch)

    gltf["bufferViews"] = packer.views
    gltf["buffers"] = [{"byteLength": len(packer.blob)}]
    used = set(gltf.get("extensionsUsed", []))
    if gltf.get("images") and any(t.get("extensions", {}).get("EXT_texture_webp") for t in gltf.get("textures", [])):
        used.add("EXT_texture_webp")
    used.discard("KHR_mesh_quantization")
    gltf["extensionsUsed"] = sorted(used)
    if "extensionsRequired" in gltf:
        gltf["extensionsRequired"] = [e for e in gltf["extensionsRequired"] if e in used]
        if not gltf["extensionsRequired"]:
            del gltf["extensionsRequired"]
    write_glb(dst, gltf, bytes(packer.blob))
    return gltf


def hero(src_dir, code, project):
    lower = code.lower()
    ours_path = os.path.join(project, "public", "assets", "glb", f"{lower}.glb")
    ours, ours_blob = read_glb(ours_path)
    images = []
    by_name = {}
    for img in ours["images"]:
        view = ours["bufferViews"][img["bufferView"]]
        start = view.get("byteOffset", 0)
        images.append((img["name"], ours_blob[start:start + view["byteLength"]]))
        by_name[img["name"]] = len(images) - 1
    ours_mats = {m["name"]: m for m in ours["materials"]}

    def texture_of(mat, slot):
        info = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture") if slot == "base" else mat.get("normalTexture")
        if not info:
            return None
        tex = ours["textures"][info["index"]]
        source = tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source", tex.get("source"))
        return by_name[ours["images"][source]["name"]]

    def patch(mat):
        mine = ours_mats.get(mat["name"])
        if not mine:
            return None
        out = json.loads(json.dumps(mine))
        base = texture_of(mine, "base")
        normal = texture_of(mine, "normal")
        if base is not None:
            out["pbrMetallicRoughness"]["baseColorTexture"] = {"index": base}
        if normal is not None:
            out["normalTexture"] = {"index": normal}
        return out

    manifest = json.load(open(os.path.join(src_dir, "manifest.json"), encoding="utf8"))
    keep = set(c["name"] for c in manifest["clips"] if c["role"])
    keep |= {"Shock", "Freeze", "Dash", "Walk", "IdleBreak", "Death"}
    out = convert(os.path.join(src_dir, manifest["glb"]), ours_path, keep, images, patch)
    print(f"{lower}.glb", os.path.getsize(ours_path), "clips", sorted(a["name"] for a in out["animations"]))
    return manifest


def fx_model(src_dir, fx_name, project, dst_name):
    path = os.path.join(src_dir, "fx", "models", f"{fx_name}.m0.glb")
    dst = os.path.join(project, "public", "assets", "glb", f"{dst_name}.glb")
    out = convert(path, dst)
    print(f"{dst_name}.glb", os.path.getsize(dst), "clips", [a["name"] for a in out.get("animations", [])])


def fx_id(file):
    return os.path.basename(file).replace(".playable-fx.json", "")


def curve(c):
    if not c or not c.get("enabled"):
        return None
    return {
        "samples": [round(x, 4) for x in c["samples"]],
        "mul": c.get("multiplier", 1),
        "range": c.get("multiplier_range"),
        "byDistance": bool(c.get("multiply_by_distance")),
        "randomSide": bool(c.get("random_side")),
    }


def projectile_spec(f, b):
    p = b.get("projectile") or {}
    motion = f.get("motion") or {}
    return {
        "speed": motion.get("speed", 20),
        "mode": motion.get("mode", "fixed_speed"),
        "flight": motion.get("total_time", 1),
        "forward": p.get("forward_offset", 0),
        "progress": curve(p.get("position_curve")),
        "side": curve(p.get("side_curve")),
        "height": curve(p.get("height_curve")),
        "impact": [],
    }


def chain_length(fx):
    lengths = []
    for e in fx.get("emitters", []):
        r = e.get("renderer", {})
        pivot = r.get("pivot") or [0, 0, 0]
        if r.get("mode") != "mesh" or not pivot[0]:
            continue
        size = e["main"]["start_size"]
        sx = size["x"] if size.get("separate_axes") else size
        lengths.append(sx.get("constant", 1))
    return min(lengths) if lengths else 1


def ambient_fx(manifest, lib, index, a):
    name = fx_id(a["file"])
    if name in lib["prefabs"]:
        return name, a["socket"]
    for e in manifest.get("anim_events", []):
        if any(t["ambient"] == index for t in e["targets"]):
            guess = e["name"][:-4] if e["name"].endswith("_Off") else e["name"]
            if guess in lib["prefabs"]:
                return guess, guess
    return name, a["socket"]


def script(src_dir, manifest, project, models=None):
    lower = manifest["code"].lower()
    lib_path = os.path.join(project, "public", "assets", "vfx", f"{lower}.json")
    lib = json.load(open(lib_path, encoding="utf8"))
    sources = {}

    def source(file):
        key = fx_id(file)
        if key not in sources:
            sources[key] = json.load(open(os.path.join(src_dir, file), encoding="utf8"))
        return sources[key]

    clips = {c["role"]: c["name"] for c in manifest["clips"] if c["role"]}
    skills = {}
    for skill in manifest["skills"]:
        entries = []
        shots = {}
        for f in skill["fx"]:
            fx = source(f["file"])
            b = fx["behaviour"]
            name = fx_id(f["file"])
            if name not in lib["prefabs"]:
                print("missing prefab", name)
                continue
            entry = {
                "fx": name,
                "kind": b["kind"],
                "socket": b.get("socket"),
                "target": b.get("target_socket"),
                "follow": bool(b.get("follow")),
                "copyRot": b.get("copy_rotation"),
                "toProducer": bool(b.get("rotate_to_producer")),
                "camOffset": (b.get("camera_offset") or {}).get("distance", 0),
                "dying": b.get("dying_time", 1),
            }
            if b["kind"] == "target" and entry["target"] == "FX_Bot" and not entry["follow"]:
                entry["area"] = True
            if f.get("trigger") == "projectile_hit":
                shot = shots.get(fx_id(f["projectile"])) if f.get("projectile") else None
                if shot:
                    shot["impact"].append(entry)
                else:
                    print("orphan projectile hit", name)
                continue
            if not f.get("time"):
                print("no time", name)
                continue
            entry["clip"] = clips.get(f["time"]["clip"], f["time"]["clip"])
            entry["t"] = round(f["time"]["t"], 4)
            if b["kind"] == "projectile":
                entry.update(projectile_spec(f, b))
                shots[name] = entry
            elif b["kind"] == "chaining":
                entry["length"] = chain_length(fx)
                entry["spawnAt"] = (b.get("chain") or {}).get("spawn_at", "producer")
            entries.append(entry)
        skills[skill["type"]] = {"clips": [clips.get(c, c) for c in skill["clips"]], "fx": entries}
    ambient = []
    for i, a in enumerate(manifest["ambient"]):
        name, socket = ambient_fx(manifest, lib, i, a)
        ambient.append({"fx": name, "socket": socket, "active": a["active"]})
    anim_events = manifest.get("anim_events", [])
    toggles = {e["name"]: {"value": e["value"], "ambient": sorted({t["ambient"] for t in e["targets"]})} for e in anim_events}
    events = {}
    for c in manifest["clips"]:
        hits = [[round(e["t"], 4), e["arg"]] for e in c["events"] if e["name"] == "OnVFX" and e["arg"] in toggles]
        if hits:
            events[c["name"]] = hits
    lib["script"] = {"source": manifest["source"], "skills": skills, "ambient": ambient, "toggles": toggles, "events": events}
    if models:
        lib["script"]["models"] = models
    with open(lib_path, "w", encoding="utf8") as fh:
        json.dump(lib, fh, separators=(",", ":"))
    print("script", sorted(skills), "ambient", [(a["fx"], a["socket"]) for a in ambient], "events", sorted(events))


def material_spec(mat):
    vfx = mat.get("vfx_material")
    textures = mat.get("source", {}).get("textures", {})
    if vfx:
        return {
            "shader": vfx.get("shader"),
            "floats": vfx.get("floats", {}),
            "colors": vfx.get("colors", {}),
            "keywords": vfx.get("keywords", []),
            "texture": textures.get("_BaseMap"),
        }
    return {
        "shader": mat.get("source", {}).get("shader"),
        "floats": {},
        "colors": {"_Tint": mat.get("tint", [1, 1, 1, 1])},
        "keywords": [],
        "texture": textures.get("_MainTex") or textures.get("_BaseMap"),
    }


def fx_models(src_dir, fx_name, model_id):
    fx = json.load(open(os.path.join(src_dir, "fx", f"{fx_name}.playable-fx.json"), encoding="utf8"))
    out = {}
    for m in fx.get("models", []):
        info = json.load(open(os.path.join(src_dir, "fx", m["manifest"]), encoding="utf8"))
        t = m["transform"]["t"]
        r = m["transform"]["r"]
        out[fx_name] = {
            "model": model_id,
            "node": m["name"],
            "t": [-t[0], t[1], -t[2]],
            "r": [-r[0], r[1], -r[2], r[3]],
            "s": m["transform"]["s"],
            "clip": m["timeline"][0]["clip"] if m.get("timeline") else None,
            "material": material_spec(info["materials"][0]),
            "materials": {mat["name"]: material_spec(mat) for mat in info["materials"]},
            "bind": sorted({e["name"] for e in fx["emitters"] if e.get("bind")}),
        }
    return out


def model_fx_names(src_dir, manifest):
    names = []
    for skill in manifest["skills"]:
        for f in skill["fx"]:
            name = fx_id(f["file"])
            fx = json.load(open(os.path.join(src_dir, f["file"]), encoding="utf8"))
            if fx.get("models") and name not in names:
                names.append(name)
    return names


if __name__ == "__main__":
    src_dir, code = sys.argv[1], sys.argv[2]
    project = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    manifest = hero(src_dir, code, project)
    named = {sys.argv[3]: sys.argv[4]} if len(sys.argv) > 4 else {}
    models = {}
    for fx_name in model_fx_names(src_dir, manifest):
        model_id = named.get(fx_name) or f"fx_{code.lower()}_{fx_name.split('_')[-1].lower()}"
        fx_model(src_dir, fx_name, project, model_id)
        models.update(fx_models(src_dir, fx_name, model_id))
    script(src_dir, manifest, project, models or None)
