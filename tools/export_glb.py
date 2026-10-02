import os
import sys
import io
import json
import math
import struct
import zlib
import collections
import numpy as np
from PIL import Image
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"
AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else os.path.normpath(os.path.join(HERE, "..", "public", "assets", "glb"))
JOBS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "glb_jobs.json")
ONLY = set(sys.argv[3:])
MAX_TEX = 1024
MIRROR = np.diag([1.0, 1.0, -1.0, 1.0])
FLOAT = 5126
USHORT = 5123
UINT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
BASE_KEYS = ("_BaseMap", "_MainTex", "_BaseColorMap", "_AlbedoMap")
NORMAL_KEYS = ("_BumpMap", "_NormalMap")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def crc(path):
    return zlib.crc32(path.encode("utf8")) & 0xffffffff


def prop_items(container):
    if container is None:
        return []
    if hasattr(container, "items"):
        return list(container.items())
    return list(container)


CAB_MAP_PATH = os.path.join(HERE, "cab_map.json")
CHAR_CACHE = {}
LOADED = {}
REGISTRY = {}
CAB_FILES = {}
_cab_map = None


def serialized_files(env):
    for f in env.files.values():
        inner = getattr(f, "files", None)
        if inner:
            for name, sf in inner.items():
                if hasattr(sf, "objects"):
                    yield name, sf
        elif hasattr(f, "objects"):
            yield getattr(f, "name", ""), f


def cab_map():
    global _cab_map
    if _cab_map is not None:
        return _cab_map
    if os.path.exists(CAB_MAP_PATH):
        _cab_map = json.load(open(CAB_MAP_PATH, encoding="utf8"))
        return _cab_map
    log("building CAB map of all bundles...")
    _cab_map = {}
    for f in sorted(os.listdir(AA)):
        try:
            env = UnityPy.load(os.path.join(AA, f))
        except Exception:
            continue
        for name, _ in serialized_files(env):
            _cab_map[name.lower()] = f
    with open(CAB_MAP_PATH, "w", encoding="utf8") as fh:
        json.dump(_cab_map, fh, indent=0)
    log(f"CAB map: {len(_cab_map)} files")
    return _cab_map


def load_bundle_file(fname):
    if fname in LOADED:
        return LOADED[fname]
    env = UnityPy.load(os.path.join(AA, fname))
    for o in env.objects:
        REGISTRY[(id(o.assets_file), o.path_id)] = o
    for name, sf in serialized_files(env):
        CAB_FILES[name.lower()] = sf
    LOADED[fname] = env
    return env


def external_cab(pptr):
    fid = getattr(pptr, "m_FileID", 0)
    if not fid:
        return None
    sf = getattr(pptr, "assetsfile", None)
    try:
        path = sf.externals[fid - 1].path
    except Exception:
        return None
    return path.replace("\\", "/").split("/")[-1].lower()


class Bundle:
    def __init__(self, path):
        self.fname = os.path.basename(path)
        self.env = load_bundle_file(self.fname)
        self.cache = {}
        self.external_hits = 0
        self.external_misses = set()

    def read(self, o):
        key = (id(o.assets_file), o.path_id)
        if key not in self.cache:
            try:
                self.cache[key] = o.read()
            except Exception as e:
                log("  readfail", o.type.name, o.path_id, e)
                self.cache[key] = None
        return self.cache[key]

    def resolve_external(self, pptr, pid):
        cab = external_cab(pptr)
        if cab is None:
            return None
        if cab not in CAB_FILES:
            fname = cab_map().get(cab)
            if fname is None:
                self.external_misses.add(cab)
                return None
            load_bundle_file(fname)
        sf = CAB_FILES.get(cab)
        if sf is None:
            self.external_misses.add(cab)
            return None
        o = REGISTRY.get((id(sf), pid))
        if o is None:
            self.external_misses.add(cab)
            return None
        self.external_hits += 1
        return o

    def resolve(self, pptr):
        if pptr is None:
            return None
        pid = getattr(pptr, "m_PathID", 0)
        if not pid:
            return None
        if getattr(pptr, "m_FileID", 0):
            return self.resolve_external(pptr, pid)
        af = getattr(pptr, "assetsfile", None)
        return REGISTRY.get((id(af), pid)) if af is not None else None

    def deref(self, pptr):
        o = self.resolve(pptr)
        return self.read(o) if o is not None else None

    def key_of(self, pptr):
        o = self.resolve(pptr)
        return (id(o.assets_file), o.path_id) if o is not None else None

    def by_type(self, name):
        return [o for o in self.env.objects if o.type.name == name]


