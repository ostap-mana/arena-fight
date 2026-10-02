import os, sys, json, re, collections
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"
AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
out = {}
files = sorted(os.listdir(AA))
for i, f in enumerate(files):
    try:
        env = UnityPy.load(os.path.join(AA, f))
    except Exception as e:
        continue
    smr = 0
    clips = set()
    ids = set()
    for o in env.objects:
        t = o.type.name
        if t == "SkinnedMeshRenderer":
            smr += 1
        elif t == "AnimationClip":
            try: clips.add(o.read().m_Name)
            except Exception: pass
        elif t == "Texture2D":
            try: n = o.read().m_Name
            except Exception: continue
            m = re.match(r"T_(?:ING|LOB)_([A-Z]{2,4}\d{3})_", n)
            if m: ids.add(m.group(1))
    if smr:
        out[f] = {"smr": smr, "ids": sorted(ids), "nclips": len(clips),
                  "hasIdle": "Idle" in clips, "hasRun": "Run" in clips, "hasMorph": "Morph" in clips}
    print(f"{i+1}/{len(files)}", file=sys.stderr)
json.dump(out, open("chars.json", "w"), indent=1)
for k, v in out.items():
    print(k[:12], v["smr"], v["nclips"], v["ids"][:12])
