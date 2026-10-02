import io
import os
import re
import sys
import json
import struct

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import game_assets as ga
import export_heroes
import optimize_glb
import sakiel_look

GLB_OUT = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "glb"))
BODY_CODE = "CAM021"
WINGS_CODE = "NOC023"
BODY_ID = "sakiel"
WINGS_ID = "sakiel_wings"
WING_MESH = "MESH_Wings"
WING_BONE = re.compile(r"^Wing")
WING_CLIPS = {"Idle", "Run", "Dash", "Death"}
LOOKS = {
    "T_ING_CAM021_Body_Albedo": sakiel_look.body,
    "T_ING_CAM021_Weapon_Albedo": sakiel_look.weapon,
    "T_ING_NOC023_Body_Wings_Albedo": sakiel_look.wings,
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def read_glb(path):
    data = open(path, "rb").read()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    bin_len = struct.unpack_from("<I", data, 20 + json_len)[0]
    return gltf, bytearray(data[bin_start:bin_start + bin_len])


def view_bytes(gltf, binary, index):
    v = gltf["bufferViews"][index]
    start = v.get("byteOffset", 0)
    return bytes(binary[start:start + v["byteLength"]])


def write_glb(path, gltf, binary):
    gltf["buffers"] = [{"byteLength": len(binary)}]
    js = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    js += b" " * ((-len(js)) % 4)
    binary = bytes(binary) + b"\0" * ((-len(binary)) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(binary), 0x004E4942))
        f.write(binary)


def repaint(gltf, binary):
    views = []
    for img in gltf.get("images", []):
        look = LOOKS.get(img.get("name"))
        if look is None:
            views.append(view_bytes(gltf, binary, img["bufferView"]))
            continue
        source = Image.open(io.BytesIO(view_bytes(gltf, binary, img["bufferView"])))
        buf = io.BytesIO()
        look(source).save(buf, format="PNG", optimize=True)
        views.append(buf.getvalue())
        log(f"  repainted {img['name']}")
    return views


def compact(gltf, binary, image_data=None):
    used_acc = []

    def use(i):
        if i is not None and i not in used_acc:
            used_acc.append(i)

    for mesh in gltf.get("meshes", []):
        for prim in mesh["primitives"]:
            for a in prim["attributes"].values():
                use(a)
            use(prim.get("indices"))
    for skin in gltf.get("skins", []):
        use(skin.get("inverseBindMatrices"))
    for anim in gltf.get("animations", []):
        for s in anim["samplers"]:
            use(s["input"])
            use(s["output"])
    out = bytearray()
    views = []

    def add_view(data, target=None):
        out.extend(b"\0" * ((-len(out)) % 4))
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
        if target is not None:
            v["target"] = target
        out.extend(data)
        views.append(v)
        return len(views) - 1

    acc_map = {}
    accessors = []
    for i in used_acc:
        acc = dict(gltf["accessors"][i])
        old = gltf["bufferViews"][acc["bufferView"]]
        acc["bufferView"] = add_view(view_bytes(gltf, binary, acc["bufferView"]), old.get("target"))
        acc_map[i] = len(accessors)
        accessors.append(acc)
    for img_index, img in enumerate(gltf.get("images", [])):
        data = image_data[img_index] if image_data else view_bytes(gltf, binary, img["bufferView"])
        img["bufferView"] = add_view(data)
    for mesh in gltf.get("meshes", []):
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: acc_map[a] for k, a in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = acc_map[skin["inverseBindMatrices"]]
    for anim in gltf.get("animations", []):
        for s in anim["samplers"]:
            s["input"] = acc_map[s["input"]]
            s["output"] = acc_map[s["output"]]
    gltf["accessors"] = accessors
    gltf["bufferViews"] = views
    return gltf, out


