import os
import sys
import json

import game_assets as ga
from export_vfx import World, VfxExporter, OUT, TEX_DIR, log

FX_BUNDLE = "8abb189e3a"
PREFABS = sys.argv[1:] or ["FX_Move_Click_1_1"]


class MoveFxExporter(VfxExporter):
    def export_named(self, names):
        wanted = set(names)
        for o in self.objects("Transform"):
            t = self.w.tt(o)
            if t is None or t["m_Father"].get("m_PathID"):
                continue
            go_o, go = self.w.ref(o.assets_file, t["m_GameObject"])
            if go is None or go["m_Name"] not in wanted or go["m_Name"] in self.prefabs:
                continue
            self.prefabs[go["m_Name"]] = self.export_prefab(o.assets_file, o, t)
        missing = wanted - set(self.prefabs)
        if missing:
            log(f"  not found: {sorted(missing)}")
        log(f"  {len(self.prefabs)} prefabs, {len(self.materials)} materials, {len(self.textures)} textures, {len(self.meshes)} meshes")
        return {
            "id": "move",
            "skills": {},
            "sockets": {},
            "prefabs": self.prefabs,
            "materials": self.materials,
            "textures": self.textures,
            "meshes": self.meshes,
        }


def main():
    os.makedirs(TEX_DIR, exist_ok=True)
    world = World()
    data = MoveFxExporter(world, ga.bundle_path(FX_BUNDLE), "MOVE").export_named(PREFABS)
    if not data["prefabs"]:
        return 2
    dest = os.path.join(OUT, "move.json")
    with open(dest, "w", encoding="utf8") as f:
        json.dump(data, f, separators=(",", ":"))
    log(f"  wrote {dest} {os.path.getsize(dest) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
