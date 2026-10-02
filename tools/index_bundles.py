import os, sys, json, traceback
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
out = []
files = sorted(os.listdir(AA))
for i, f in enumerate(files):
    p = os.path.join(AA, f)
    try:
        env = UnityPy.load(p)
        for obj in env.objects:
            t = obj.type.name
            if t not in ("Texture2D","Mesh","Sprite","GameObject","AnimationClip","AudioClip","Material"):
                continue
            try:
                d = obj.read()
                name = getattr(d, "m_Name", None) or getattr(d, "name", "")
            except Exception:
                name = "?"
            rec = {"bundle": f, "type": t, "name": name}
            if t == "Texture2D":
                try:
                    rec["w"] = d.m_Width; rec["h"] = d.m_Height
                except Exception: pass
            out.append(rec)
    except Exception as e:
        print("ERR", f, e, file=sys.stderr)
    print(f"{i+1}/{len(files)} {f} -> {len(out)}", file=sys.stderr)

with open(os.path.join(os.path.dirname(__file__), "index.json"), "w", encoding="utf8") as fh:
    json.dump(out, fh, ensure_ascii=False)
print("TOTAL", len(out))