def prune(gltf, keep_mesh):
    meshes = gltf["meshes"]
    keep = {i for i, m in enumerate(meshes) if keep_mesh(m["name"])}
    mesh_map = {}
    for i in sorted(keep):
        mesh_map[i] = len(mesh_map)
    skins_used = []
    for node in gltf["nodes"]:
        if "mesh" not in node:
            continue
        if node["mesh"] in keep:
            node["mesh"] = mesh_map[node["mesh"]]
            if "skin" in node and node["skin"] not in skins_used:
                skins_used.append(node["skin"])
        else:
            node.pop("mesh")
            node.pop("skin", None)
    skin_map = {s: i for i, s in enumerate(skins_used)}
    for node in gltf["nodes"]:
        if "skin" in node:
            node["skin"] = skin_map[node["skin"]]
    gltf["skins"] = [gltf["skins"][s] for s in skins_used]
    gltf["meshes"] = [meshes[i] for i in sorted(keep)]
    mats_used = sorted({p["material"] for m in gltf["meshes"] for p in m["primitives"] if "material" in p})
    mat_map = {m: i for i, m in enumerate(mats_used)}
    for m in gltf["meshes"]:
        for p in m["primitives"]:
            if "material" in p:
                p["material"] = mat_map[p["material"]]
    gltf["materials"] = [gltf["materials"][m] for m in mats_used]
    tex_used = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k.endswith("Texture") and isinstance(v, dict) and "index" in v and v["index"] not in tex_used:
                    tex_used.append(v["index"])
                walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(gltf["materials"])
    tex_map = {t: i for i, t in enumerate(tex_used)}

    def remap(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k.endswith("Texture") and isinstance(v, dict) and "index" in v:
                    v["index"] = tex_map[v["index"]]
                remap(v)
        elif isinstance(o, list):
            for x in o:
                remap(x)

    remap(gltf["materials"])
    textures = [gltf["textures"][t] for t in tex_used]
    img_used = sorted({t["source"] for t in textures})
    img_map = {s: i for i, s in enumerate(img_used)}
    for t in textures:
        t["source"] = img_map[t["source"]]
    gltf["textures"] = textures
    gltf["images"] = [gltf["images"][i] for i in img_used]


def keep_wing_tracks(gltf):
    nodes = gltf["nodes"]
    anims = []
    for anim in gltf.get("animations", []):
        if anim["name"] not in WING_CLIPS:
            continue
        channels = [c for c in anim["channels"] if WING_BONE.match(nodes[c["target"]["node"]].get("name", ""))]
        if not channels:
            continue
        samplers = []
        for c in channels:
            samplers.append(anim["samplers"][c["sampler"]])
            c["sampler"] = len(samplers) - 1
        anims.append({"name": anim["name"], "channels": channels, "samplers": samplers})
    gltf["animations"] = anims


def export_raw(code, out_id, out_dir):
    glb = export_heroes.load_glb_exporter()
    bundle = ga.hero_bundles([code])[code]
    if not bundle["path"]:
        log(f"{code}: bundle {bundle['bundle']} is not downloaded")
        return None
    real_optimize = optimize_glb.optimize
    optimize_glb.optimize = lambda path, *a, **k: os.path.getsize(path)
    saved_out = glb.OUT
    glb.OUT = out_dir
    try:
        info = glb.export({"id": out_id, "bundle": bundle["bundle"]})
    finally:
        optimize_glb.optimize = real_optimize
        glb.OUT = saved_out
    return os.path.join(out_dir, out_id + ".glb") if info else None


def finish(gltf, binary, dest):
    images = repaint(gltf, binary)
    gltf, binary = compact(gltf, binary, images)
    write_glb(dest, gltf, binary)
    optimize_glb.optimize(dest)
    log(f"  wrote {dest} {os.path.getsize(dest) // 1024} KB")


def referenced_textures(path):
    gltf, _ = read_glb(path)
    files = set()
    for m in gltf.get("materials", []):
        ch = m.get("extras", {}).get("character", {})
        for v in ch.values():
            if isinstance(v, dict):
                files.update(f.split("/")[-1] for f in [v.get("file")] + v.get("faces", []) if f)
    return files


def drop_unused_textures(before, outputs):
    tex_dir = os.path.join(GLB_OUT, "tex")
    used = set().union(*(referenced_textures(p) for p in outputs))
    for f in set(os.listdir(tex_dir)) - before - used:
        os.remove(os.path.join(tex_dir, f))


def main():
    export_heroes.GLB_OUT = GLB_OUT
    tex_dir = os.path.join(GLB_OUT, "tex")
    before = set(os.listdir(tex_dir)) if os.path.isdir(tex_dir) else set()
    body = export_raw(BODY_CODE, BODY_ID, GLB_OUT)
    wings = export_raw(WINGS_CODE, WINGS_ID, GLB_OUT)
    if not body or not wings:
        return 2
    gltf, binary = read_glb(body)
    finish(gltf, binary, body)
    gltf, binary = read_glb(wings)
    prune(gltf, lambda name: name == WING_MESH)
    keep_wing_tracks(gltf)
    finish(gltf, binary, wings)
    drop_unused_textures(before, [body, wings])
    return 0


if __name__ == "__main__":
    sys.exit(main())
