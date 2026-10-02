import os
import sys
import io
import glob
import json
import math
import struct
import warnings
import collections
import numpy as np
from PIL import Image
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

warnings.filterwarnings("ignore")
UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
CACHE = os.path.expandvars(r"%USERPROFILE%\AppData\LocalLow\Unity\Hit_Zone_Invokers")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "locations"))
CAB_MAP_PATH = os.path.join(HERE, "cab_map_all.json")
ELEMENTS = ("Fire", "Water", "Earth", "Wind", "Light", "Dark")
CENTER = np.array([154.05, -1.28, -46.49])
MAX_TEX = 1024
MAX_LIGHTMAP = 2048
WEBP_QUALITY = 82
SKIP_BRANCHES = {"VFX", "Lights"}
SKIP_SHADERS = ("Fog simple", "Unlit Transparent Color")
MIRROR = np.diag([1.0, 1.0, -1.0, 1.0])
FLOAT = 5126
UINT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def cached_bundle_paths():
    return sorted(glob.glob(os.path.join(CACHE, "*", "*", "__data")))


def all_bundle_paths():
    local = [os.path.join(AA, f) for f in sorted(os.listdir(AA))] if os.path.isdir(AA) else []
    return local + cached_bundle_paths()


def cab_names(env):
    for bf in env.files.values():
        for name in getattr(bf, "files", {}).keys():
            yield name.lower()


def build_cab_map():
    log("indexing CAB files of installed and cached bundles...")
    out = {}
    for p in all_bundle_paths():
        try:
            env = UnityPy.load(p)
        except Exception:
            continue
        for n in cab_names(env):
            out[n] = p
    with open(CAB_MAP_PATH, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=0)
    log(f"CAB map: {len(out)} files")
    return out


class Registry:
    def __init__(self):
        self.cab_map = json.load(open(CAB_MAP_PATH, encoding="utf8")) if os.path.exists(CAB_MAP_PATH) else build_cab_map()
        self.envs = {}
        self.objects = {}
        self.loaded_cabs = set()
        self.cache = {}
        self.misses = set()
        self.rebuilt = False

    def load(self, path):
        if path in self.envs:
            return self.envs[path]
        env = UnityPy.load(path)
        for o in env.objects:
            self.objects[(o.assets_file.name.lower(), o.path_id)] = o
        for n in cab_names(env):
            self.loaded_cabs.add(n)
        self.envs[path] = env
        return env

    def ensure_cab(self, cab):
        if cab in self.loaded_cabs:
            return True
        path = self.cab_map.get(cab)
        if (path is None or not os.path.exists(path)) and not self.rebuilt:
            self.cab_map = build_cab_map()
            self.rebuilt = True
            path = self.cab_map.get(cab)
        if path is None or not os.path.exists(path):
            self.misses.add(cab)
            return False
        self.load(path)
        return True

    def resolve(self, pptr):
        if pptr is None or not getattr(pptr, "m_PathID", 0):
            return None
        fid = getattr(pptr, "m_FileID", 0)
        sf = pptr.assetsfile
        if fid:
            try:
                cab = sf.externals[fid - 1].path.replace("\\", "/").split("/")[-1].lower()
            except Exception:
                return None
            if not cab.startswith("cab-") or not self.ensure_cab(cab):
                return None
            return self.objects.get((cab, pptr.m_PathID))
        return self.objects.get((sf.name.lower(), pptr.m_PathID))

    def read(self, obj):
        if obj is None:
            return None
        key = (obj.assets_file.name.lower(), obj.path_id)
        if key not in self.cache:
            try:
                self.cache[key] = obj.read()
            except Exception as e:
                log("  readfail", obj.type.name, obj.path_id, e)
                self.cache[key] = None
        return self.cache[key]

    def deref(self, pptr):
        return self.read(self.resolve(pptr))

    def key(self, pptr):
        o = self.resolve(pptr)
        return (o.assets_file.name.lower(), o.path_id) if o is not None else None


