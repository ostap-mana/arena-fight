import io
import os
import sys
import json

import UnityPy
from PIL import Image

import game_assets as ga
import export_heroes as eh
import char_materials
import optimize_glb
import pack_masks

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CODES = ["MAG018", "ELD037", "ELD025"]
LOBBY_TEX = 2048
LOBBY_MASK = 1024
MASK_KEYS = ("_MSE_SkinMask", "_AOSE_Mask")
PLATFORM_SCENE = "64cb31baef87e0619063cf1e3e1469a0"
REFLECTION_CUBE = -1735286067516325744
LOBBY_COLORS = ("_EmissiveColor", "_RimColor", "_NoiseColor", "_S_AmbientColor")
LOBBY_VECTORS = ("_vfxEmissionParams", "_NoiseParams", "_EmissionAnimParams")
LOBBY_FLOATS = {"_Smoothness": 1.0, "_SkinMaskUseToggle": 0.0, "_EmissionToggle": 1.0, "_Cutoff": 0.5}
HAIR_COLORS = ("_SpecularColor1", "_SpecularColor2", "_Color", "_EmissiveColor", "_RimColor")
HAIR_VECTORS = ("_SpecParams", "_TilingOffset", "_HighlightParams", "_vfxEmissionParams")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def gamma_to_linear(v):
    v = float(v)
    if v <= 0.04045:
        return v / 12.92
    if v < 1.0:
        return ((v + 0.055) / 1.055) ** 2.4
    return v ** 2.2


def linear_color(c):
    return [round(gamma_to_linear(c[0]), 5), round(gamma_to_linear(c[1]), 5), round(gamma_to_linear(c[2]), 5), round(float(c[3]), 5)]


def keywords(mat):
    kw = getattr(mat, "m_ValidKeywords", None) or getattr(mat, "m_ShaderKeywords", None) or []
    if isinstance(kw, str):
        kw = kw.split()
    return list(kw)


def lobby_kind(glb, mat):
    keys = glb.tex_keys(mat)
    if "_StrandMap" in keys and "_AOSE_Mask" in keys:
        return "hair"
    if "_SkinGradientTex" in keys and "_MSE_SkinMask" in keys:
        return "lobby"
    return None


def save_lossless(img, path, max_side):
    if max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", lossless=True, exact=True, method=6)


def export_texture(tex, out_dir, max_side, cache, mode="RGBA", mask=False):
    name = tex.m_Name.replace(" ", "_")
    rel = "tex/%s.webp" % name
    if name not in cache:
        path = os.path.join(out_dir, rel)
        img = tex.image.convert(mode)
        save_lossless(pack_masks.posterize(img) if mask else img, path, max_side)
        cache[name] = {"file": rel, "srgb": 1 if getattr(tex, "m_ColorSpace", 1) == 1 else 0}
    return cache[name]


def lobby_cube(out_dir, cache):
    env = UnityPy.load(ga.bundle_path(PLATFORM_SCENE + ".bundle"))
    cabs = ga.cab_map()
    for _, sf in ga.serialized_files(env):
        for ext in sf.externals:
            cab = ext.path.replace(chr(92), "/").split("/")[-1].lower()
            path = cabs.get(cab)
            if not path:
                continue
            for o in UnityPy.load(path).objects:
                if o.path_id == REFLECTION_CUBE and o.type.name == "Cubemap":
                    return char_materials.export_cube(o.read(), out_dir, cache)
    return None


def lobby_bundle(code):
    return ga.Catalog().lobby_bundle(code)


