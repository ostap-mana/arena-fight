import os
import sys
import json
import importlib.util
import UnityPy
from PIL import Image

import game_assets as ga

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
GLB_OUT = os.path.join(ROOT, "public", "assets", "glb")
HUD_OUT = os.path.join(ROOT, "src", "assets", "GENERAL", "HUD")
ICON_BUNDLE = "ebb5e34e40"
DEFAULT_HEROES = ["ELD037", "MAG018", "ELD025"]
WEAPON_ICONS = {
    "spear": "S_HUD_AttackButton_Spear",
    "arcana": "S_HUD_AttackButton_Arcana",
    "sword": "S_HUD_AttackButton_Sword",
    "blunt": "S_HUD_AttackButton_Blunt",
    "daggers": "S_HUD_AttackButton_Daggers",
    "bow": "S_HUD_AttackButton_Bow",
    "whip": "S_HUD_AttackButton_Whip",
    "fist": "S_HUD_AttackButton_Mele_Hand",
}
SKILL_SPRITES = {"1": "Skill_1", "2": "Skill_2", "3": "Skill_3", "ult": "Skill_Ultimate", "large": "Large"}
MAX_ICON = 256


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def save_webp(img, path, max_side=MAX_ICON):
    img = img.convert("RGBA")
    if max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, format="WEBP", lossless=True, exact=True, method=6)
    return img.size


def sprites_in(paths, wanted):
    found = {}
    for path in paths:
        env = UnityPy.load(path)
        for o in env.objects:
            if o.type.name not in ("Sprite", "Texture2D"):
                continue
            try:
                name = o.peek_name()
            except Exception:
                name = None
            if name is None:
                try:
                    name = o.read().m_Name
                except Exception:
                    continue
            if name in wanted and (name not in found or o.type.name == "Sprite"):
                found[name] = o
    return found


def bundles_with_icons(codes):
    cat = ga.Catalog()
    names = set()
    for code in codes:
        for key, locs in cat.find(r"/%s/S_%s_(Large|Skill_.*)\.png$|S_%s_(Skill_\w+|Large)\.png$" % (code, code, code)).items():
            for loc in locs:
                if loc["bundles"]:
                    names.add(loc["bundles"][0])
    paths = [ga.bundle_path(n) for n in names]
    local_skill = ga.bundle_path("b0143d5491")
    if local_skill:
        paths.append(local_skill)
    return [p for p in paths if p]


def export_icons(codes, weapons):
    wanted = {}
    for code in codes:
        for suffix, sprite in SKILL_SPRITES.items():
            wanted["S_%s_%s" % (code, sprite)] = (code.lower(), suffix)
    found = sprites_in(bundles_with_icons(codes), set(wanted))
    missing = []
    for name, (model, suffix) in sorted(wanted.items()):
        o = found.get(name)
        if o is None:
            missing.append(name)
            continue
        img = o.read().image
        folder = "heroes" if suffix == "large" else "skills"
        dest = os.path.join(HUD_OUT, folder, "%s-%s.webp" % (model, suffix))
        size = save_webp(img, dest, 512 if suffix == "large" else MAX_ICON)
        log("  %s -> %s %s" % (name, os.path.relpath(dest, ROOT), size))
    icon_bundle = ga.bundle_path(ICON_BUNDLE)
    wanted_weapons = {WEAPON_ICONS[w]: w for w in weapons if w in WEAPON_ICONS}
    found = sprites_in([icon_bundle], set(wanted_weapons)) if icon_bundle else {}
    for name, key in wanted_weapons.items():
        o = found.get(name)
        if o is None:
            missing.append(name)
            continue
        dest = os.path.join(HUD_OUT, "buttons", "attack-%s.webp" % key)
        size = save_webp(o.read().image, dest)
        log("  %s -> %s %s" % (name, os.path.relpath(dest, ROOT), size))
    return missing


def load_glb_exporter():
    spec = importlib.util.spec_from_file_location("export_glb", os.path.join(HERE, "export_glb.py"))
    saved = sys.argv
    sys.argv = [spec.origin, GLB_OUT]
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.argv = saved
    paths = ga.all_bundle_paths()
    cabs = {cab: os.path.basename(p) for cab, p in ga.cab_map().items()}
    mod._cab_map = cabs

    def load_bundle_file(fname):
        if fname in mod.LOADED:
            return mod.LOADED[fname]
        env = UnityPy.load(paths[fname])
        for o in env.objects:
            mod.REGISTRY[(id(o.assets_file), o.path_id)] = o
        for name, sf in mod.serialized_files(env):
            mod.CAB_FILES[name.lower()] = sf
        mod.LOADED[fname] = env
        return env

    mod.load_bundle_file = load_bundle_file
    return mod


def update_glb_index(infos):
    index_path = os.path.join(GLB_OUT, "index.json")
    index = json.load(open(index_path, encoding="utf8")) if os.path.exists(index_path) else []
    by_id = {m["id"]: m for m in index}
    for info in infos:
        by_id[info["id"]] = info
    ordered = [by_id[m["id"]] for m in index] + [i for i in infos if i["id"] not in {m["id"] for m in index}]
    with open(index_path, "w", encoding="utf8") as f:
        json.dump(ordered, f, indent=1)


def update_jobs(found):
    jobs_path = os.path.join(HERE, "glb_jobs.json")
    jobs = json.load(open(jobs_path, encoding="utf8"))
    known = {j["id"] for j in jobs}
    for code, info in found.items():
        if code not in known:
            jobs.append({"id": code, "bundle": info["bundle"]})
    with open(jobs_path, "w", encoding="utf8") as f:
        f.write("[\n" + ",\n".join(" " + json.dumps(j) for j in jobs) + "\n]")


def main(argv):
    codes = [a.upper() for a in argv if not a.startswith("--")] or DEFAULT_HEROES
    weapons = ["spear", "arcana", "sword"]
    names = json.load(open(os.path.join(HERE, "hero_names.json"), encoding="utf8"))
    log("== icons")
    missing_icons = export_icons(codes, weapons)
    if missing_icons:
        log("  missing icons:", ", ".join(missing_icons))
    bundles = ga.hero_bundles(codes)
    ready = {c: b for c, b in bundles.items() if b["path"]}
    waiting = [c for c, b in bundles.items() if not b["path"]]
    for c in waiting:
        log("%s (%s): bundle %s is not downloaded yet, open this hero in the game on this PC" % (c, names.get(c, c), bundles[c]["bundle"]))
    if ready:
        log("== models")
        glb = load_glb_exporter()
        infos = []
        for code, b in ready.items():
            info = glb.export({"id": code, "bundle": b["bundle"]})
            if info is not None:
                info["name"] = names.get(code, code)
                infos.append(info)
        update_glb_index(infos)
        update_jobs(ready)
        log("== vfx")
        spec = importlib.util.spec_from_file_location("export_vfx", os.path.join(HERE, "export_vfx.py"))
        vfx = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vfx)
        os.makedirs(vfx.TEX_DIR, exist_ok=True)
        world = vfx.World()
        for code, b in ready.items():
            vfx.export_code(world, code, b["path"])
    return 0 if not waiting else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
