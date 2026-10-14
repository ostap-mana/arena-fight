import os
import sys
import json

import game_assets as ga
from export_vfx import World, VfxExporter, OUT, TEX_DIR, log

FX_BUNDLES = ["8abb189e3a", "99a2153739"]


class NamedFxExporter(VfxExporter):
    def share(self, other):
        for key in ("textures", "materials", "meshes", "prefabs", "mat_keys", "mesh_keys", "tex_keys"):
            setattr(self, key, getattr(other, key))

    def export_named(self, wanted):
        for o in self.objects("Transform"):
            t = self.w.tt(o)
            if t is None or t["m_Father"].get("m_PathID"):
                continue
            go_o, go = self.w.ref(o.assets_file, t["m_GameObject"])
            if go is None or go["m_Name"] not in wanted or go["m_Name"] in self.prefabs:
                continue
            nodes = self.export_prefab(o.assets_file, o, t)
            nodes[0].pop("off", None)
            for n in nodes:
                if n["p"] == 0 and n["n"].startswith("FX_"):
                    n.pop("off", None)
            self.prefabs[go["m_Name"]] = nodes


def main():
    if len(sys.argv) < 3:
        log("usage: export_fx_lib.py <id> <prefab> [prefab ...]")
        return 2
    lib_id, names = sys.argv[1], sys.argv[2:]
    os.makedirs(TEX_DIR, exist_ok=True)
    world = World()
    first = None
    for bundle in FX_BUNDLES:
        ex = NamedFxExporter(world, ga.bundle_path(bundle), lib_id.upper())
        if first:
            ex.share(first)
        else:
            first = ex
        ex.export_named(set(names))
    missing = sorted(set(names) - set(first.prefabs))
    if missing:
        log(f"  not found: {missing}")
    log(f"  {len(first.prefabs)} prefabs, {len(first.materials)} materials, {len(first.textures)} textures, {len(first.meshes)} meshes")
    data = {
        "id": lib_id,
        "skills": {},
        "sockets": {},
        "prefabs": first.prefabs,
        "materials": first.materials,
        "textures": first.textures,
        "meshes": first.meshes,
    }
    dest = os.path.join(OUT, f"{lib_id}.json")
    with open(dest, "w", encoding="utf8") as f:
        json.dump(data, f, separators=(",", ":"))
    log(f"  wrote {dest} {os.path.getsize(dest) // 1024} KB")
    return 0 if first.prefabs else 2


if __name__ == "__main__":
    sys.exit(main())