def go_name(b, tr):
    go = b.deref(tr.m_GameObject)
    return go.m_Name if go is not None else "node"


def transform_of(b, go):
    for c in go.m_Components:
        cd = b.deref(c)
        if cd is not None and hasattr(cd, "m_Father"):
            return cd, b.key_of(c)
    return None, None


def walk_root(b, tr, key):
    for _ in range(512):
        parent = b.deref(tr.m_Father)
        if parent is None:
            return tr, key
        key = b.key_of(tr.m_Father)
        tr = parent
    return tr, key


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def euler_to_quat_unity(deg):
    rx, ry, rz = np.radians(deg)
    qx = np.array([math.sin(rx / 2), 0, 0, math.cos(rx / 2)])
    qy = np.array([0, math.sin(ry / 2), 0, math.cos(ry / 2)])
    qz = np.array([0, 0, math.sin(rz / 2), math.cos(rz / 2)])
    return quat_mul(quat_mul(qy, qx), qz)


class Skeleton:
    def __init__(self, b, root, root_key):
        self.b = b
        self.nodes = []
        self.index_by_key = {}
        self.index_by_hash = {}
        self.rec(root, root_key, -1, "")

    def rec(self, tr, key, parent, prefix):
        name = go_name(self.b, tr)
        if parent < 0:
            path = ""
        elif prefix == "":
            path = name
        else:
            path = prefix + "/" + name
        idx = len(self.nodes)
        p = tr.m_LocalPosition
        q = tr.m_LocalRotation
        s = tr.m_LocalScale
        self.nodes.append({
            "name": name,
            "parent": parent,
            "t": [p.x, p.y, -p.z],
            "r": [-q.x, -q.y, q.z, q.w],
            "s": [s.x, s.y, s.z],
            "children": [],
        })
        if parent >= 0:
            self.nodes[parent]["children"].append(idx)
        self.index_by_key[key] = idx
        self.index_by_hash[crc(path)] = idx
        for c in tr.m_Children:
            ct = self.b.deref(c)
            if ct is not None:
                self.rec(ct, self.b.key_of(c), idx, path)


def parse_streamed(sc):
    raw = np.asarray(sc.data, dtype=np.uint32).tobytes()
    curves = collections.defaultdict(list)
    pos = 0
    n = len(raw)
    while pos + 8 <= n:
        t, cnt = struct.unpack_from("<fi", raw, pos)
        pos += 8
        if cnt < 0 or pos + cnt * 20 > n:
            break
        for _ in range(cnt):
            idx, c0, c1, c2, c3 = struct.unpack_from("<i4f", raw, pos)
            pos += 20
            curves[idx].append((t, c0, c1, c2, c3))
    return curves


def eval_streamed(keys, times):
    kt = np.array([k[0] for k in keys], dtype=np.float64)
    co = np.array([k[1:] for k in keys], dtype=np.float64)
    idx = np.searchsorted(kt, times, side="right") - 1
    idx = np.clip(idx, 0, len(keys) - 1)
    dt = times - kt[idx]
    dt = np.where(kt[idx] < -1e30, 0.0, dt)
    c = co[idx]
    return ((c[:, 0] * dt + c[:, 1]) * dt + c[:, 2]) * dt + c[:, 3]


class ClipData:
    def __init__(self, clip):
        mc = clip.m_MuscleClip
        cl = mc.m_Clip.data if hasattr(mc.m_Clip, "data") else mc.m_Clip
        self.name = clip.m_Name
        self.stop = float(mc.m_StopTime)
        self.rate = float(clip.m_SampleRate) or 30.0
        self.sc = cl.m_StreamedClip
        self.dc = cl.m_DenseClip
        self.const = np.asarray(cl.m_ConstantClip.data, dtype=np.float64)
        self.streamed = parse_streamed(self.sc)
        self.n_stream = int(self.sc.curveCount)
        self.n_dense = int(self.dc.m_CurveCount)
        self.dense = None
        if self.n_dense and self.dc.m_FrameCount:
            self.dense = np.asarray(self.dc.m_SampleArray, dtype=np.float64).reshape(self.dc.m_FrameCount, self.n_dense)
        self.bindings = list(clip.m_ClipBindingConstant.genericBindings)

    def total_curves(self):
        return self.n_stream + self.n_dense + len(self.const)

    def curve(self, i, times):
        if i < self.n_stream:
            keys = self.streamed.get(i)
            if not keys:
                return np.zeros(len(times)), True
            return eval_streamed(keys, times), False
        i -= self.n_stream
        if i < self.n_dense and self.dense is not None:
            f = (times - self.dc.m_BeginTime) * self.dc.m_SampleRate
            f0 = np.clip(np.floor(f).astype(int), 0, self.dc.m_FrameCount - 1)
            f1 = np.clip(f0 + 1, 0, self.dc.m_FrameCount - 1)
            a = np.clip(f - f0, 0, 1)
            return self.dense[f0, i] * (1 - a) + self.dense[f1, i] * a, False
        i -= self.n_dense
        if i < len(self.const):
            return np.full(len(times), self.const[i]), True
        return np.zeros(len(times)), True


