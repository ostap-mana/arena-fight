import os, sys, json, base64, re, collections
import numpy as np
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"
AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)

S = np.diag([1.0, 1.0, -1.0, 1.0])


def b64f(a):
    return base64.b64encode(np.asarray(a, dtype=np.float32).tobytes()).decode()


def b64u(a, dt):
    return base64.b64encode(np.asarray(a, dtype=dt).tobytes()).decode()


def vec3(v):
    return [v.x, v.y, v.z]


def quat(q):
    return [-q.x, -q.y, q.z, q.w]


def mat_from_unity(m):
    a = np.array([
        [m.e00, m.e01, m.e02, m.e03],
        [m.e10, m.e11, m.e12, m.e13],
        [m.e20, m.e21, m.e22, m.e23],
        [m.e30, m.e31, m.e32, m.e33],
    ], dtype=np.float64)
    return S @ a @ S


class Bundle:
    def __init__(self, path):
        self.env = UnityPy.load(path)
        self.objs = {}
        for o in self.env.objects:
            self.objs[(o.assets_file, o.path_id)] = o
        self.cache = {}

    def deref(self, pptr):
        if pptr is None:
            return None
        pid = getattr(pptr, "m_PathID", None) or getattr(pptr, "path_id", None)
        if not pid:
            return None
        key = (pptr.assets_file, pid) if hasattr(pptr, "assets_file") else None
        if key in self.objs:
            o = self.objs[key]
        else:
            o = None
            for (af, p), ob in self.objs.items():
                if p == pid:
                    o = ob
                    break
        if o is None:
            return None
        if o.path_id not in self.cache:
            try:
                self.cache[o.path_id] = o.read()
            except Exception:
                self.cache[o.path_id] = None
        return self.cache[o.path_id]


def tr_name(b, tr):
    go = b.deref(tr.m_GameObject)
    return go.m_Name if go else "?"


def walk_root(b, tr):
    seen = 0
    while True:
        f = b.deref(tr.m_Father)
        if f is None or seen > 200:
            return tr
        tr = f
        seen += 1


def collect_skeleton(b, root):
    bones = []
    index = {}

    def rec(tr, parent):
        nm = tr_name(b, tr)
        i = len(bones)
        key = id(tr)
        index[key] = i
        bones.append({
            "name": nm,
            "parent": parent,
            "p": [tr.m_LocalPosition.x, tr.m_LocalPosition.y, -tr.m_LocalPosition.z],
            "q": quat(tr.m_LocalRotation),
            "s": [tr.m_LocalScale.x, tr.m_LocalScale.y, tr.m_LocalScale.z],
        })
        for c in tr.m_Children:
            ct = b.deref(c)
            if ct is not None:
                rec(ct, i)
    rec(root, -1)
    return bones, index


def tex_of(b, mat, keys):
    try:
        env = mat.m_SavedProperties.m_TexEnvs
    except Exception:
        return None
    items = env.items() if hasattr(env, "items") else env
    for k, v in items:
        if k in keys:
            t = b.deref(v.m_Texture)
            if t is not None:
                return t
    return None


def save_tex(t, outdir, seen):
    if t is None:
        return None
    nm = re.sub(r"[^A-Za-z0-9_]+", "_", t.m_Name)
    fn = nm + ".png"
    p = os.path.join(outdir, fn)
    if fn not in seen:
        try:
            img = t.image
            if max(img.size) > 1024:
                img = img.resize((min(1024, img.width), min(1024, img.height)))
            img.save(p)
            seen.add(fn)
        except Exception as e:
            print("  texerr", t.m_Name, e, file=sys.stderr)
            return None
    return fn