def discover_scenes():
    found = {}
    for p in cached_bundle_paths():
        if os.path.getsize(p) > 3 * 1024 * 1024:
            continue
        try:
            env = UnityPy.load(p)
        except Exception:
            continue
        if not any(o.type.name == "LightmapSettings" for o in env.objects):
            continue
        names = []
        for o in env.objects:
            if o.type.name == "GameObject":
                try:
                    names.append(o.read().m_Name)
                except Exception:
                    pass
        if "Spires_Cameras_Prefab" not in names:
            continue
        counts = collections.Counter()
        for n in names:
            for el in ELEMENTS:
                if el in n:
                    counts[el] += 1
        if not counts:
            continue
        element = counts.most_common(1)[0][0]
        folder = os.path.basename(os.path.dirname(os.path.dirname(p)))
        log(f"  spire scene {element:5s} <- {folder}")
        found[element.lower()] = p
    return found


def trs_matrix(tr):
    p, q, s = tr.m_LocalPosition, tr.m_LocalRotation, tr.m_LocalScale
    x, y, z, w = q.x, q.y, q.z, q.w
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * np.array([s.x, s.y, s.z])
    m[:3, 3] = [p.x, p.y, p.z]
    return m


def srgb_to_linear(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, None)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def props(mat):
    sp = mat.m_SavedProperties
    tex = {}
    for k, v in sp.m_TexEnvs:
        tex[k] = v
    floats = {k: float(v) for k, v in sp.m_Floats}
    colors = {k: [v.r, v.g, v.b, v.a] for k, v in sp.m_Colors}
    return tex, floats, colors


def shader_name(reg, mat):
    sh = reg.deref(mat.m_Shader)
    if sh is None:
        return ""
    form = getattr(sh, "m_ParsedForm", None)
    return getattr(form, "m_Name", "") or getattr(sh, "m_Name", "")


def fit(img, limit):
    if max(img.size) > limit:
        k = limit / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    return img


def webp_bytes(img, lossless=False):
    buf = io.BytesIO()
    if lossless:
        img.save(buf, format="WEBP", lossless=True, exact=True, method=6)
    else:
        img.save(buf, format="WEBP", quality=WEBP_QUALITY, exact=True, method=6)
    return buf.getvalue()


class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []

    def add_view(self, data, target=None):
        self.bin += b"\0" * ((-len(self.bin)) % 4)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        self.bin += data
        if target is not None:
            v["target"] = target
        self.views.append(v)
        return len(self.views) - 1

    def add_accessor(self, arr, ctype, atype, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        acc = {"bufferView": self.add_view(arr.tobytes(), target), "componentType": ctype, "count": int(arr.shape[0]), "type": atype}
        if minmax:
            acc["min"] = [float(x) for x in arr.min(axis=0)]
            acc["max"] = [float(x) for x in arr.max(axis=0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def write(self, path, gltf):
        gltf["bufferViews"] = self.views
        gltf["accessors"] = self.accessors
        gltf["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(gltf, separators=(",", ":")).encode("utf8")
        js += b" " * ((-len(js)) % 4)
        binp = bytes(self.bin) + b"\0" * ((-len(self.bin)) % 4)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binp)))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(binp), 0x004E4942))
            f.write(binp)