def binding_ranges(bindings):
    out = []
    cur = 0
    for g in bindings:
        if g.typeID == 4:
            n = 4 if g.attribute == 2 else 3 if g.attribute in (1, 3, 4) else 1
        else:
            n = 1
        out.append((cur, n, g))
        cur += n
    return out, cur


def fix_quat_continuity(q):
    for i in range(1, len(q)):
        if np.dot(q[i], q[i - 1]) < 0:
            q[i] = -q[i]
    return q


def build_animation(cd, skel):
    ranges, total = binding_ranges(cd.bindings)
    if total != cd.total_curves():
        log(f"  [{cd.name}] curve count mismatch bindings={total} data={cd.total_curves()}")
    nframes = max(2, int(round(cd.stop * cd.rate)) + 1)
    times = np.minimum(np.arange(nframes, dtype=np.float64) / cd.rate, cd.stop)
    times[-1] = cd.stop
    channels = {}
    matched = 0
    transform_bindings = 0
    for start, n, g in ranges:
        if g.typeID != 4:
            continue
        transform_bindings += 1
        node = skel.index_by_hash.get(g.path)
        if node is None:
            continue
        matched += 1
        vals = [cd.curve(start + k, times) for k in range(n)]
        arr = np.stack([v for v, _ in vals], axis=1)
        if g.attribute == 1:
            arr[:, 2] *= -1
            key = "translation"
        elif g.attribute == 2:
            arr[:, 0] *= -1
            arr[:, 1] *= -1
            norm = np.linalg.norm(arr, axis=1, keepdims=True)
            norm[norm == 0] = 1
            arr = fix_quat_continuity(arr / norm)
            key = "rotation"
        elif g.attribute == 3:
            key = "scale"
        elif g.attribute == 4:
            qs = np.array([euler_to_quat_unity(e) for e in arr])
            qs[:, 0] *= -1
            qs[:, 1] *= -1
            arr = fix_quat_continuity(qs)
            key = "rotation"
        else:
            continue
        channels.setdefault(node, {})[key] = arr
    return times, channels, matched, transform_bindings


def compact_channel(times, arr, rest, keep=False):
    rest = np.asarray(rest, dtype=np.float64)
    spread = np.abs(arr - arr[0]).max()
    if spread < 1e-5:
        if arr.shape[1] == 4:
            same = min(np.abs(arr[0] - rest).max(), np.abs(arr[0] + rest).max()) < 1e-4
        else:
            same = np.abs(arr[0] - rest).max() < 1e-4
        if same and not keep:
            return None, None
        return np.array([times[0], times[-1]]), np.stack([arr[0], arr[0]])
    return times, arr


class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []

    def add_view(self, data, target=None):
        pad = (-len(self.bin)) % 4
        self.bin += b"\0" * pad
        off = len(self.bin)
        self.bin += data
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target is not None:
            v["target"] = target
        self.views.append(v)
        return len(self.views) - 1

    def add_accessor(self, arr, ctype, atype, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        view = self.add_view(arr.tobytes(), target)
        acc = {"bufferView": view, "componentType": ctype, "count": int(arr.shape[0]), "type": atype}
        if minmax:
            if arr.ndim > 1:
                acc["min"] = [float(x) for x in arr.min(axis=0)]
                acc["max"] = [float(x) for x in arr.max(axis=0)]
            else:
                acc["min"] = [float(arr.min())]
                acc["max"] = [float(arr.max())]
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def write(self, path, gltf):
        gltf["bufferViews"] = self.views
        gltf["accessors"] = self.accessors
        gltf["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(gltf, separators=(",", ":")).encode("utf8")
        js += b" " * ((-len(js)) % 4)
        binp = bytes(self.bin) + b"\0" * ((-len(self.bin)) % 4)
        total = 12 + 8 + len(js) + 8 + len(binp)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(binp), 0x004E4942))
            f.write(binp)


