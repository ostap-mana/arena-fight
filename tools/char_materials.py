import os
import numpy as np
from PIL import Image
import texture2ddecoder

MAX_MASK = 512
FACES = ("px", "nx", "py", "ny", "pz", "nz")
COLOR_KEYS = ("_EmissiveColor", "_HitRimColor", "_RimColor", "_NoiseColor")
VECTOR_KEYS = ("_vfxEmissionParams", "_NoiseParams")
FLOAT_KEYS = {"_Reflectivity": 1.0, "_Smoothness": 1.0, "_CharacterInGameVfxRimAndNoise": 0.0, "_HitRimPower": 1.0, "_Cutoff": 0.5, "_AlphaTest": 0.0}


def srgb_to_linear(c):
    c = float(c)
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def is_character(mat, tex_keys):
    keys = tex_keys(mat)
    return "_MSE_SkinMask" in keys and "_BaseMap" in keys


def save_image(img, path, max_side, lossless=False):
    if max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if lossless:
        img.save(path, "WEBP", lossless=True, method=6)
    else:
        img.save(path, "WEBP", quality=92, method=6)


def export_mask(tex, out_dir, max_side, cache):
    name = tex.m_Name.replace(" ", "_")
    rel = "tex/%s.webp" % name
    if name not in cache:
        path = os.path.join(out_dir, rel)
        if not os.path.exists(path):
            save_image(tex.image.convert("RGB"), path, max_side)
        cache[name] = {"file": rel, "srgb": 1 if getattr(tex, "m_ColorSpace", 1) == 1 else 0}
    return cache[name]


def cube_faces(tex):
    size = tex.m_Width
    data = bytes(tex.image_data)
    fmt = int(tex.m_TextureFormat)
    mips = max(1, int(getattr(tex, "m_MipCount", 1)))
    block = 8 if fmt in (10, 45, 47) else 16
    per_face = 0
    w = size
    for _ in range(mips):
        per_face += max(1, (w + 3) // 4) ** 2 * block
        w = max(1, w // 2)
    faces = []
    for i in range(6):
        chunk = data[i * per_face:i * per_face + max(1, (size + 3) // 4) ** 2 * block]
        if fmt == 10:
            raw = texture2ddecoder.decode_bc1(chunk, size, size)
        elif fmt == 12:
            raw = texture2ddecoder.decode_bc3(chunk, size, size)
        else:
            raw = texture2ddecoder.decode_bc7(chunk, size, size)
        img = Image.frombytes("RGBA", (size, size), raw, "raw", "BGRA").convert("RGB")
        faces.append(img)
    return faces


def export_cube(tex, out_dir, cache):
    name = tex.m_Name.replace(" ", "_")
    if name not in cache:
        files = []
        faces = cube_faces(tex)
        for face, img in zip(FACES, faces):
            rel = "tex/%s_%s.webp" % (name, face)
            path = os.path.join(out_dir, rel)
            if not os.path.exists(path):
                save_image(img, path, 256, lossless=True)
            files.append(rel)
        cache[name] = {"faces": files, "srgb": 1 if getattr(tex, "m_ColorSpace", 1) == 1 else 0}
    return cache[name]


def extras(b, mat, out_dir, helpers, cache):
    tex_prop, tex_keys, color_prop, float_prop = helpers
    if not is_character(mat, tex_keys):
        return None
    out = {"shader": "SH_CharacterInGame"}
    for key in COLOR_KEYS:
        c = color_prop(mat, key)
        if c is not None:
            out[key.strip("_")] = [round(srgb_to_linear(c[0]), 4), round(srgb_to_linear(c[1]), 4), round(srgb_to_linear(c[2]), 4), round(c[3], 4)]
    for key in VECTOR_KEYS:
        c = color_prop(mat, key)
        if c is not None:
            out[key.strip("_")] = [round(x, 4) for x in c]
    for key, default in FLOAT_KEYS.items():
        out[key.strip("_")] = round(float_prop(mat, key, default), 4)
    for key, max_side in (("_MSE_SkinMask", MAX_MASK), ("_VFX_Mask", MAX_MASK), ("_NoiseTex", 256)):
        t = tex_prop(b, mat, (key,))
        if t is not None:
            try:
                out[key.strip("_")] = export_mask(t, out_dir, max_side, cache)
            except Exception as e:
                out[key.strip("_") + "_error"] = str(e)
    cube = tex_prop(b, mat, ("_ReflectionCube",))
    if cube is not None:
        try:
            out["ReflectionCube"] = export_cube(cube, out_dir, cache)
        except Exception as e:
            out["ReflectionCube_error"] = str(e)
    return out