def export(bundle_file, char_id, outname, want="ING"):
    b = Bundle(os.path.join(AA, bundle_file))
    groups = collections.defaultdict(list)
    for o in b.env.objects:
        if o.type.name != "SkinnedMeshRenderer":
            continue
        smr = o.read()
        go = b.deref(smr.m_GameObject)
        if go is None:
            continue
        tr = None
        for c in go.m_Components:
            cd = b.deref(c)
            if cd is not None and hasattr(cd, "m_Father"):
                tr = cd
                break
        if tr is None:
            continue
        root = walk_root(b, tr)
        groups[id(root)].append((smr, root))

    best = None
    for gid, lst in groups.items():
        root = lst[0][1]
        score = 0
        names = []
        texnames = []
        for smr, _ in lst:
            try:
                m = b.deref(smr.m_Mesh)
                if m is None:
                    continue
                names.append(m.m_Name)
            except Exception:
                pass
            for mm in smr.m_Materials:
                mat = b.deref(mm)
                if mat is None:
                    continue
                t = tex_of(b, mat, ("_BaseMap", "_MainTex", "_BaseColorMap", "_AlbedoMap"))
                if t is not None:
                    texnames.append(t.m_Name)
        pref = sum(1 for t in texnames if f"_{want}_" in t)
        score = pref * 100 + len(lst)
        cand = {"score": score, "list": lst, "root": root, "names": names, "tex": texnames}
        if best is None or score > best["score"]:
            best = cand

    if best is None:
        print("no group", bundle_file, file=sys.stderr)
        return None

    root = best["root"]
    bones, index = collect_skeleton(b, root)
    print(f"{outname}: {len(best['list'])} meshes, {len(bones)} bones, root={tr_name(b, root)}", file=sys.stderr)

    texdir = os.path.join(OUT, "tex")
    os.makedirs(texdir, exist_ok=True)
    seen = set(os.listdir(texdir))

    meshes = []
    for smr, _ in best["list"]:
      try:
        mesh = b.deref(smr.m_Mesh)
        if mesh is None:
            continue
        try:
            h = MeshHandler(mesh)
            h.process()
        except Exception as e:
            print("  meshfail", mesh.m_Name, e, file=sys.stderr)
            continue
        if not h.m_Vertices:
            continue
        V = np.array(h.m_Vertices, dtype=np.float32).reshape(-1, 3)
        V[:, 2] *= -1
        N = np.array(h.m_Normals, dtype=np.float32).reshape(-1, len(h.m_Normals[0])) if h.m_Normals else None
        if N is not None:
            N = N[:, :3].copy()
            N[:, 2] *= -1
        UV = np.array(h.m_UV0, dtype=np.float32).reshape(-1, 2) if h.m_UV0 else np.zeros((len(V), 2), np.float32)
        IDX = np.array(h.m_IndexBuffer, dtype=np.uint32)
        tri = IDX.reshape(-1, 3)[:, ::-1].reshape(-1)

        nv = len(V)
        bi = np.zeros((nv, 4), np.uint16)
        bw = np.zeros((nv, 4), np.float32)
        rawi = np.asarray(h.m_BoneIndices, dtype=np.int64).reshape(-1) if h.m_BoneIndices else np.zeros(0)
        raww = np.asarray(h.m_BoneWeights, dtype=np.float32).reshape(-1) if h.m_BoneWeights else np.zeros(0)
        if rawi.size >= nv * 4 and raww.size >= nv * 4:
            bi = rawi[:nv * 4].reshape(nv, 4).astype(np.uint16)
            bw = raww[:nv * 4].reshape(nv, 4)
        elif rawi.size >= nv and raww.size >= nv:
            bi[:, 0] = rawi[:nv].astype(np.uint16)
            bw[:, 0] = 1.0
        else:
            bw[:, 0] = 1.0
        s = bw.sum(axis=1, keepdims=True)
        s[s == 0] = 1.0
        bw = bw / s

        bnames = []
        for pb in smr.m_Bones:
            t = b.deref(pb)
            bnames.append(tr_name(b, t) if t is not None else "")
        binv = [list(mat_from_unity(m).T.reshape(-1)) for m in mesh.m_BindPose]

        matinfo = {}
        if smr.m_Materials:
            mat = b.deref(smr.m_Materials[0])
            if mat is not None:
                matinfo["map"] = save_tex(tex_of(b, mat, ("_BaseMap", "_MainTex", "_BaseColorMap")), texdir, seen)
                matinfo["nm"] = save_tex(tex_of(b, mat, ("_BumpMap", "_NormalMap")), texdir, seen)
                matinfo["mse"] = save_tex(tex_of(b, mat, ("_MSEMap", "_MaskMap", "_MetallicGlossMap", "_SpecGlossMap")), texdir, seen)

        meshes.append({
            "name": mesh.m_Name,
            "mat": matinfo,
            "pos": b64f(V), "nor": b64f(N) if N is not None else None,
            "uv": b64f(UV), "idx": b64u(tri, np.uint32),
            "si": b64u(bi, np.uint16), "sw": b64f(bw),
            "bones": bnames, "bind": binv,
        })
      except Exception as e:
        print("  skipmesh", e, file=sys.stderr)

    data = {"id": char_id, "bones": bones, "meshes": meshes}
    p = os.path.join(OUT, outname + ".json")
    with open(p, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("  wrote", p, round(os.path.getsize(p) / 1024), "KB", file=sys.stderr)
    return data


if __name__ == "__main__":
    jobs = json.load(open(sys.argv[2]))
    for j in jobs:
        try:
            export(j["bundle"], j["id"], j["out"], j.get("want", "ING"))
        except Exception as e:
            import traceback
            traceback.print_exc()