def mat_from_unity(m):
    a = np.array([
        [m.e00, m.e01, m.e02, m.e03],
        [m.e10, m.e11, m.e12, m.e13],
        [m.e20, m.e21, m.e22, m.e23],
        [m.e30, m.e31, m.e32, m.e33],
    ], dtype=np.float64)
    return MIRROR @ a @ MIRROR


def tex_prop(b, mat, keys):
    try:
        items = prop_items(mat.m_SavedProperties.m_TexEnvs)
    except Exception:
        return None
    for k, v in items:
        if k in keys:
            t = b.deref(v.m_Texture)
            if t is not None:
                return t
    return None


def tex_keys(mat):
    try:
        return {k for k, v in prop_items(mat.m_SavedProperties.m_TexEnvs)}
    except Exception:
        return set()


def is_fx_material(mat):
    keys = tex_keys(mat)
    return "_BaseMap" not in keys and "_MainTex" in keys and bool(keys & {"_DissolveTex", "_MaskTex", "_DistortionTex"})


def float_prop(mat, key, default):
    try:
        for k, v in prop_items(mat.m_SavedProperties.m_Floats):
            if k == key:
                return float(v)
    except Exception:
        pass
    return default


def color_prop(mat, key):
    try:
        for k, v in prop_items(mat.m_SavedProperties.m_Colors):
            if k == key:
                return [v.r, v.g, v.b, v.a]
    except Exception:
        pass
    return None


MESH_VFX_SHADERS = ("VFX/VFX_Magic_MainTexture",)


def shader_name(b, mat):
    try:
        sh = b.deref(mat.m_Shader)
        return sh.m_ParsedForm.m_Name if sh is not None else None
    except Exception:
        return None


def mesh_vfx_extras(b, mat):
    if color_prop(mat, "_MainColor0") is None or "_MainTex" not in tex_keys(mat):
        return None
    name = shader_name(b, mat)
    if name not in MESH_VFX_SHADERS:
        return None
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import export_vfx
    kws = getattr(mat, "m_ValidKeywords", None) or []
    out = {"sh": name, "kw": sorted(kws.split() if isinstance(kws, str) else kws), "f": {}, "v": {}}
    props = mat.m_SavedProperties
    for k, v in prop_items(props.m_Floats):
        if k in export_vfx.FLOAT_PROPS:
            out["f"][k] = round(float(v), 4)
    for k, v in prop_items(props.m_Colors):
        c = [float(v.r), float(v.g), float(v.b), float(v.a)]
        if k in export_vfx.COLOR_PROPS:
            out["v"][k] = [round(export_vfx.srgb_to_linear(x), 4) for x in c[:3]] + [round(c[3], 4)]
        elif k in export_vfx.VECTOR_PROPS:
            out["v"][k] = [round(x, 4) for x in c]
    tex = tex_prop(b, mat, ("_MainTex",))
    out["srgb"] = 1 if tex is not None and getattr(tex, "m_ColorSpace", 1) == 1 else 0
    return out


def vertex_colors(h, nv):
    if not h.m_Colors:
        return None
    C = np.array(h.m_Colors, dtype=np.float32).reshape(nv, -1)[:, :4]
    if C.shape[1] < 4:
        C = np.concatenate([C, np.ones((nv, 4 - C.shape[1]), np.float32)], axis=1)
    if C.max() > 1.0:
        C = C / 255.0
    return np.ascontiguousarray(C, dtype=np.float32)


def character_extras(b, mat):
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import char_materials
    try:
        return char_materials.extras(b, mat, OUT, (tex_prop, tex_keys, color_prop, float_prop), CHAR_CACHE)
    except Exception as e:
        log("  character extras fail", mat.m_Name, e)
        return None


def fit_image(img):
    if max(img.size) > MAX_TEX:
        scale = MAX_TEX / max(img.size)
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    return img


def png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def base_png(t):
    img = fit_image(t.image.convert("RGBA"))
    alpha = np.asarray(img)[..., 3]
    has_alpha = bool((alpha < 250).any())
    if not has_alpha:
        img = img.convert("RGB")
    return png_bytes(img), has_alpha


