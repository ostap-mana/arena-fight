import os
import re
import sys
import json
import math
import numpy as np
from PIL import Image
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

import game_assets as ga

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "vfx"))
TEX_DIR = os.path.join(OUT, "tex")
SHADER_NAMES = os.path.join(HERE, "shader_names.json")
MAX_TEX = 2048
ROOT_NAME = re.compile(r"^(B_)?FX_")
COLOR_PROPS = {"_MainColor0", "_MainColor1", "_FresnelCol", "_GradCol0", "_GradCol1", "_GradCol2", "_GradMul0", "_GradMul1", "_GradMul2", "_BaseColor", "_Color", "_TintColor", "_RimColor"}
VECTOR_PROPS = {
    "_MainTexMultipliers", "_ProceduralMasksDirections", "_StaticMaskParams", "_ErosionDissolveMixedParams",
    "_DissolveRemapInvertParams", "_GradientDistortionMixedParams", "_DistortionTileSpeed", "_MaskTexTilingSpeed",
    "_MaskMixedParams", "_DistortionDepthMixedParams", "_MainTexTilingSpeed", "_CustomData1Directions",
    "_DissolveTexTilingSpeed", "_DissolveTexGradTilingSpeed", "_FresnelModeMixedParams", "_AnimMaskParams",
    "_AnimMaskDoubleSideMixedParams", "_Toggle_Erosion_AGM_Alpha",
}
FLOAT_PROPS = {
    "_MainColorMixPower", "_MainAlphaPower", "_MainAlphaMult", "_ToggleUseAlpha", "_ColorGradTexRange",
    "_MultiplyGradTexRange", "_Cull", "_ZTest", "_ZTestAlwaysToggle", "_FresnelPower", "_ToggleEnableAnimGradient",
    "_ToggleEnableEdgeMask", "_ToggleAnimMaskTimeSource", "_Surface", "_Blend", "_SrcBlend", "_DstBlend",
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def r4(v):
    v = float(v)
    if math.isnan(v):
        return 0.0
    if math.isinf(v) or abs(v) > 1e8:
        return 1e8 if v > 0 else -1e8
    return round(v, 4)


def srgb_to_linear(c):
    c = float(c)
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def lin(col):
    return [r4(srgb_to_linear(col["r"])), r4(srgb_to_linear(col["g"])), r4(srgb_to_linear(col["b"])), r4(col["a"])]


def raw_col(col):
    return [r4(col["r"]), r4(col["g"]), r4(col["b"]), r4(col["a"])]


def mirror_pos(p):
    return [r4(p["x"]), r4(p["y"]), r4(-p["z"])]


def mirror_quat(q):
    return [r4(-q["x"]), r4(-q["y"]), r4(q["z"]), r4(q["w"])]


def euler_quat(deg):
    rx, ry, rz = (math.radians(d) for d in deg)
    cx, sx = math.cos(rx / 2), math.sin(rx / 2)
    cy, sy = math.cos(ry / 2), math.sin(ry / 2)
    cz, sz = math.cos(rz / 2), math.sin(rz / 2)
    qy = (0.0, sy, 0.0, cy)
    qx = (sx, 0.0, 0.0, cx)
    qz = (0.0, 0.0, sz, cz)

    def mul(a, b):
        ax, ay, az, aw = a
        bx, by, bz, bw = b
        return (
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        )

    return mul(mul(qy, qx), qz)


def keys(curve):
    return [[r4(k["time"]), r4(k["value"]), r4(k["inSlope"]), r4(k["outSlope"])] for k in curve.get("m_Curve", [])]


def mmc(c, scale=1.0):
    st = c["minMaxState"]
    out = {"m": st, "s": r4(c["scalar"] * scale)}
    if st in (2, 3):
        out["n"] = r4(c["minScalar"] * scale)
    if st in (1, 2):
        out["c"] = keys(c["maxCurve"])
    if st == 2:
        out["d"] = keys(c["minCurve"])
    return out


def is_zero(c):
    return c["m"] == 0 and c["s"] == 0


def gradient(g, linear=True):
    conv = lin if linear else raw_col
    nc = g["m_NumColorKeys"]
    na = g["m_NumAlphaKeys"]
    cols = [[r4(g["ctime%d" % i] / 65535.0)] + conv(g["key%d" % i])[:3] for i in range(nc)]
    alphas = [[r4(g["atime%d" % i] / 65535.0), r4(g["key%d" % i]["a"])] for i in range(na)]
    return {"c": cols, "a": alphas, "f": g.get("m_Mode", 0)}


def mmg(g, linear=True):
    st = g["minMaxState"]
    conv = lin if linear else raw_col
    out = {"m": st}
    if st in (0, 2):
        out["x"] = conv(g["maxColor"])
    if st == 2:
        out["n"] = conv(g["minColor"])
    if st in (1, 3, 4):
        out["g"] = gradient(g["maxGradient"], linear)
    if st == 3:
        out["h"] = gradient(g["minGradient"], linear)
    return out


class World:
    def __init__(self):
        self.cabs = ga.cab_map()
        self.files = {}
        self.loaded = set()
        self.envs = []
        self.env_by_path = {}
        self.tt_cache = {}
        self.shader_names = json.load(open(SHADER_NAMES, encoding="utf8")) if os.path.exists(SHADER_NAMES) else {}

    def load(self, path):
        if path in self.loaded:
            return
        env = UnityPy.load(path)
        for name, sf in ga.serialized_files(env):
            self.files[name.lower()] = sf
        self.loaded.add(path)
        self.envs.append(env)
        self.env_by_path[path] = env

    def file_of(self, sf, fid):
        if fid == 0:
            return sf
        try:
            ext = sf.externals[fid - 1].path.replace("\\", "/").split("/")[-1].lower()
        except Exception:
            return None
        if ext not in self.files:
            path = self.cabs.get(ext)
            if not path:
                return None
            self.load(path)
        return self.files.get(ext)

    def obj(self, sf, pptr):
        if not pptr or not pptr.get("m_PathID"):
            return None
        target = self.file_of(sf, pptr.get("m_FileID", 0))
        if target is None:
            return None
        return target.objects.get(pptr["m_PathID"])

    def tt(self, o):
        key = (id(o.assets_file), o.path_id)
        if key not in self.tt_cache:
            try:
                self.tt_cache[key] = o.read_typetree()
            except Exception as e:
                log("  typetree fail", o.type.name, o.path_id, e)
                self.tt_cache[key] = None
        return self.tt_cache[key]

    def ref(self, sf, pptr):
        o = self.obj(sf, pptr)
        return (o, self.tt(o)) if o is not None else (None, None)

    def shader_name(self, sf, pptr):
        o = self.obj(sf, pptr)
        if o is None:
            return None
        key = "%s:%d" % (o.assets_file.name.lower(), o.path_id)
        if key not in self.shader_names:
            try:
                t = o.read_typetree()
                self.shader_names[key] = t.get("m_ParsedForm", {}).get("m_Name") or t.get("m_Name") or "?"
            except Exception as e:
                log("  shader read fail", key, e)
                self.shader_names[key] = "?"
            with open(SHADER_NAMES, "w", encoding="utf8") as fh:
                json.dump(self.shader_names, fh, indent=1)
        return self.shader_names[key]


class VfxExporter:
    def __init__(self, world, path, code):
        self.w = world
        self.code = code
        self.path = path
        world.load(path)
        self.env = world.env_by_path[path]
        self.textures = {}
        self.materials = {}
        self.meshes = {}
        self.prefabs = {}
        self.mat_keys = {}
        self.mesh_keys = {}
        self.tex_keys = {}

    def objects(self, kind):
        for name, sf in ga.serialized_files(self.env):
            for o in sf.objects.values():
                if o.type.name == kind:
                    yield o

    def components(self, sf, go):
        out = []
        for c in go.get("m_Component", []):
            o, t = self.w.ref(sf, c["component"])
            if o is not None and t is not None:
                out.append((o.type.name, o, t))
        return out

    def texture(self, sf, pptr):
        o, t = self.w.ref(sf, pptr)
        if o is None or t is None:
            return None
        key = (id(o.assets_file), o.path_id)
        if key in self.tex_keys:
            return self.tex_keys[key]
        name = t["m_Name"]
        base = re.sub(r"[^A-Za-z0-9_\-]", "_", name)
        fname = base + ".webp"
        dest = os.path.join(TEX_DIR, fname)
        if not os.path.exists(dest):
            try:
                img = o.read().image
            except Exception as e:
                log("  texture fail", name, e)
                self.tex_keys[key] = None
                return None
            if max(img.size) > MAX_TEX:
                s = MAX_TEX / max(img.size)
                img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
            img = img.convert("RGBA")
            a = np.asarray(img)[..., 3]
            if (a >= 250).all():
                img.convert("RGB").save(dest, "WEBP", lossless=True, method=6)
            else:
                img.save(dest, "WEBP", lossless=True, method=6, exact=True)
        ts = t.get("m_TextureSettings", {})
        self.textures[base] = {
            "f": "tex/" + fname,
            "srgb": 1 if t.get("m_ColorSpace", 1) == 1 else 0,
            "wrap": [ts.get("m_WrapU", 0), ts.get("m_WrapV", 0)],
            "w": t.get("m_Width"),
            "h": t.get("m_Height"),
            "mips": 1 if (t.get("m_MipCount") or 1) > 1 else 0,
        }
        self.tex_keys[key] = base
        return base

    def material(self, sf, pptr):
        o, t = self.w.ref(sf, pptr)
        if o is None or t is None:
            return None
        key = (id(o.assets_file), o.path_id)
        if key in self.mat_keys:
            return self.mat_keys[key]
        name = t["m_Name"]
        uniq = name
        n = 2
        while uniq in self.materials:
            uniq = "%s#%d" % (name, n)
            n += 1
        shader = self.w.shader_name(o.assets_file, t["m_Shader"]) or "?"
        props = t["m_SavedProperties"]
        m = {"sh": shader, "kw": sorted(t.get("m_ValidKeywords", [])), "q": t.get("m_CustomRenderQueue", -1), "f": {}, "v": {}, "t": {}}
        for k, v in props.get("m_Floats", []):
            if k in FLOAT_PROPS:
                m["f"][k] = r4(v)
        for k, v in props.get("m_Colors", []):
            if k in COLOR_PROPS:
                m["v"][k] = lin(v)
            elif k in VECTOR_PROPS:
                m["v"][k] = raw_col(v)
        for k, v in props.get("m_TexEnvs", []):
            tex = self.texture(o.assets_file, v["m_Texture"])
            if tex:
                m["t"][k] = [tex, r4(v["m_Scale"]["x"]), r4(v["m_Scale"]["y"]), r4(v["m_Offset"]["x"]), r4(v["m_Offset"]["y"])]
        self.materials[uniq] = m
        self.mat_keys[key] = uniq
        return uniq

    def mesh(self, sf, pptr):
        o, t = self.w.ref(sf, pptr)
        if o is None:
            return None
        key = (id(o.assets_file), o.path_id)
        if key in self.mesh_keys:
            return self.mesh_keys[key]
        try:
            mesh = o.read()
            h = MeshHandler(mesh)
            h.process()
        except Exception as e:
            log("  mesh fail", e)
            self.mesh_keys[key] = None
            return None
        if not h.m_Vertices:
            self.mesh_keys[key] = None
            return None
        V = np.array(h.m_Vertices, dtype=np.float32).reshape(-1, 3)
        V[:, 2] *= -1
        nv = len(V)
        out = {"p": [r4(x) for x in V.reshape(-1)]}
        if h.m_Normals:
            N = np.array(h.m_Normals, dtype=np.float32).reshape(nv, -1)[:, :3].copy()
            N[:, 2] *= -1
            out["n"] = [r4(x) for x in N.reshape(-1)]
        if h.m_UV0:
            out["u"] = [r4(x) for x in np.array(h.m_UV0, dtype=np.float32).reshape(nv, -1)[:, :2].reshape(-1)]
        if h.m_UV1:
            out["u2"] = [r4(x) for x in np.array(h.m_UV1, dtype=np.float32).reshape(nv, -1)[:, :2].reshape(-1)]
        if h.m_Colors:
            C = np.array(h.m_Colors, dtype=np.float32).reshape(nv, -1)
            if C.max() > 1.5:
                C = C / 255.0
            out["c"] = [r4(x) for x in C[:, :4].reshape(-1)]
        idx = np.array(h.m_IndexBuffer, dtype=np.uint32).reshape(-1, 3)[:, ::-1].reshape(-1)
        out["i"] = [int(x) for x in idx]
        name = mesh.m_Name
        uniq = name
        n = 2
        while uniq in self.meshes:
            uniq = "%s#%d" % (name, n)
            n += 1
        self.meshes[uniq] = out
        self.mesh_keys[key] = uniq
        return uniq

    def shape(self, s):
        rot = euler_quat([s["m_Rotation"]["x"], s["m_Rotation"]["y"], s["m_Rotation"]["z"]])
        q = {"x": rot[0], "y": rot[1], "z": rot[2], "w": rot[3]}
        out = {
            "type": s["type"],
            "angle": r4(s["angle"]),
            "length": r4(s["length"]),
            "radius": r4(s["radius"]["value"]),
            "thick": r4(s["radiusThickness"]),
            "arc": r4(s["arc"]["value"]),
            "arcMode": s["arc"]["mode"],
            "arcSpread": r4(s["arc"]["spread"]),
            "box": [r4(s["boxThickness"]["x"]), r4(s["boxThickness"]["y"]), r4(s["boxThickness"]["z"])],
            "donut": r4(s["donutRadius"]),
            "pos": mirror_pos(s["m_Position"]),
            "rot": mirror_quat(q),
            "scale": [r4(s["m_Scale"]["x"]), r4(s["m_Scale"]["y"]), r4(s["m_Scale"]["z"])],
            "rndDir": r4(s["randomDirectionAmount"]),
            "sphDir": r4(s["sphericalDirectionAmount"]),
            "rndPos": r4(s["randomPositionAmount"]),
            "align": 1 if s["alignToDirection"] else 0,
        }
        if s["type"] in (6, 13, 14):
            mesh = None
            if s.get("m_Mesh", {}).get("m_PathID"):
                mesh = self.mesh(self.cur_sf, s["m_Mesh"])
            elif s.get("m_MeshRenderer", {}).get("m_PathID"):
                o, mr = self.w.ref(self.cur_sf, s["m_MeshRenderer"])
                if mr is not None:
                    go_o, go = self.w.ref(o.assets_file, mr["m_GameObject"])
                    for kind, co, ct in self.components(go_o.assets_file, go):
                        if kind == "MeshFilter":
                            mesh = self.mesh(co.assets_file, ct["m_Mesh"])
            if mesh:
                out["mesh"] = mesh
        return out

    def particle_system(self, sf, ps, psr):
        im = ps["InitialModule"]
        out = {
            "dur": r4(ps["lengthInSec"]),
            "loop": 1 if ps["looping"] else 0,
            "prewarm": 1 if ps["prewarm"] else 0,
            "delay": mmc(ps["startDelay"]),
            "speed": r4(ps.get("simulationSpeed", 1.0)),
            "space": ps.get("moveWithTransform", 0),
            "scaling": ps.get("scalingMode", 1),
            "life": mmc(im["startLifetime"]),
            "spd": mmc(im["startSpeed"]),
            "size": mmc(im["startSize"]),
            "rot": mmc(im["startRotation"]),
            "col": mmg(im["startColor"]),
            "grav": mmc(im["gravityModifier"]),
            "max": min(int(im["maxNumParticles"]), 600),
            "flipRot": r4(im.get("randomizeRotationDirection", 0.0)),
        }
        if im.get("size3D"):
            out["size3"] = [mmc(im["startSize"]), mmc(im["startSizeY"]), mmc(im["startSizeZ"])]
        if im.get("rotation3D"):
            out["rot3"] = [mmc(im["startRotationX"]), mmc(im["startRotationY"]), mmc(im["startRotation"])]
        em = ps["EmissionModule"]
        if em["enabled"]:
            out["rate"] = mmc(em["rateOverTime"])
            out["rateDist"] = mmc(em["rateOverDistance"])
            bursts = []
            for b in em.get("m_Bursts", []):
                bursts.append({"t": r4(b["time"]), "n": mmc(b["countCurve"]), "cyc": b.get("cycleCount", 1), "rep": r4(b.get("repeatInterval", 0.01)), "p": r4(b.get("probability", 1.0))})
            out["bursts"] = bursts
        sh = ps["ShapeModule"]
        if sh["enabled"]:
            self.cur_sf = sf
            out["shape"] = self.shape(sh)
        vm = ps["VelocityModule"]
        if vm["enabled"]:
            v = {"x": mmc(vm["x"]), "y": mmc(vm["y"]), "z": mmc(vm["z"], -1.0), "world": 1 if vm["inWorldSpace"] else 0}
            for k, sc in (("orbitalX", -1.0), ("orbitalY", -1.0), ("orbitalZ", 1.0)):
                c = mmc(vm[k], sc)
                if not is_zero(c):
                    v[k] = c
            for k, sc in (("orbitalOffsetX", 1.0), ("orbitalOffsetY", 1.0), ("orbitalOffsetZ", -1.0)):
                c = mmc(vm[k], sc)
                if not is_zero(c):
                    v[k] = c
            r = mmc(vm["radial"])
            if not is_zero(r):
                v["radial"] = r
            v["mod"] = mmc(vm["speedModifier"])
            out["vel"] = v
        cv = ps["ClampVelocityModule"]
        if cv["enabled"]:
            out["limit"] = {"mag": mmc(cv["magnitude"]), "damp": r4(cv["dampen"]), "drag": mmc(cv["drag"]), "sep": 1 if cv["separateAxis"] else 0}
        fm = ps["ForceModule"]
        if fm["enabled"]:
            out["force"] = {"x": mmc(fm["x"]), "y": mmc(fm["y"]), "z": mmc(fm["z"], -1.0), "world": 1 if fm["inWorldSpace"] else 0}
        cm = ps["ColorModule"]
        if cm["enabled"]:
            out["colLife"] = mmg(cm["gradient"])
        sm = ps["SizeModule"]
        if sm["enabled"]:
            out["sizeLife"] = [mmc(sm["curve"]), mmc(sm["y"]), mmc(sm["z"])] if sm["separateAxes"] else [mmc(sm["curve"])]
        rm = ps["RotationModule"]
        if rm["enabled"]:
            out["rotLife"] = [mmc(rm["x"], -1.0), mmc(rm["y"], -1.0), mmc(rm["curve"])] if rm["separateAxes"] else [mmc(rm["curve"])]
        uv = ps["UVModule"]
        if uv["enabled"] and uv["mode"] == 0:
            out["sheet"] = {"x": uv["tilesX"], "y": uv["tilesY"], "type": uv["animationType"], "row": uv["rowIndex"], "rowMode": uv.get("rowMode", 1), "frame": mmc(uv["frameOverTime"]), "start": mmc(uv["startFrame"]), "cyc": r4(uv["cycles"]), "timeMode": uv.get("timeMode", 0), "fps": r4(uv.get("fps", 30))}
        nm = ps["NoiseModule"]
        if nm["enabled"]:
            out["noise"] = {"str": mmc(nm["strength"]), "freq": r4(nm["frequency"]), "scroll": mmc(nm["scrollSpeed"]), "damp": 1 if nm["damping"] else 0, "pos": mmc(nm["positionAmount"]), "rot": mmc(nm["rotationAmount"]), "size": mmc(nm["sizeAmount"])}
        ih = ps["InheritVelocityModule"]
        if ih["enabled"]:
            out["inherit"] = {"mode": ih["m_Mode"], "k": mmc(ih["m_Curve"])}
        cd = ps["CustomDataModule"]
        if cd["enabled"]:
            custom = []
            for i in (0, 1):
                mode = cd["mode%d" % i]
                if mode == 1:
                    n = cd["vectorComponentCount%d" % i]
                    custom.append({"mode": 1, "v": [mmc(cd["vector%d_%d" % (i, k)]) for k in range(n)]})
                elif mode == 2:
                    custom.append({"mode": 2, "col": mmg(cd["color%d" % i], False)})
                else:
                    custom.append({"mode": 0})
            out["custom"] = custom
        sub = ps["SubModule"]
        if sub["enabled"]:
            subs = []
            for e in sub.get("subEmitters", []):
                o, _ = self.w.ref(sf, e["emitter"])
                if o is None:
                    continue
                subs.append({"ps": o.path_id, "type": e["type"], "inherit": e.get("properties", 0), "p": r4(e.get("emitProbability", 1.0))})
            out["subs"] = subs
        tm = ps["TrailModule"]
        if tm["enabled"]:
            out["trail"] = {"mode": tm["mode"], "ratio": r4(tm["ratio"]), "life": mmc(tm["lifetime"]), "minDist": r4(tm["minVertexDistance"]), "tex": tm["textureMode"], "world": 1 if tm["worldSpace"] else 0, "die": 1 if tm["dieWithParticles"] else 0, "sizeW": 1 if tm["sizeAffectsWidth"] else 0, "inheritCol": 1 if tm["inheritParticleColor"] else 0, "colLife": mmg(tm["colorOverLifetime"]), "width": mmc(tm["widthOverTrail"]), "colTrail": mmg(tm["colorOverTrail"]), "ribbons": tm.get("ribbonCount", 1)}
        if psr is not None:
            mats = [self.material(sf, m) for m in psr.get("m_Materials", [])]
            r = {
                "mode": psr["m_RenderMode"],
                "mat": mats[0] if mats else None,
                "trailMat": mats[1] if len(mats) > 1 else None,
                "align": psr.get("m_RenderAlignment", 0),
                "len": r4(psr.get("m_LengthScale", 2.0)),
                "vel": r4(psr.get("m_VelocityScale", 0.0)),
                "camVel": r4(psr.get("m_CameraVelocityScale", 0.0)),
                "order": psr.get("m_SortingOrder", 0),
                "fudge": r4(psr.get("m_SortingFudge", 0.0)),
                "minSize": r4(psr.get("m_MinParticleSize", 0.0)),
                "maxSize": r4(psr.get("m_MaxParticleSize", 0.5)),
                "pivot": mirror_pos(psr.get("m_Pivot", {"x": 0, "y": 0, "z": 0})),
                "flip": [r4(psr["m_Flip"]["x"]), r4(psr["m_Flip"]["y"]), r4(psr["m_Flip"]["z"])] if "m_Flip" in psr else [0, 0, 0],
                "streams": psr.get("m_VertexStreams", []) if psr.get("m_UseCustomVertexStreams") else [0, 1, 3, 4],
                "on": 1 if psr.get("m_Enabled", 1) else 0,
            }
            if r["mode"] == 4:
                meshes = [self.mesh(sf, psr[k]) for k in ("m_Mesh", "m_Mesh1", "m_Mesh2", "m_Mesh3") if psr.get(k, {}).get("m_PathID")]
                r["meshes"] = [m for m in meshes if m]
            out["r"] = r
        return out

    def ara_trail(self, sf, t):
        mats = [self.material(sf, m) for m in t.get("materials", [])]
        return {
            "time": r4(t.get("time", 0.5)),
            "thick": r4(t.get("thickness", 0.2)),
            "thickLen": keys(t["thicknessOverLength"]),
            "thickTime": keys(t["thicknessOverTime"]),
            "colLen": gradient(t["colorOverLength"]),
            "colTime": gradient(t["colorOverTime"]),
            "align": t.get("alignment", 0),
            "space": t.get("space", 0),
            "emit": t.get("emit", 1),
            "minDist": r4(t.get("minDistance", 0.025)),
            "texMode": t.get("textureMode", 0),
            "uv": r4(t.get("uvFactor", 1.0)),
            "mat": mats[0] if mats else None,
        }

    def export_prefab(self, sf, root_tr_o, root_tt):
        nodes = []
        ps_index = {}

        def rec(tr_o, tr, parent):
            go_o, go = self.w.ref(tr_o.assets_file, tr["m_GameObject"])
            if go is None:
                return
            idx = len(nodes)
            node = {
                "n": go["m_Name"],
                "p": parent,
                "t": mirror_pos(tr["m_LocalPosition"]),
                "r": mirror_quat(tr["m_LocalRotation"]),
                "s": [r4(tr["m_LocalScale"]["x"]), r4(tr["m_LocalScale"]["y"]), r4(tr["m_LocalScale"]["z"])],
            }
            if not go.get("m_IsActive", 1):
                node["off"] = 1
            nodes.append(node)
            comps = self.components(go_o.assets_file, go)
            psr = next((t for k, o, t in comps if k == "ParticleSystemRenderer"), None)
            mf = next((t for k, o, t in comps if k == "MeshFilter"), None)
            for kind, o, t in comps:
                if kind == "ParticleSystem":
                    node["ps"] = self.particle_system(o.assets_file, t, psr)
                    ps_index[o.path_id] = idx
                elif kind == "MeshRenderer" and mf is not None:
                    mesh = self.mesh(o.assets_file, mf["m_Mesh"])
                    mats = [self.material(o.assets_file, m) for m in t.get("m_Materials", [])]
                    if mesh and t.get("m_Enabled", 1):
                        node["mr"] = {"mesh": mesh, "mats": mats, "order": t.get("m_SortingOrder", 0)}
                elif kind == "MonoBehaviour":
                    if "thicknessOverLength" in t:
                        node["ara"] = self.ara_trail(o.assets_file, t)
                    elif "socket" in t and isinstance(t.get("socket"), dict):
                        node["fx"] = {
                            "socket": t["socket"].get("socket", ""),
                            "follow": t.get("shouldFollow", 0),
                            "copyRot": t.get("shouldCopyRotation", 0),
                            "dying": r4(t.get("dyingTime", 1.0)),
                            "camOffset": r4(t.get("offsetToCamera", 0.0)) if t.get("enableOffsetToCamera") else 0,
                            "rotToProducer": t.get("shouldRotateToProducer", 0),
                            "randRot": [r4(t.get("randomRotationStart", 0)), r4(t.get("randomRotationEnd", 0))] if t.get("randomRotation") else None,
                        }
                    elif "dyingTime" in t:
                        node["fx"] = {"dying": r4(t.get("dyingTime", 1.0)), "projectile": 1}
            for c in tr.get("m_Children", []):
                co, ct = self.w.ref(tr_o.assets_file, c)
                if ct is not None:
                    rec(co, ct, idx)

        rec(root_tr_o, root_tt, -1)
        for n in nodes:
            ps = n.get("ps")
            if ps and ps.get("subs"):
                for s in ps["subs"]:
                    s["node"] = ps_index.get(s.pop("ps"), -1)
        return nodes

    def skill_config(self):
        for o in self.objects("MonoBehaviour"):
            t = self.w.tt(o)
            if not t or "SkillConfigs" not in t:
                continue
            out = {}
            for sc in t["SkillConfigs"]:
                lst = []
                for kind in ("PhasesVfxs", "BlockVfxs"):
                    for b in sc.get(kind, []):
                        cfg = b.get("Config", {})
                        go_o, go = self.w.ref(o.assets_file, cfg.get("PrefabGameObject", {}))
                        if go is None:
                            continue
                        lst.append({"fx": go["m_Name"], "t": r4(b.get("TimeOffset", 0.0)), "on": b.get("CreateOn", 0), "block": str(b.get("BlockId", b.get("PhaseType", ""))), "kind": kind[:-4].lower()})
                shakes = [{"t": r4(s.get("TimeOffset", 0)), "in": r4(s.get("EaseInTime", 0)), "out": r4(s.get("EaseOutTime", 0))} for s in sc.get("PhasesCameraShakes", []) + sc.get("BlockCameraShakes", [])]
                out[str(sc["SkillType"])] = {"fx": lst, "shake": shakes}
            return out
        return {}

    def sockets(self, kind="ING"):
        target = "PCHAR_%s_%s" % (kind, self.code)
        out = {}
        for o in self.objects("Transform"):
            t = self.w.tt(o)
            if t is None or t["m_Father"].get("m_PathID"):
                continue
            go_o, go = self.w.ref(o.assets_file, t["m_GameObject"])
            if go is None or go["m_Name"] != target:
                continue

            def rec(tr_o, tr, parent_name):
                g_o, g = self.w.ref(tr_o.assets_file, tr["m_GameObject"])
                if g is None:
                    return
                name = g["m_Name"]
                if name.startswith("FX_") and name not in out:
                    out[name] = {
                        "bone": parent_name,
                        "t": mirror_pos(tr["m_LocalPosition"]),
                        "r": mirror_quat(tr["m_LocalRotation"]),
                    }
                    if not g.get("m_IsActive", 1):
                        out[name]["off"] = 1
                for c in tr.get("m_Children", []):
                    co, ct = self.w.ref(tr_o.assets_file, c)
                    if ct is not None:
                        rec(co, ct, name)

            for c in t.get("m_Children", []):
                co, ct = self.w.ref(o.assets_file, c)
                if ct is not None:
                    rec(co, ct, "")
            break
        return out

    def run(self):
        roots = []
        for o in self.objects("Transform"):
            t = self.w.tt(o)
            if t is None or t["m_Father"].get("m_PathID"):
                continue
            go_o, go = self.w.ref(o.assets_file, t["m_GameObject"])
            if go is None or not ROOT_NAME.match(go["m_Name"]):
                continue
            roots.append((go["m_Name"], o, t))
        roots.sort(key=lambda r: r[0])
        for name, o, t in roots:
            uniq = name
            n = 2
            while uniq in self.prefabs:
                uniq = "%s#%d" % (name, n)
                n += 1
            try:
                self.prefabs[uniq] = self.export_prefab(o.assets_file, o, t)
            except Exception:
                import traceback
                traceback.print_exc()
        log(f"  {len(self.prefabs)} prefabs, {len(self.materials)} materials, {len(self.textures)} textures, {len(self.meshes)} meshes")
        return {
            "id": self.code.lower(),
            "skills": self.skill_config(),
            "sockets": self.sockets(),
            "prefabs": self.prefabs,
            "materials": self.materials,
            "textures": self.textures,
            "meshes": self.meshes,
        }


def export_code(world, code, path=None):
    path = path or ga.hero_bundles([code])[code]["path"]
    if not path:
        log(f"{code}: bundle not downloaded, open this hero in the game first")
        return None
    log(f"== {code} <- {path}")
    data = VfxExporter(world, path, code).run()
    lobby_name = ga.Catalog().lobby_bundle(code)
    lobby_path = ga.bundle_path(lobby_name) if lobby_name else None
    if lobby_path:
        data["lobbySockets"] = VfxExporter(world, lobby_path, code).sockets("LOB")
        log(f"  {len(data['lobbySockets'])} lobby sockets")
    else:
        log(f"{code}: lobby bundle not downloaded, lobby skin FX will use battle sockets")
    dest = os.path.join(OUT, code.lower() + ".json")
    with open(dest, "w", encoding="utf8") as f:
        json.dump(data, f, separators=(",", ":"))
    log(f"  wrote {dest} {os.path.getsize(dest) // 1024} KB")
    return data


def main(argv):
    os.makedirs(TEX_DIR, exist_ok=True)
    world = World()
    ok = 0
    for code in [a.upper() for a in argv]:
        if export_code(world, code):
            ok += 1
    return 0 if ok == len(argv) else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
