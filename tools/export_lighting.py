import os
import sys
import json
import math
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "locations", "lighting.json"))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = [path]
    spec.loader.exec_module(mod)
    sys.argv = saved
    return mod


def srgb_to_linear(c):
    c = float(c)
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(col):
    return [round(srgb_to_linear(col["r"]), 4), round(srgb_to_linear(col["g"]), 4), round(srgb_to_linear(col["b"]), 4)]


def rotate(q, v):
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    vx, vy, vz = v
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def main():
    ev = load("export_vfx", os.path.join(HERE, "export_vfx.py"))
    es = load("export_spires", os.path.join(HERE, "export_spires.py"))
    scenes = es.discover_scenes()
    world = ev.World()
    out = {}
    for element, path in scenes.items():
        world.load(path)
        env = world.envs[-1]
        for name, sf in ev.ga.serialized_files(env):
            for o in sf.objects.values():
                if o.type.name != "MonoBehaviour":
                    continue
                t = world.tt(o)
                if not t or "charactersLightingConfig" not in t:
                    continue
                _, cl = world.ref(o.assets_file, t["charactersLightingConfig"])
                if not cl:
                    continue
                fx, fy, fz = rotate(cl["lightRotation"], (0.0, 0.0, 1.0))
                to_light = [-fx, -fy, fz]
                n = math.sqrt(sum(c * c for c in to_light)) or 1
                env_set = t.get("EnvironmentSettings", {})
                out[element] = {
                    "config": cl.get("m_Name"),
                    "lightDir": [round(c / n, 4) for c in to_light],
                    "lightColor": lin(cl["lightColor"]),
                    "ambient": lin(cl["ambientColor"]),
                    "shadowColor": lin(cl["ProjectionShadowColor"]),
                    "fogColor": lin(env_set["FogColor"]) if "FogColor" in env_set else None,
                }
                print(element, out[element], file=sys.stderr)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(out, f, indent=1)
    print("wrote", OUT, file=sys.stderr)


if __name__ == "__main__":
    main()