def make_exporter(glb, cube):
    cache = {}

    class LobbyExporter(glb.Exporter):
        def image_index(self, tex, kind):
            key = (kind, tex.m_Name)
            if key in self.image_cache:
                return self.image_cache[key]
            try:
                img = tex.image.convert("RGBA")
                if max(img.size) > LOBBY_TEX:
                    k = LOBBY_TEX / max(img.size)
                    img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
                buf = io.BytesIO()
                if kind == "normal":
                    data = glb.normal_png(tex)
                    Image.open(io.BytesIO(data)).save(buf, "WEBP", lossless=True, method=6)
                    has_alpha = False
                else:
                    has_alpha = bool(min(img.getchannel("A").getextrema()) < 250)
                    img.save(buf, "WEBP", quality=94, alpha_quality=100, method=6, exact=True)
            except Exception as e:
                log("  texfail", tex.m_Name, e)
                self.image_cache[key] = (None, False)
                return self.image_cache[key]
            view = self.glb.add_view(buf.getvalue())
            self.images.append({"bufferView": view, "mimeType": "image/webp", "name": tex.m_Name})
            self.textures.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(self.images) - 1}}})
            self.texture_names.append(tex.m_Name)
            self.image_cache[key] = (len(self.textures) - 1, has_alpha)
            return self.image_cache[key]

        def material_index(self, mat):
            if mat is None:
                return None
            kind = lobby_kind(glb, mat)
            if kind is None:
                return super().material_index(mat)
            if mat.m_Name in self.material_cache:
                return self.material_cache[mat.m_Name]
            kws = keywords(mat)
            m = {"name": mat.m_Name, "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0}}
            base = glb.tex_prop(self.b, mat, glb.BASE_KEYS)
            if base is not None:
                ti, _ = self.image_index(base, "base")
                if ti is not None:
                    m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": ti}
            if kind == "hair" or "LOBBY_CHARACTER_NORMALMAP" in kws:
                nm = glb.tex_prop(self.b, mat, glb.NORMAL_KEYS)
                if nm is not None:
                    ti, _ = self.image_index(nm, "normal")
                    if ti is not None:
                        m["normalTexture"] = {"index": ti}
            if "ALPHA_TEST" in kws:
                m["alphaMode"] = "MASK"
                m["alphaCutoff"] = glb.float_prop(mat, "_Cutoff", 0.5)
            if glb.float_prop(mat, "_Cull", 2.0) < 0.5:
                m["doubleSided"] = True
            m["extras"] = {"character": self.extras(mat, kind, kws)}
            self.materials.append(m)
            self.material_cache[mat.m_Name] = len(self.materials) - 1
            log("  %s material %s %s" % (kind, mat.m_Name, kws))
            return self.material_cache[mat.m_Name]

        def extras(self, mat, kind, kws):
            out = {"shader": "SH_CharacterLobby" if kind == "lobby" else "SH_HairSpecularStrand", "keywords": kws, "ReflectionCube": cube}
            colors, vectors = (LOBBY_COLORS, LOBBY_VECTORS) if kind == "lobby" else (HAIR_COLORS, HAIR_VECTORS)
            for key in colors:
                c = glb.color_prop(mat, key)
                if c is not None:
                    out[key.strip("_")] = linear_color(c)
            for key in vectors:
                c = glb.color_prop(mat, key)
                if c is not None:
                    out[key.strip("_")] = [round(float(x), 5) for x in c]
            if kind == "lobby":
                for key, default in LOBBY_FLOATS.items():
                    out[key.strip("_")] = round(glb.float_prop(mat, key, default), 5)
                textures = (("_MSE_SkinMask", LOBBY_MASK, "RGBA"), ("_SkinGradientTex", 256, "RGB"), ("_VFX_Mask", 512, "RGB"), ("_NoiseTex", 256, "RGB"))
            else:
                textures = (("_AOSE_Mask", LOBBY_MASK, "RGBA"), ("_StrandMap", 512, "RGB"))
            for key, side, mode in textures:
                t = glb.tex_prop(self.b, mat, (key,))
                if t is not None:
                    out[key.strip("_")] = export_texture(t, glb.OUT, side, cache, mode, mask=key in MASK_KEYS)
            return out

        def write_glb(self):
            write = self.glb.write

            def with_webp(path, gltf):
                gltf.setdefault("extensionsUsed", []).append("EXT_texture_webp")
                write(path, gltf)

            self.glb.write = with_webp

    return LobbyExporter


def pick_lobby_group(glb, b, code):
    groups = {}
    for o in b.by_type("SkinnedMeshRenderer"):
        smr = b.read(o)
        if smr is None:
            continue
        go = b.deref(smr.m_GameObject)
        if go is None:
            continue
        tr, tr_key = glb.transform_of(b, go)
        if tr is None:
            continue
        root, root_key = glb.walk_root(b, tr, tr_key)
        name = glb.go_name(b, root)
        entry = groups.setdefault(name, (root, root_key, []))
        entry[2].append((smr, tr_key))
    for name in ("MDL_LOB_" + code, "PCHAR_LOB_" + code):
        if name in groups:
            return name, groups[name]
    return None, None


def export_code(glb, Exporter, code):
    bundle = lobby_bundle(code)
    path = ga.bundle_path(bundle) if bundle else None
    if not path:
        log("%s: lobby bundle %s is not downloaded, open this hero in the game first" % (code, bundle))
        return None
    log("== %s lobby <- %s" % (code, bundle))
    b = glb.Bundle(os.path.join(glb.AA, bundle))
    name, group = pick_lobby_group(glb, b, code)
    if group is None:
        log("  no lobby model")
        return None
    root, root_key, smr_list = group
    skel = glb.Skeleton(b, root, root_key)
    log("  root %s: %d nodes, %d skinned meshes" % (name, len(skel.nodes), len(smr_list)))
    clips, seen = [], set()
    for o in b.by_type("AnimationClip"):
        c = b.read(o)
        if c is None or c.m_Name in seen:
            continue
        seen.add(c.m_Name)
        clips.append(c)
    clips.sort(key=lambda c: c.m_Name)
    out_path = os.path.join(glb.OUT, code.lower() + "_lob.glb")
    ex = Exporter(b, out_path, code + "_LOB")
    ex.write_glb()
    info = ex.run(smr_list, skel, clips)
    info["root"] = name
    info["size"] = optimize_glb.optimize(out_path)
    optimize_glb.optimize(out_path, out_path[:-4] + "_m.glb", max_tex=1024, ext_max=optimize_glb.MOBILE_TEX_MAX)
    log("  wrote %s %d KB, %d clips" % (out_path, info["size"] // 1024, len(info["clips"])))
    return info


def main(argv):
    codes = [a.upper() for a in argv] or DEFAULT_CODES
    glb = eh.load_glb_exporter()
    glb.MAX_TEX = LOBBY_TEX
    cube = lobby_cube(glb.OUT, {})
    log("lobby reflection cube:", cube)
    Exporter = make_exporter(glb, cube)
    names = json.load(open(os.path.join(HERE, "hero_names.json"), encoding="utf8"))
    infos = []
    for code in codes:
        info = export_code(glb, Exporter, code)
        if info is not None:
            info["name"] = names.get(code, code) + " (lobby)"
            infos.append(info)
    eh.update_glb_index(infos)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