class LocationExporter:
    def __init__(self, reg, element, scene_path):
        self.reg = reg
        self.element = element
        self.scene_path = scene_path
        self.glb = GLB()
        self.images = []
        self.textures = []
        self.materials = []
        self.meshes = []
        self.nodes = []
        self.image_cache = {}
        self.material_cache = {}
        self.mesh_cache = {}
        self.lightmaps = []
        self.lights = []
        self.shader_stats = collections.Counter()
        self.skipped = collections.Counter()
        self.bounds_min = np.full(3, np.inf)
        self.bounds_max = np.full(3, -np.inf)

    def texture_index(self, tex, kind="color", limit=MAX_TEX):
        if tex is None:
            return None
        key = (kind, tex.m_Name, limit)
        if key in self.image_cache:
            return self.image_cache[key]
        try:
            img = fit(tex.image.convert("RGBA"), limit)
        except Exception as e:
            log("  texfail", tex.m_Name, e)
            self.image_cache[key] = None
            return None
        alpha = np.asarray(img)[..., 3]
        if kind == "mask":
            data = webp_bytes(img.convert("RGB"), lossless=True)
        elif kind == "alpha" and (alpha < 250).any():
            data = webp_bytes(img)
        else:
            data = webp_bytes(img.convert("RGB"))
        self.images.append({"bufferView": self.glb.add_view(data), "mimeType": "image/webp", "name": tex.m_Name})
        self.textures.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(self.images) - 1}}, "name": tex.m_Name})
        idx = len(self.textures) - 1
        self.image_cache[key] = idx
        return idx

    def tex_of(self, tex_envs, *keys):
        for k in keys:
            v = tex_envs.get(k)
            if v is not None and v.m_Texture.m_PathID:
                t = self.reg.deref(v.m_Texture)
                if t is not None:
                    return t
        return None

    def base_material(self, mat, color_keys, tex_keys, tex, floats, colors, keywords, needs_alpha=False):
        m = {"name": mat.m_Name, "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0}}
        pbr = m["pbrMetallicRoughness"]
        alpha_test = floats.get("_AlphaClip", 0) >= 0.5 or floats.get("_AlphaTest", 0) >= 0.5 or any("ALPHATEST" in k for k in keywords)
        t = self.tex_of(tex, *tex_keys)
        ti = self.texture_index(t, "alpha" if alpha_test or needs_alpha else "color")
        if ti is not None:
            pbr["baseColorTexture"] = {"index": ti}
        col = np.ones(3)
        for ck in color_keys:
            if ck in colors:
                col = col * np.clip(colors[ck][:3], 0, 4)
        pbr["baseColorFactor"] = [float(x) for x in srgb_to_linear(col)] + [1.0]
        if alpha_test and ti is not None:
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = float(np.clip(floats.get("_Cutoff", floats.get("_CutoffMain", 0.5)), 0.05, 0.95))
        if floats.get("_Cull", 2.0) < 0.5 or floats.get("_DoubleSideToggle", 0) >= 0.5:
            m["doubleSided"] = True
        return m, ti

    def material_index(self, mat):
        if mat is None:
            return None, None
        key = (mat.m_Name, id(mat))
        if key in self.material_cache:
            return self.material_cache[key]
        sn = shader_name(self.reg, mat)
        self.shader_stats[sn] += 1
        if any(s in sn for s in SKIP_SHADERS):
            self.material_cache[key] = (None, sn)
            return self.material_cache[key]
        tex, floats, colors = props(mat)
        keywords = list(getattr(mat, "m_ValidKeywords", []) or [])
        if "Terrain" in sn:
            m = self.terrain_material(mat, tex, floats, colors)
        elif "Lava" in sn:
            m = self.lava_material(mat, tex, floats, colors)
        elif "Stylized Water" in sn:
            m = self.water_material(mat, tex, floats, colors)
        elif "Waterfall" in sn:
            m = self.waterfall_material(mat, tex, floats, colors)
        elif "Decal" in sn:
            m, _ = self.base_material(mat, ["_Tint"], ["_MainTex"], tex, floats, colors, keywords, needs_alpha=True)
            m["extras"] = {"kind": "decal"}
        elif "Unlit" in sn:
            m, _ = self.base_material(mat, ["_BaseColor", "_Tint"], ["_BaseMap", "_MainTex"], tex, floats, colors, keywords)
            m["extensions"] = {"KHR_materials_unlit": {}}
            m["extras"] = {"kind": "unlit"}
        elif "Leaves" in sn or "Foliage" in sn:
            m, _ = self.base_material(mat, ["_Color"], ["_MainTex", "_BaseMap"], tex, floats, colors, keywords, needs_alpha=True)
            m["doubleSided"] = True
            if "alphaMode" not in m and m["pbrMetallicRoughness"].get("baseColorTexture"):
                m["alphaMode"] = "MASK"
                m["alphaCutoff"] = 0.45
        elif "Vertex Wave" in sn:
            m, _ = self.base_material(mat, ["_Tint"], ["_Albedo", "_MainTex"], tex, floats, colors, keywords)
            m["doubleSided"] = True
        else:
            if "Lambert" not in sn:
                log(f"  generic shader '{sn}' for {mat.m_Name}")
            m, _ = self.base_material(mat, ["_Tint", "_Color"], ["_MainTex", "_BaseMap", "_Albedo"], tex, floats, colors, keywords)
            emit_col = colors.get("_EmissionColor")
            emit_tex = self.tex_of(tex, "_EmissionMap")
            if emit_tex is not None and emit_col is not None and max(emit_col[:3]) > 0.01:
                m["emissiveTexture"] = {"index": self.texture_index(emit_tex)}
                m["emissiveFactor"] = [float(x) for x in srgb_to_linear(np.clip(emit_col[:3], 0, 1))]
        self.materials.append(m)
        self.material_cache[key] = (len(self.materials) - 1, sn)
        return self.material_cache[key]

    def terrain_material(self, mat, tex, floats, colors):
        base = self.tex_of(tex, "_BaseLayerAlbedo")
        red = self.tex_of(tex, "_RedLayerAlbedo")
        green = self.tex_of(tex, "_GreenLayerAlbedo")
        blue = self.tex_of(tex, "_BlueLayerAlbedo")
        mask = self.tex_of(tex, "_Mask")
        bi = self.texture_index(base)
        m = {"name": mat.m_Name, "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0}}
        if bi is not None:
            m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": bi}
        m["pbrMetallicRoughness"]["baseColorFactor"] = [float(x) for x in srgb_to_linear(colors.get("_BaseTint", [1, 1, 1])[:3])] + [1.0]

        def lin(k, default=(1, 1, 1)):
            return [float(x) for x in srgb_to_linear(colors.get(k, default)[:3])]

        m["extras"] = {
            "kind": "terrain",
            "mask": self.texture_index(mask, "mask", 512),
            "base": bi,
            "red": self.texture_index(red),
            "green": self.texture_index(green),
            "blue": self.texture_index(blue),
            "baseTint": lin("_BaseTint"),
            "baseTint2": lin("_BaseTintSecondary"),
            "redTint": lin("_RedTint"),
            "greenTint": lin("_GreenTint"),
            "blueTint": lin("_BlueTint"),
            "aoTint": lin("_aoTint"),
            "tiling": floats.get("_Tiling", 4.0),
            "blend": floats.get("_BlendStrength", 1.5),
        }
        return m

    def baked_lava_texture(self, tex, colors):
        key = ("lava", tex.m_Name)
        if key in self.image_cache:
            return self.image_cache[key]
        a = np.asarray(tex.image.convert("RGBA"), dtype=np.float64) / 255.0
        base = np.clip(colors.get("_Tint", [1.0, 0.03, 0.0])[:3], 0, 4)
        hot = np.clip(colors.get("_Tint2", [1.7, 0.4, 0.1])[:3], 0, 4)
        core = np.clip(colors.get("_Tint3", [1.8, 0.2, 0.0])[:3], 0, 4)
        lin = base * 0.12 + a[..., :1] * hot * 0.55 + a[..., 1:2] * core * 0.45
        lin = np.clip(lin, 0, 1)
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        img = Image.fromarray((srgb * 255).astype(np.uint8), "RGB")
        self.images.append({"bufferView": self.glb.add_view(webp_bytes(img)), "mimeType": "image/webp", "name": tex.m_Name + "_baked"})
        self.textures.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(self.images) - 1}}, "name": tex.m_Name + "_baked"})
        self.image_cache[key] = len(self.textures) - 1
        return self.image_cache[key]

    def lava_material(self, mat, tex, floats, colors):
        t = self.tex_of(tex, "_MainTex")
        ti = self.baked_lava_texture(t, colors) if t is not None else None
        m = {
            "name": mat.m_Name,
            "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0},
            "extensions": {"KHR_materials_unlit": {}},
            "extras": {"kind": "lava", "speed": [0.004, 0.012], "repeat": 6},
        }
        if ti is not None:
            m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": ti}
        return m

    def water_material(self, mat, tex, floats, colors):
        deep = srgb_to_linear(colors.get("_DeepColor", [0.05, 0.4, 0.7])[:3])
        shallow = srgb_to_linear(colors.get("_ShallowColor", [0.1, 0.3, 0.4])[:3])
        col = deep * 0.55 + shallow * 0.45
        return {
            "name": mat.m_Name,
            "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.25, "baseColorFactor": [float(x) for x in col] + [0.78]},
            "alphaMode": "BLEND",
            "extras": {"kind": "water"},
        }

    def waterfall_material(self, mat, tex, floats, colors):
        t = self.tex_of(tex, "_Background")
        ti = self.texture_index(t, "alpha")
        col = srgb_to_linear(np.clip(colors.get("_BG_Color", [0.3, 0.8, 1.0])[:3], 0, 1))
        m = {
            "name": mat.m_Name,
            "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0, "baseColorFactor": [float(x) for x in col] + [0.8]},
            "alphaMode": "BLEND",
            "doubleSided": True,
            "extensions": {"KHR_materials_unlit": {}},
            "extras": {"kind": "waterfall", "speed": [0.0, -float(floats.get("_Waterfall_speed", 0.5))]},
        }
        if ti is not None:
            m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": ti}
        return m

    def lightmap_index(self, i):
        while len(self.lightmaps) <= i:
            self.lightmaps.append(None)
        return self.lightmaps[i]

    def load_lightmaps(self, env):
        for o in env.objects:
            if o.type.name != "LightmapSettings":
                continue
            d = self.reg.read(o)
            for i, lm in enumerate(d.m_Lightmaps):
                t = self.reg.deref(lm.m_Lightmap)
                idx = self.texture_index(t, "lightmap", MAX_LIGHTMAP) if t is not None else None
                self.lightmap_index(i)
                self.lightmaps[i] = idx
                log(f"  lightmap {i}: {t.m_Name if t else None} {t.m_Width if t else 0}px")

    def render_settings(self, env):
        for o in env.objects:
            if o.type.name == "RenderSettings":
                d = o.read_typetree()

                def col(k):
                    c = d.get(k, {})
                    return [float(c.get("r", 0)), float(c.get("g", 0)), float(c.get("b", 0))]

                return {
                    "fog": bool(d.get("m_Fog")),
                    "fogColor": col("m_FogColor"),
                    "fogDensity": float(d.get("m_FogDensity", 0.01)),
                    "ambientSky": col("m_AmbientSkyColor"),
                    "ambientEquator": col("m_AmbientEquatorColor"),
                    "ambientGround": col("m_AmbientGroundColor"),
                }
        return {}

    def components(self, go):
        out = {}
        for c in go.m_Components:
            o = self.reg.resolve(c)
            if o is not None:
                out.setdefault(o.type.name, o)
        return out

    def world_to_out(self, m):
        g = MIRROR @ m @ MIRROR
        c = MIRROR[:3, :3] @ CENTER
        t = np.eye(4)
        t[:3, 3] = -c
        return t @ g

    def mesh_index(self, mesh_pptr, mats):
        mesh_key = self.reg.key(mesh_pptr)
        mat_keys = tuple(mi for mi, _ in mats)
        key = (mesh_key, mat_keys)
        if key in self.mesh_cache:
            return self.mesh_cache[key]
        mesh = self.reg.deref(mesh_pptr)
        if mesh is None:
            self.mesh_cache[key] = None
            return None
        h = MeshHandler(mesh)
        h.process()
        if not h.m_Vertices:
            self.mesh_cache[key] = None
            return None
        v = np.array(h.m_Vertices, dtype=np.float32).reshape(-1, 3)
        v[:, 2] *= -1
        nv = len(v)
        g = self.glb
        attrs = {"POSITION": g.add_accessor(v, FLOAT, "VEC3", ARRAY_BUFFER, minmax=True)}
        if h.m_Normals:
            n = np.array(h.m_Normals, dtype=np.float32).reshape(nv, -1)[:, :3].copy()
            n[:, 2] *= -1
            ln = np.linalg.norm(n, axis=1, keepdims=True)
            ln[ln == 0] = 1
            attrs["NORMAL"] = g.add_accessor((n / ln).astype(np.float32), FLOAT, "VEC3", ARRAY_BUFFER)
        uv0 = np.array(h.m_UV0, dtype=np.float32).reshape(nv, -1)[:, :2].copy() if h.m_UV0 else np.zeros((nv, 2), np.float32)
        uv0[:, 1] = 1.0 - uv0[:, 1]
        attrs["TEXCOORD_0"] = g.add_accessor(uv0, FLOAT, "VEC2", ARRAY_BUFFER)
        uv1_src = h.m_UV1 if h.m_UV1 else h.m_UV0
        if uv1_src:
            uv1 = np.array(uv1_src, dtype=np.float32).reshape(nv, -1)[:, :2].copy()
            uv1[:, 1] = 1.0 - uv1[:, 1]
            attrs["TEXCOORD_1"] = g.add_accessor(uv1, FLOAT, "VEC2", ARRAY_BUFFER)
        idx = np.array(h.m_IndexBuffer, dtype=np.uint32)
        index_size = 2 if getattr(mesh, "m_IndexFormat", 0) == 0 else 4
        prims = []
        subs = list(mesh.m_SubMeshes) if mesh.m_SubMeshes else []
        for si, sub in enumerate(subs):
            if getattr(sub, "topology", 0) != 0:
                continue
            mi = mats[min(si, len(mats) - 1)][0] if mats else None
            if mi is None:
                continue
            start = sub.firstByte // index_size
            count = sub.indexCount
            if count < 3 or start + count > len(idx):
                continue
            tri = idx[start:start + count] + np.uint32(getattr(sub, "baseVertex", 0) or 0)
            tri = tri.reshape(-1, 3)[:, ::-1].reshape(-1)
            tri = np.where(tri >= nv, 0, tri).astype(np.uint32)
            prims.append({"attributes": attrs, "indices": g.add_accessor(tri, UINT, "SCALAR", ELEMENT_ARRAY_BUFFER), "mode": 4, "material": mi})
        if not prims:
            self.mesh_cache[key] = None
            return None
        self.meshes.append({"name": mesh.m_Name, "primitives": prims})
        self.mesh_cache[key] = (len(self.meshes) - 1, v)
        return self.mesh_cache[key]

    def emit(self, go, comps, world):
        mr = self.reg.read(comps["MeshRenderer"])
        if mr is None or not getattr(mr, "m_Enabled", True):
            return
        mf = self.reg.read(comps.get("MeshFilter"))
        if mf is None:
            return
        mats = []
        for mp in mr.m_Materials:
            mats.append(self.material_index(self.reg.deref(mp)))
        if not any(mi is not None for mi, _ in mats):
            for _, sn in mats:
                self.skipped[sn] += 1
            return
        res = self.mesh_index(mf.m_Mesh, mats)
        if res is None:
            return
        mesh_i, verts = res
        out = self.world_to_out(world)
        node = {"name": go.m_Name, "mesh": mesh_i, "matrix": [float(x) for x in out.T.reshape(-1)]}
        lmi = int(mr.m_LightmapIndex)
        if lmi < 65534 and lmi < len(self.lightmaps) and self.lightmaps[lmi] is not None:
            st = mr.m_LightmapTilingOffset
            sx, sy, ox, oy = st.x, st.y, st.z, st.w
            node["extras"] = {"lightmap": lmi, "lightmapST": [float(sx), float(sy), float(ox), float(1.0 - sy - oy)]}
        self.nodes.append(node)
        wv = (out @ np.c_[verts, np.ones(len(verts))].T).T[:, :3]
        self.bounds_min = np.minimum(self.bounds_min, wv.min(axis=0))
        self.bounds_max = np.maximum(self.bounds_max, wv.max(axis=0))

    def collect_light(self, go, comps, world):
        lo = comps.get("Light")
        if lo is None:
            return
        d = lo.read_typetree()
        out = self.world_to_out(world)
        fwd = out[:3, 2]
        fwd = fwd / (np.linalg.norm(fwd) or 1)
        c = d.get("m_Color", {})
        self.lights.append({
            "name": go.m_Name,
            "type": ["spot", "directional", "point", "area"][d.get("m_Type", 2)] if d.get("m_Type", 2) < 4 else "other",
            "color": [float(c.get("r", 1)), float(c.get("g", 1)), float(c.get("b", 1))],
            "intensity": float(d.get("m_Intensity", 1)),
            "range": float(d.get("m_Range", 10)),
            "bake": int(d.get("m_Lightmapping", 4)),
            "position": [float(x) for x in out[:3, 3]],
            "direction": [float(x) for x in fwd],
        })

    def walk(self, tr, parent, force_active=False, in_lights=False):
        go = self.reg.deref(tr.m_GameObject)
        if go is None:
            return
        if not go.m_IsActive and not force_active:
            return
        world = parent @ trs_matrix(tr)
        comps = self.components(go)
        if in_lights:
            self.collect_light(go, comps, world)
        elif "MeshRenderer" in comps:
            self.emit(go, comps, world)
        for c in tr.m_Children:
            ct = self.reg.deref(c)
            if ct is None:
                continue
            child_go = self.reg.deref(ct.m_GameObject)
            name = child_go.m_Name if child_go is not None else ""
            lights = in_lights or name == "Lights"
            if name in SKIP_BRANCHES and not lights:
                continue
            self.walk(ct, world, False, lights)

    def run(self):
        env = self.reg.load(self.scene_path)
        self.load_lightmaps(env)
        roots = []
        for o in env.objects:
            if o.type.name != "Transform":
                continue
            tr = self.reg.read(o)
            if tr is not None and not tr.m_Father.m_PathID:
                go = self.reg.deref(tr.m_GameObject)
                if go is not None and go.m_Name == "Environment":
                    roots.append(tr)
        for tr in roots:
            self.walk(tr, np.eye(4), force_active=True)
        sun = next((l for l in self.lights if l["type"] == "directional"), None)
        gltf = {
            "asset": {"version": "2.0", "generator": "invokers export_spires.py"},
            "extensionsUsed": ["EXT_texture_webp", "KHR_materials_unlit", "KHR_materials_emissive_strength"],
            "extensionsRequired": ["EXT_texture_webp"],
            "scene": 0,
            "scenes": [{"nodes": list(range(len(self.nodes))), "extras": {"lightmaps": self.lightmaps}}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "textures": self.textures,
            "images": self.images,
            "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        }
        os.makedirs(OUT, exist_ok=True)
        file = f"spire_{self.element}.glb"
        path = os.path.join(OUT, file)
        self.glb.write(path, gltf)
        if HERE not in sys.path:
            sys.path.insert(0, HERE)
        import optimize_glb
        optimize_glb.optimize(path)
        info = {
            "id": self.element,
            "file": file,
            "size": os.path.getsize(path),
            "nodes": len(self.nodes),
            "meshes": len(self.meshes),
            "materials": len(self.materials),
            "textures": len(self.textures),
            "lightmaps": sum(1 for l in self.lightmaps if l is not None),
            "bounds": [[float(x) for x in self.bounds_min], [float(x) for x in self.bounds_max]],
            "stairsRadius": 20.0,
            "sun": sun,
            "render": self.render_settings(env),
        }
        log(f"  wrote {file}: {info['size'] // 1024} KB, nodes={info['nodes']} meshes={info['meshes']} materials={info['materials']} textures={info['textures']}")
        log(f"  shaders: {dict(self.shader_stats)}")
        if self.skipped:
            log(f"  skipped renderers by shader: {dict(self.skipped)}")
        if self.reg.misses:
            log(f"  unresolved CABs: {sorted(self.reg.misses)}")
        return info


def main(argv):
    wanted = {a.lower() for a in argv}
    log("looking for spire scenes in the game cache...")
    scenes = discover_scenes()
    missing = [e.lower() for e in ELEMENTS if e.lower() not in scenes]
    if missing:
        log("not cached yet, open these spires in the game first:", ", ".join(missing))
    index_path = os.path.join(OUT, "index.json")
    index = json.load(open(index_path, encoding="utf8")) if os.path.exists(index_path) else {}
    for element, path in sorted(scenes.items()):
        if wanted and element not in wanted:
            continue
        log(f"== {element}")
        reg = Registry()
        index[element] = LocationExporter(reg, element, path).run()
    os.makedirs(OUT, exist_ok=True)
    with open(index_path, "w", encoding="utf8") as fh:
        json.dump(index, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