def normal_png(t):
    img = fit_image(t.image.convert("RGBA"))
    a = np.asarray(img).astype(np.float32) / 255.0
    x = (a[..., 0] * a[..., 3]) * 2 - 1
    y = a[..., 1] * 2 - 1
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    out = np.stack([(x + 1) / 2, (y + 1) / 2, (z + 1) / 2], axis=-1)
    return png_bytes(Image.fromarray((out * 255).astype(np.uint8), "RGB"))


class Exporter:
    def __init__(self, b, out_path, char_id):
        self.b = b
        self.out_path = out_path
        self.char_id = char_id
        self.glb = GLB()
        self.images = []
        self.textures = []
        self.materials = []
        self.samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
        self.image_cache = {}
        self.material_cache = {}
        self.meshes = []
        self.skins = []
        self.nodes = []
        self.animations = []
        self.texture_names = []

    def image_index(self, tex, kind):
        key = (kind, tex.m_Name)
        if key in self.image_cache:
            return self.image_cache[key]
        try:
            if kind == "normal":
                data = normal_png(tex)
                has_alpha = False
            else:
                data, has_alpha = base_png(tex)
        except Exception as e:
            log("  texfail", tex.m_Name, e)
            self.image_cache[key] = (None, False)
            return self.image_cache[key]
        view = self.glb.add_view(data)
        self.images.append({"bufferView": view, "mimeType": "image/png", "name": tex.m_Name})
        self.textures.append({"sampler": 0, "source": len(self.images) - 1})
        self.texture_names.append(tex.m_Name)
        self.image_cache[key] = (len(self.textures) - 1, has_alpha)
        return self.image_cache[key]

    def material_index(self, mat):
        if mat is None:
            return None
        key = mat.m_Name
        if key in self.material_cache:
            return self.material_cache[key]
        pbr = {"metallicFactor": 0.0, "roughnessFactor": 0.75}
        m = {"name": mat.m_Name, "pbrMetallicRoughness": pbr}
        base = tex_prop(self.b, mat, BASE_KEYS)
        has_alpha = False
        if base is not None:
            ti, has_alpha = self.image_index(base, "base")
            if ti is not None:
                pbr["baseColorTexture"] = {"index": ti}
        col = color_prop(mat, "_BaseColor") or color_prop(mat, "_Color")
        if col is not None and all(0 <= c <= 1 for c in col):
            pbr["baseColorFactor"] = [col[0], col[1], col[2], 1.0]
        nm = tex_prop(self.b, mat, NORMAL_KEYS)
        if nm is not None:
            ti, _ = self.image_index(nm, "normal")
            if ti is not None:
                m["normalTexture"] = {"index": ti}
        surface = float_prop(mat, "_Surface", 0.0)
        alpha_clip = float_prop(mat, "_AlphaClip", 0.0)
        if alpha_clip >= 0.5:
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = float_prop(mat, "_Cutoff", 0.5)
        elif surface >= 0.5 and has_alpha:
            m["alphaMode"] = "BLEND"
        if float_prop(mat, "_Cull", 2.0) < 0.5:
            m["doubleSided"] = True
        if is_fx_material(mat):
            m["alphaMode"] = "BLEND"
            m["doubleSided"] = True
            m["extras"] = {"fx": "additive"}
        vfx = mesh_vfx_extras(self.b, mat)
        if vfx:
            m["alphaMode"] = "BLEND"
            m.setdefault("extras", {})["vfx"] = vfx
        character = character_extras(self.b, mat)
        if character:
            m.setdefault("extras", {})["character"] = character
        self.materials.append(m)
        self.material_cache[key] = len(self.materials) - 1
        log(f"  material {mat.m_Name}: base={base.m_Name if base else None} nm={nm.m_Name if nm else None} alphaClip={alpha_clip} surface={surface} mode={m.get('alphaMode', 'OPAQUE')}")
        return self.material_cache[key]

    def skin_weights(self, h, nv, bone_count):
        JI = np.zeros((nv, 4), np.int64)
        JW = np.zeros((nv, 4), np.float32)
        rawi = np.asarray(h.m_BoneIndices, dtype=np.int64).reshape(-1) if h.m_BoneIndices else np.zeros(0, np.int64)
        raww = np.asarray(h.m_BoneWeights, dtype=np.float32).reshape(-1) if h.m_BoneWeights else np.zeros(0, np.float32)
        per = rawi.size // nv if nv and rawi.size and rawi.size % nv == 0 else 0
        perw = raww.size // nv if nv and raww.size and raww.size % nv == 0 else 0
        if per >= 1:
            k = min(per, 4)
            JI[:, :k] = rawi.reshape(nv, per)[:, :k]
            if perw >= 1:
                kw = min(perw, k)
                JW[:, :kw] = raww.reshape(nv, perw)[:, :kw]
                if perw == k - 1:
                    JW[:, k - 1] = np.clip(1.0 - JW[:, :kw].sum(axis=1), 0.0, 1.0)
            else:
                JW[:, 0] = 1.0
        else:
            JW[:, 0] = 1.0
        invalid = (JI < 0) | (JI >= bone_count)
        JW[invalid] = 0.0
        JI[invalid] = 0
        s = JW.sum(axis=1, keepdims=True)
        empty = s[:, 0] <= 0
        JW[empty, 0] = 1.0
        JI[empty, 0] = 0
        s[empty] = 1.0
        log(f"    skin influences per vertex: indices={per} weights={perw}")
        return JI.astype(np.uint16), (JW / s).astype(np.float32)

    def add_mesh(self, smr, skel):
        b = self.b
        mesh = b.deref(smr.m_Mesh)
        if mesh is None:
            return None
        h = MeshHandler(mesh)
        h.process()
        if not h.m_Vertices:
            return None
        V = np.array(h.m_Vertices, dtype=np.float32).reshape(-1, 3)
        V[:, 2] *= -1
        nv = len(V)
        N = None
        if h.m_Normals:
            N = np.array(h.m_Normals, dtype=np.float32).reshape(nv, -1)[:, :3].copy()
            N[:, 2] *= -1
            ln = np.linalg.norm(N, axis=1, keepdims=True)
            ln[ln == 0] = 1
            N = N / ln
        UV = np.array(h.m_UV0, dtype=np.float32).reshape(-1, 2) if h.m_UV0 else np.zeros((nv, 2), np.float32)
        UV[:, 1] = 1.0 - UV[:, 1]
        IDX = np.array(h.m_IndexBuffer, dtype=np.uint32)
        bone_count = len(smr.m_Bones)
        skinned = bone_count > 0
        g = self.glb
        attrs = {"POSITION": g.add_accessor(V, FLOAT, "VEC3", ARRAY_BUFFER, minmax=True)}
        if N is not None:
            attrs["NORMAL"] = g.add_accessor(N, FLOAT, "VEC3", ARRAY_BUFFER)
        attrs["TEXCOORD_0"] = g.add_accessor(UV, FLOAT, "VEC2", ARRAY_BUFFER)
        if skinned:
            JI, JW = self.skin_weights(h, nv, bone_count)
            attrs["JOINTS_0"] = g.add_accessor(JI, USHORT, "VEC4", ARRAY_BUFFER)
            attrs["WEIGHTS_0"] = g.add_accessor(JW, FLOAT, "VEC4", ARRAY_BUFFER)
        index_size = 2 if getattr(mesh, "m_IndexFormat", 0) == 0 else 4
        colors = vertex_colors(h, nv)
        vfx_attrs = {}

        def attrs_for(mi):
            if mi is None or colors is None or "vfx" not in self.materials[mi].get("extras", {}):
                return attrs
            if not vfx_attrs:
                vfx_attrs.update(attrs, COLOR_0=g.add_accessor(colors, FLOAT, "VEC4", ARRAY_BUFFER))
            return vfx_attrs

        prims = []
        subs = list(mesh.m_SubMeshes) if mesh.m_SubMeshes else []
        mats = list(smr.m_Materials)
        for si, sub in enumerate(subs):
            if getattr(sub, "topology", 0) != 0:
                continue
            start = sub.firstByte // index_size
            count = sub.indexCount
            if start + count > len(IDX) or count < 3:
                if si != 0:
                    continue
                tri = IDX
            else:
                tri = IDX[start:start + count] + np.uint32(getattr(sub, "baseVertex", 0) or 0)
            tri = tri.reshape(-1, 3)[:, ::-1].reshape(-1).astype(np.uint32)
            tri = np.where(tri >= nv, 0, tri).astype(np.uint32)
            prim = {"attributes": attrs, "indices": g.add_accessor(tri, UINT, "SCALAR", ELEMENT_ARRAY_BUFFER), "mode": 4}
            mat = b.deref(mats[min(si, len(mats) - 1)]) if mats else None
            mi = self.material_index(mat)
            if mi is not None:
                prim["material"] = mi
            prim["attributes"] = attrs_for(mi)
            prims.append(prim)
        if not prims:
            tri = IDX.reshape(-1, 3)[:, ::-1].reshape(-1).astype(np.uint32)
            prim = {"attributes": attrs, "indices": g.add_accessor(tri, UINT, "SCALAR", ELEMENT_ARRAY_BUFFER), "mode": 4}
            mat = b.deref(mats[0]) if mats else None
            mi = self.material_index(mat)
            if mi is not None:
                prim["material"] = mi
            prims.append(prim)
        self.meshes.append({"name": mesh.m_Name, "primitives": prims})
        mesh_index = len(self.meshes) - 1
        skin_index = None
        if skinned:
            joints = [skel.index_by_key.get(b.key_of(pb), 0) for pb in smr.m_Bones]
            binv = np.array([mat_from_unity(m).T.reshape(-1) for m in mesh.m_BindPose], dtype=np.float32)
            if len(binv) != bone_count:
                binv = np.tile(np.eye(4, dtype=np.float32).reshape(1, -1), (bone_count, 1))
            ibm = g.add_accessor(binv, FLOAT, "MAT4")
            self.skins.append({"joints": joints, "inverseBindMatrices": ibm, "skeleton": 0, "name": mesh.m_Name})
            skin_index = len(self.skins) - 1
        log(f"  mesh {mesh.m_Name}: verts={nv} tris={len(IDX) // 3} prims={len(prims)} bones={bone_count}")
        return mesh_index, skin_index, skinned

    def add_sampler(self, anim, node, key, t, a):
        ti = self.glb.add_accessor(t.astype(np.float32), FLOAT, "SCALAR", minmax=True)
        oi = self.glb.add_accessor(a.astype(np.float32), FLOAT, "VEC4" if a.shape[1] == 4 else "VEC3")
        anim["samplers"].append({"input": ti, "output": oi, "interpolation": "LINEAR"})
        anim["channels"].append({"sampler": len(anim["samplers"]) - 1, "target": {"node": node, "path": key}})

    def fill_channels(self, anim, times, channels, keep):
        for node, props in channels.items():
            rest = self.nodes[node]
            for key, arr in props.items():
                t, a = compact_channel(times, arr, rest[key], keep)
                if t is not None:
                    self.add_sampler(anim, node, key, t, a)

    def add_clip(self, clip, skel):
        cd = ClipData(clip)
        times, channels, matched, tb = build_animation(cd, skel)
        anim = {"name": cd.name, "samplers": [], "channels": []}
        self.fill_channels(anim, times, channels, keep=False)
        static = False
        if not anim["channels"] and channels:
            self.fill_channels(anim, times, channels, keep=True)
            static = True
        if not anim["channels"]:
            root = self.nodes[0]
            duration = max(cd.stop, 1.0 / cd.rate)
            t = np.array([0.0, duration])
            self.add_sampler(anim, 0, "rotation", t, np.array([root["rotation"], root["rotation"]], dtype=np.float64))
            static = True
        self.animations.append(anim)
        label = " (static pose)" if static else ""
        log(f"  clip {cd.name}: {cd.stop:.2f}s bones {matched}/{tb} channels {len(anim['channels'])}{label}")
        info = {"name": cd.name, "duration": round(cd.stop, 4), "bones": matched, "channels": len(anim["channels"])}
        if static:
            info["static"] = True
        return info

    def run(self, smr_list, skel, clips):
        for n in skel.nodes:
            node = {"name": n["name"], "translation": n["t"], "rotation": n["r"], "scale": n["s"]}
            if n["children"]:
                node["children"] = n["children"]
            self.nodes.append(node)
        scene_nodes = [0]
        mesh_names = []
        for smr, tr_key in smr_list:
            try:
                res = self.add_mesh(smr, skel)
            except Exception:
                import traceback
                traceback.print_exc()
                res = None
            if res is None:
                continue
            mesh_index, skin_index, skinned = res
            mesh_names.append(self.meshes[mesh_index]["name"])
            if skinned:
                self.nodes.append({"name": self.meshes[mesh_index]["name"], "mesh": mesh_index, "skin": skin_index})
                scene_nodes.append(len(self.nodes) - 1)
            else:
                owner = skel.index_by_key.get(tr_key)
                if owner is None:
                    self.nodes.append({"name": self.meshes[mesh_index]["name"], "mesh": mesh_index})
                    scene_nodes.append(len(self.nodes) - 1)
                else:
                    self.nodes[owner]["mesh"] = mesh_index
        clip_info = []
        for clip in clips:
            try:
                info = self.add_clip(clip, skel)
            except Exception:
                import traceback
                traceback.print_exc()
                info = None
            if info is not None:
                clip_info.append(info)
        gltf = {
            "asset": {"version": "2.0", "generator": "invokers export_monsters.py"},
            "scene": 0,
            "scenes": [{"nodes": scene_nodes}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "skins": self.skins,
            "materials": self.materials,
            "textures": self.textures,
            "images": self.images,
            "samplers": self.samplers,
            "animations": self.animations,
        }
        for k in ("skins", "materials", "textures", "images", "samplers", "animations"):
            if not gltf[k]:
                del gltf[k]
        self.glb.write(self.out_path, gltf)
        return {
            "id": self.char_id,
            "file": os.path.basename(self.out_path),
            "bones": len(skel.nodes),
            "meshes": mesh_names,
            "textures": self.texture_names,
            "clips": clip_info,
            "size": os.path.getsize(self.out_path),
        }


def group_score(b, rname, lst):
    ing = 0
    for smr, _ in lst:
        for mm in smr.m_Materials:
            mat = b.deref(mm)
            if mat is None:
                continue
            t = tex_prop(b, mat, BASE_KEYS)
            if t is not None and "_ING_" in t.m_Name:
                ing += 1
    if rname.startswith("MDL_ING"):
        base = 1000
    elif rname.startswith("MDL_"):
        base = 500
    elif rname.startswith("PCHAR_ING"):
        base = 100
    else:
        base = 0
    return base + ing * 10 + len(lst)


def pick_group(b):
    groups = collections.defaultdict(list)
    roots = {}
    for o in b.by_type("SkinnedMeshRenderer"):
        smr = b.read(o)
        if smr is None:
            continue
        go = b.deref(smr.m_GameObject)
        if go is None:
            continue
        tr, tr_key = transform_of(b, go)
        if tr is None:
            continue
        root, root_key = walk_root(b, tr, tr_key)
        groups[root_key].append((smr, tr_key))
        roots[root_key] = root
    best = None
    for key, lst in groups.items():
        root = roots[key]
        rname = go_name(b, root)
        score = group_score(b, rname, lst)
        if best is None or score > best[0]:
            best = (score, key, root, lst, rname)
    return best


def export(job):
    path = os.path.join(AA, job["bundle"])
    log(f"== {job['id']} <- {job['bundle']}")
    b = Bundle(path)
    best = pick_group(b)
    if best is None:
        log("  no skinned mesh group")
        return None
    score, root_key, root, smr_list, rname = best
    skel = Skeleton(b, root, root_key)
    log(f"  root {rname}: {len(skel.nodes)} nodes, {len(smr_list)} skinned meshes")
    clips = []
    seen = set()
    for o in b.by_type("AnimationClip"):
        c = b.read(o)
        if c is None or c.m_Name in seen:
            continue
        seen.add(c.m_Name)
        clips.append(c)
    clips.sort(key=lambda c: c.m_Name)
    out_path = os.path.join(OUT, job["id"].lower() + ".glb")
    ex = Exporter(b, out_path, job["id"])
    info = ex.run(smr_list, skel, clips)
    info["root"] = rname
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import optimize_glb
    info["size"] = optimize_glb.optimize(out_path)
    log(f"  external refs resolved: {b.external_hits}, unresolved CABs: {sorted(b.external_misses)}")
    log(f"  wrote {out_path} {info['size'] // 1024} KB, {len(info['clips'])} clips")
    return info


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = json.load(open(JOBS, encoding="utf8"))
    index_path = os.path.join(OUT, "index.json")
    index = {}
    if os.path.exists(index_path):
        try:
            for m in json.load(open(index_path, encoding="utf8")):
                index[m["id"]] = m
        except Exception:
            index = {}
    for job in jobs:
        if ONLY and job["id"] not in ONLY:
            continue
        try:
            info = export(job)
        except Exception:
            import traceback
            traceback.print_exc()
            info = None
        if info is not None:
            info["name"] = job.get("name", job["id"])
            index[job["id"]] = info
    ordered = [index[j["id"]] for j in jobs if j["id"] in index]
    with open(index_path, "w", encoding="utf8") as f:
        json.dump(ordered, f, indent=1)
    log(f"index: {len(ordered)} monsters -> {index_path}")


if __name__ == "__main__":
    main()
