import os
import sys
import json

import game_assets as ga
from export_vfx import World, VfxExporter, OUT, TEX_DIR, log

HUD_BUNDLE = "c60b75c4b2"
FX_BUNDLE = "8abb189e3a"
GLB_OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "glb"))
CONFIG_NAME = "LevelLootVisualizationConfig"
RARITIES = {1: "common", 2: "uncommon", 3: "rare", 4: "epic", 5: "legendary"}
RELIC_SLOTS = {1: "weapon", 2: "shield", 3: "helmet", 4: "pauldrons", 5: "gauntlets", 6: "chestplate", 7: "belt", 8: "boots"}
PICKUP_RESOURCE = 2


def find_config(world, path):
    world.load(path)
    env = world.env_by_path[path]
    for name, sf in ga.serialized_files(env):
        for o in sf.objects.values():
            if o.type.name != "MonoBehaviour":
                continue
            try:
                if o.peek_name() == CONFIG_NAME:
                    return sf, world.tt(o)
            except Exception:
                continue
    return None, None


class LootExporter(VfxExporter):
    def root_of(self, sf, pptr):
        o, t = self.w.ref(sf, pptr)
        if t is None:
            return None
        if o.type.name == "MonoBehaviour":
            o, t = self.w.ref(o.assets_file, t["m_GameObject"])
        if t is None or o.type.name != "GameObject":
            return None
        for c in t["m_Component"]:
            co, ct = self.w.ref(o.assets_file, c["component"])
            if co is not None and co.type.name == "Transform":
                return t["m_Name"], co, ct
        return None

    def prefab(self, sf, pptr):
        found = self.root_of(sf, pptr)
        if not found:
            return None
        name, tr_o, tr = found
        if name not in self.prefabs:
            self.prefabs[name] = self.export_prefab(tr_o.assets_file, tr_o, tr)
        return name

    def export(self, sf, cfg):
        rarity = {}
        for r in cfg["RarityVisualizations"]:
            rarity[RARITIES.get(r["Rarity"], str(r["Rarity"]))] = {
                "highlight": self.prefab(sf, r["Highlight"]),
                "trail": self.prefab(sf, r["Trail"]),
            }
        relics = {RELIC_SLOTS.get(r["RelicSlot"], str(r["RelicSlot"])): self.prefab(sf, r["Object"]) for r in cfg["RelicVisualizations"]}
        hit = next((self.prefab(sf, r["OnHeroPickFx"]) for r in cfg["ResourceVisualizations"] if PICKUP_RESOURCE in r["ResourceTypes"]), None)
        log(f"  {len(self.prefabs)} prefabs, {len(self.materials)} materials, {len(self.textures)} textures, {len(self.meshes)} meshes")
        return {
            "id": "loot",
            "skills": {},
            "sockets": {},
            "prefabs": self.prefabs,
            "materials": self.materials,
            "textures": self.textures,
            "meshes": self.meshes,
            "loot": {"rarity": rarity, "relics": relics, "hit": hit},
        }


def mesh_prefabs(data):
    return [name for name in data["loot"]["relics"].values() if name]


def referenced(table, text):
    return {k: v for k, v in table.items() if json.dumps(k) in text}


def strip_mesh_prefabs(data, names):
    for name in names:
        data["prefabs"].pop(name, None)
    prefab_text = json.dumps(data["prefabs"])
    data["meshes"] = referenced(data["meshes"], prefab_text)
    data["materials"] = referenced(data["materials"], prefab_text)
    data["textures"] = referenced(data["textures"], json.dumps(data["materials"]))


def remove_new_orphans(before, data):
    used = {t["f"].split("/")[-1] for t in data["textures"].values()}
    for f in set(os.listdir(TEX_DIR)) - before - used:
        os.remove(os.path.join(TEX_DIR, f))


def find_game_objects(bundle, names):
    wanted = set(names)
    found = {}
    for o in bundle.by_type("GameObject"):
        go = bundle.read(o)
        if go is not None and go.m_Name in wanted and go.m_Name not in found:
            found[go.m_Name] = go
    return found


def export_glb(names, fx_bundle):
    from types import SimpleNamespace
    import export_glb as eg
    import optimize_glb
    out_path = os.path.join(GLB_OUT, "loot.glb")
    b = eg.Bundle(fx_bundle)
    ex = eg.Exporter(b, out_path, "loot")
    found = find_game_objects(b, names)
    scene_nodes = []
    for name in names:
        go = found.get(name)
        if go is None:
            log(f"  {name}: game object not found")
            continue
        mf = mr = None
        for c in go.m_Components:
            cd = b.deref(c)
            if cd is None:
                continue
            if hasattr(cd, "m_Mesh") and not hasattr(cd, "m_Materials"):
                mf = cd
            elif hasattr(cd, "m_Materials") and not hasattr(cd, "m_Bones"):
                mr = cd
        if mf is None or mr is None:
            log(f"  {name}: no mesh renderer")
            continue
        res = ex.add_mesh(SimpleNamespace(m_Mesh=mf.m_Mesh, m_Materials=mr.m_Materials, m_Bones=[]), None)
        if res is None:
            continue
        ex.nodes.append({"name": name, "mesh": res[0]})
        scene_nodes.append(len(ex.nodes) - 1)
    gltf = {
        "asset": {"version": "2.0", "generator": "invokers export_loot.py"},
        "scene": 0,
        "scenes": [{"nodes": scene_nodes}],
        "nodes": ex.nodes,
        "meshes": ex.meshes,
        "materials": ex.materials,
        "textures": ex.textures,
        "images": ex.images,
        "samplers": ex.samplers,
    }
    ex.glb.write(out_path, gltf)
    size = optimize_glb.optimize(out_path)
    log(f"  wrote {out_path} {size // 1024} KB, {len(scene_nodes)} models")


def main():
    os.makedirs(TEX_DIR, exist_ok=True)
    world = World()
    hud = ga.bundle_path(HUD_BUNDLE)
    sf, cfg = find_config(world, hud)
    if cfg is None:
        log(f"{CONFIG_NAME} not found in {hud}")
        return 2
    before = set(os.listdir(TEX_DIR))
    data = LootExporter(world, hud, "LOOT").export(sf, cfg)
    names = mesh_prefabs(data)
    strip_mesh_prefabs(data, names)
    remove_new_orphans(before, data)
    dest = os.path.join(OUT, "loot.json")
    with open(dest, "w", encoding="utf8") as f:
        json.dump(data, f, separators=(",", ":"))
    log(f"  wrote {dest} {os.path.getsize(dest) // 1024} KB")
    export_glb(names, ga.bundle_path(FX_BUNDLE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
