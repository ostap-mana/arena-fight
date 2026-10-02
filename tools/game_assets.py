import os
import re
import json
import glob
import struct
import warnings

warnings.filterwarnings("ignore")

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa")
AA = os.path.join(GAME, "StandaloneWindows64")
CATALOG = os.path.join(GAME, "catalog.bin")
CACHE = os.path.expandvars(r"%USERPROFILE%\AppData\LocalLow\Unity\Hit_Zone_Invokers")
CAB_MAP_PATH = os.path.join(HERE, "cab_map_all.json")
FACTIONS = {
    "BST": "Beastbloods", "CAM": "Cambion", "DEM": "Demons", "ELD": "Eldrin", "FRB": "Freeborn",
    "IRN": "Ironbands", "LTS": "Lightseekers", "MAG": "Magi", "NOC": "Nocturna", "OGR": "Ogre",
    "STN": "Stonehearts", "UNI": "Neutral",
}


def cached_bundle_paths():
    found = {}
    for data in glob.glob(os.path.join(CACHE, "*", "*", "__data")):
        found[os.path.basename(os.path.dirname(data)) + ".bundle"] = data
    return found


def local_bundle_paths():
    if not os.path.isdir(AA):
        return {}
    return {f: os.path.join(AA, f) for f in os.listdir(AA) if f.endswith(".bundle")}


def all_bundle_paths():
    paths = cached_bundle_paths()
    paths.update(local_bundle_paths())
    return paths


def bundle_path(name):
    if not name.endswith(".bundle"):
        matches = [p for n, p in all_bundle_paths().items() if n.startswith(name)]
        return matches[0] if matches else None
    return all_bundle_paths().get(name)


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
    known = {}
    if os.path.exists(CAB_MAP_PATH):
        known = json.load(open(CAB_MAP_PATH, encoding="utf8"))
    indexed = set(known.values())
    changed = False
    for path in all_bundle_paths().values():
        if path in indexed:
            continue
        try:
            env = UnityPy.load(path)
        except Exception:
            continue
        for name, _ in serialized_files(env):
            known[name.lower()] = path
        indexed.add(path)
        changed = True
    if changed:
        with open(CAB_MAP_PATH, "w", encoding="utf8") as fh:
            json.dump(known, fh, indent=0)
    return known


class Catalog:
    UNICODE = 0x80000000
    DYNAMIC = 0x40000000

    def __init__(self, path=CATALOG):
        self.buf = open(path, "rb").read()
        self.locations = {}
        self.entries = self.read_all()

    def u32(self, o):
        return struct.unpack_from("<I", self.buf, o)[0]

    def offsets(self, o):
        if o == 0xFFFFFFFF:
            return []
        n = self.u32(o - 4) // 4
        return list(struct.unpack_from("<%dI" % n, self.buf, o))

    def string(self, i, sep="/"):
        if i == 0xFFFFFFFF:
            return None
        off = i & ~(self.UNICODE | self.DYNAMIC) & 0xFFFFFFFF
        if i & self.DYNAMIC:
            parts = []
            while True:
                sid, nxt = struct.unpack_from("<2I", self.buf, off)
                parts.append(self.string(sid, sep) or "")
                if nxt == 0xFFFFFFFF:
                    break
                off = nxt & ~(self.UNICODE | self.DYNAMIC) & 0xFFFFFFFF
            return sep.join(reversed(parts))
        raw = self.buf[off:off + self.u32(off - 4)]
        return raw.decode("utf-16-le" if i & self.UNICODE else "utf-8", "replace")

    def location(self, o):
        if o not in self.locations:
            pk, iid, prov, deps, _, _, _ = struct.unpack_from("<7I", self.buf, o)
            self.locations[o] = {
                "key": self.string(pk),
                "id": self.string(iid),
                "provider": self.string(prov, "."),
                "deps": self.offsets(deps),
            }
        return self.locations[o]

    def key(self, o):
        type_off, obj = struct.unpack_from("<2I", self.buf, o)
        cls = self.string(self.u32(type_off + 4), ".") or ""
        return self.string(self.u32(obj)) if "String" in cls else None

    def read_all(self):
        keys = self.offsets(self.u32(8))
        out = {}
        for i in range(0, len(keys), 2):
            k = self.key(keys[i])
            if k is None:
                continue
            locs = []
            for lo in self.offsets(keys[i + 1]):
                loc = self.location(lo)
                locs.append({
                    "id": loc["id"],
                    "provider": loc["provider"],
                    "bundles": [self.location(d)["key"] for d in loc["deps"]],
                })
            out[k] = locs
        return out

    def find(self, pattern):
        rx = re.compile(pattern)
        return {k: v for k, v in self.entries.items() if rx.search(k)}

    def hero_bundle(self, code):
        for key, locs in self.find(r"_%s_battle_prefab_ref\.asset$" % code).items():
            for loc in locs:
                if loc["bundles"]:
                    return loc["bundles"][0]
        return None

    def lobby_bundle(self, code):
        for key, locs in self.find(r"_%s_lobby_prefab_ref\.asset$" % code).items():
            for loc in locs:
                if loc["bundles"]:
                    return loc["bundles"][0]
        return self.hero_bundle(code)


def hero_bundles(codes):
    cat = Catalog()
    out = {}
    for code in codes:
        name = cat.hero_bundle(code)
        out[code] = {"bundle": name, "path": bundle_path(name) if name else None}
    return out


if __name__ == "__main__":
    import sys
    for code, info in hero_bundles([c.upper() for c in sys.argv[1:]]).items():
        print(code, info["bundle"], info["path"] or "NOT DOWNLOADED")
