import os, sys, re, importlib.util
import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.expandvars(r"%USERPROFILE%\AppData\LocalLow\Unity\Hit_Zone_Invokers")
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "models"))
ID_RE = re.compile(r"(?:BST|CAM|ELD|FRB|IRN|LTS|MAG|NOC|STN|DEM|OGR|UNI)\d{3}")


def load_exporter(out_dir):
    spec = importlib.util.spec_from_file_location("export_char", os.path.join(HERE, "export_char.py"))
    saved = sys.argv
    sys.argv = [spec.origin, out_dir]
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.argv = saved
    mod.AA = ""
    return mod


def cached_bundles():
    if not os.path.isdir(CACHE):
        return
    for name in sorted(os.listdir(CACHE)):
        folder = os.path.join(CACHE, name)
        if not os.path.isdir(folder):
            continue
        for ver in os.listdir(folder):
            data = os.path.join(folder, ver, "__data")
            if os.path.isfile(data):
                yield name, data


def inspect(path, wanted):
    env = UnityPy.load(path)
    skinned = 0
    found = {}
    for o in env.objects:
        t = o.type.name
        if t == "SkinnedMeshRenderer":
            skinned += 1
            continue
        if t not in ("Texture2D", "GameObject"):
            continue
        try:
            n = o.read().m_Name
        except Exception:
            continue
        for cid in ID_RE.findall(n):
            if cid in wanted:
                weight = 3 if t == "Texture2D" and "_ING_" in n else 1
                found[cid] = found.get(cid, 0) + weight
    return skinned, found


def parse_args(argv):
    out = DEFAULT_OUT
    ids = []
    it = iter(argv)
    for a in it:
        if a == "--out":
            out = next(it)
        else:
            ids.append(a.upper())
    return ids or ["MAG018", "ELD025", "STN007"], out


def main(argv):
    ids, out_dir = parse_args(argv)
    wanted = set(ids)
    best = {}
    for name, path in cached_bundles():
        try:
            skinned, found = inspect(path, wanted)
        except Exception as e:
            print("skip", name, e, file=sys.stderr)
            continue
        if not skinned:
            continue
        for cid, score in found.items():
            if cid not in best or score > best[cid][0]:
                best[cid] = (score, name, path)
    missing = sorted(wanted - set(best))
    if missing:
        print("not in the game cache yet, open these heroes in the game first:", ", ".join(missing), file=sys.stderr)
    if not best:
        return 1
    exporter = load_exporter(out_dir)
    for cid, (score, name, path) in sorted(best.items()):
        print(f"{cid}: bundle {name} (score {score})", file=sys.stderr)
        data = exporter.export(path, cid, cid.lower())
        if data:
            print(f"   -> {os.path.join(out_dir, cid.lower() + '.json')} meshes={len(data['meshes'])} bones={len(data['bones'])}", file=sys.stderr)
    return 2 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
