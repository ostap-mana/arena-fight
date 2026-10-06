import os
import re
import sys
import json
import wave
import shutil
import struct
import hashlib
import tempfile
import subprocess
import collections
import ctypes as C

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import warnings

warnings.filterwarnings("ignore")

import UnityPy

from game_assets import Catalog, all_bundle_paths, bundle_path

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

ROOT = os.path.normpath(os.path.join(HERE, ".."))
OUT_DIR = os.path.join(ROOT, "public", "assets", "audio", "sfx")
MANIFEST = os.path.join(ROOT, "src", "data", "sounds.json")
PLUGINS = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\Plugins\x86_64")

RATE = 48000
BLOCK = 256
WAVWRITER_NRT = 5
PLAYBACK_STOPPED = 2
STUDIO_ALLOW_MISSING_PLUGINS = 0x2
STUDIO_SYNCHRONOUS_UPDATE = 0x4
INIT_STREAM_FROM_UPDATE = 0x1
INIT_MIX_FROM_UPDATE = 0x2
MAX_SECONDS = 16.0
TAIL_SECONDS = 0.6
SILENCE = 10 ** (-66 / 20)
KEEP_AFTER = 0.04
GAP = 0.25
TARGET_PEAK = 10 ** (-1 / 20)
MAX_GAIN = 4.0
STEREO_DIFF = 0.02

HEROES = ["MAG018", "ELD037", "ELD025"]
TITANS = ["ANIMLTS004"]
ENEMIES = ["DEM013", "DEM019", "DEM025", "DEM103", "DEM127", "OGR037", "CAM021"]

GROUPS = [
    ("ui", ["UI", "VO in-game", "LootDrop"], None),
    ("lobby", [c + "_lobby" for c in HEROES + TITANS], r"_(intro|break_\d|summon_vo)$"),
    ("common", ["CharacterGameplay", "Steps", "VFX in-game"], r"^(dash|mob_spawn|freeze|step_(ground|big_anima_bosses|big_middle_bosses|wings_small)|explosion_vfx_\d+)$"),
] + [(c.lower(), [c], None) for c in HEROES + TITANS] + [("enemies", ENEMIES, None)]

VARIANTS = [
    (r"(hit_combo|take_damage|_damage|^step_)", 4),
    (r"_attack_\d$", 3),
    (r"(_death|_skill_\d|_ult_vo|_summon_vo|^dash$|^mob_spawn$|^ui_click_(add|back)$|^loot_drop_gold$|^loot_take$)", 2),
]

STEREO_GROUPS = {"ui", "lobby"}
FORMATS = ("m4a", "mp3")

LIFT_DB = [
    (r"^ui_(click_(main|tab|back|add)|button_locked|expand_(in|out))$", 10),
]

STEP_CLIPS = ("Run", "Walk")
EMITTER_TRIGGERS = {1, 11}


class Guid(C.Structure):
    _fields_ = [("Data1", C.c_uint32), ("Data2", C.c_uint16), ("Data3", C.c_uint16), ("Data4", C.c_ubyte * 8)]


def snake(name):
    name = re.sub(r"[()\[\],&]", " ", name)
    name = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def key_for(path):
    folder, name = path.rsplit("/", 1)
    lobby = re.match(r"^(intro|break_\d|summon)_([A-Z]+\d+)(_VO)?$", name)
    if lobby:
        kind, code, vo = lobby.groups()
        return "%s_%s%s" % (code.lower(), kind, "_vo" if vo else "")
    key = snake(name)
    if folder.endswith("/Steps"):
        return "step_" + key
    if folder.startswith("event:/VO/"):
        return "vo_" + key
    if folder.startswith("event:/UI/InGame"):
        return "ingame_" + key
    if folder.startswith("event:/UI/Settings"):
        return "settings_" + key
    return key


def lift_for(key):
    for pattern, db in LIFT_DB:
        if re.search(pattern, key):
            return 10 ** (db / 20)
    return 1.0


def step_times(codes):
    cat = Catalog()
    out = {}
    for code in codes:
        name = cat.hero_bundle(code)
        path = bundle_path(name) if name else None
        if not path:
            continue
        env = UnityPy.load(path)
        for obj in env.objects:
            if obj.type.name != "AnimationClip":
                continue
            clip = obj.read_typetree()
            if clip["m_Name"] not in STEP_CLIPS:
                continue
            times = sorted({round(e["time"], 4) for e in clip.get("m_Events", []) if e["functionName"] == "Step"})
            if times:
                out.setdefault(code.lower(), {})[clip["m_Name"]] = times
    return out


def unity_guid(ref):
    g = ref.get("Guid") or {}
    return struct.pack("<iiii", g.get("Data1", 0), g.get("Data2", 0), g.get("Data3", 0), g.get("Data4", 0)).hex()


def prefab_emitters(codes, guid_keys):
    cat = Catalog()
    out = {}
    for code in codes:
        name = cat.hero_bundle(code)
        path = bundle_path(name) if name else None
        if not path:
            continue
        env = UnityPy.load(path)
        parent, names, transform_of = {}, {}, {}
        for obj in env.objects:
            if obj.type.name in ("Transform", "RectTransform"):
                t = obj.read_typetree()
                transform_of[t["m_GameObject"]["m_PathID"]] = obj.path_id
                parent[obj.path_id] = t["m_Father"]["m_PathID"]
            elif obj.type.name == "GameObject":
                names[obj.path_id] = obj.read_typetree()["m_Name"]
        owner = {tr: go for go, tr in transform_of.items()}
        for obj in env.objects:
            if obj.type.name != "MonoBehaviour":
                continue
            try:
                t = obj.read_typetree()
            except Exception:
                continue
            if "EventReference" not in t or t.get("EventPlayTrigger") not in EMITTER_TRIGGERS:
                continue
            key = guid_keys.get(unity_guid(t["EventReference"]))
            if not key:
                continue
            tr = transform_of.get(t["m_GameObject"]["m_PathID"])
            root = None
            while tr:
                root = names.get(owner.get(tr))
                tr = parent.get(tr)
            if root:
                out[root] = key
    return out


def variants_for(key):
    for pattern, n in VARIANTS:
        if re.search(pattern, key):
            return n
    return 1


class Fmod:
    def __init__(self):
        os.add_dll_directory(PLUGINS)
        self.lib = C.CDLL(os.path.join(PLUGINS, "fmodstudio.dll"))
        self.version = self.find_version()

    def ck(self, result, what):
        if result != 0:
            raise RuntimeError("%s -> FMOD_RESULT %d" % (what, result))

    def find_version(self):
        s = C.c_void_p()
        for minor in range(5):
            for patch in range(100):
                v = (2 << 16) | (minor << 8) | patch
                if self.lib.FMOD_Studio_System_Create(C.byref(s), C.c_uint(v)) == 0:
                    self.lib.FMOD_Studio_System_Release(s)
                    return v
        raise RuntimeError("no matching FMOD version")

    def system(self, wav_out=None):
        f = self.lib
        s = C.c_void_p()
        self.ck(f.FMOD_Studio_System_Create(C.byref(s), C.c_uint(self.version)), "Create")
        core = C.c_void_p()
        self.ck(f.FMOD_Studio_System_GetCoreSystem(s, C.byref(core)), "GetCoreSystem")
        self.ck(f.FMOD_System_SetOutput(core, WAVWRITER_NRT if wav_out else 2), "SetOutput")
        self.ck(f.FMOD_System_SetSoftwareFormat(core, RATE, 3, 0), "SetSoftwareFormat")
        self.ck(f.FMOD_System_SetDSPBufferSize(core, BLOCK, 4), "SetDSPBufferSize")
        extra = C.c_char_p(wav_out.encode("mbcs")) if wav_out else None
        flags = INIT_STREAM_FROM_UPDATE | INIT_MIX_FROM_UPDATE if wav_out else 0
        self.ck(f.FMOD_Studio_System_Initialize(s, 256, STUDIO_ALLOW_MISSING_PLUGINS | STUDIO_SYNCHRONOUS_UPDATE, flags, extra), "Initialize")
        handle = C.c_uint()
        f.FMOD_System_LoadPlugin(core, os.path.join(PLUGINS, "resonanceaudio.dll").encode("mbcs"), C.byref(handle), 0)
        return s, core

    def load(self, s, bank_dir, names):
        f = self.lib
        banks = []
        for name in ["Master.strings", "Master"] + names:
            b = C.c_void_p()
            self.ck(f.FMOD_Studio_System_LoadBankFile(s, os.path.join(bank_dir, name + ".bank").encode("mbcs"), 0, C.byref(b)), "Load " + name)
            banks.append((name, b))
        for _, b in banks:
            f.FMOD_Studio_Bank_LoadSampleData(b)
        f.FMOD_Studio_System_FlushCommands(s)
        f.FMOD_Studio_System_FlushSampleLoading(s)
        return banks

    def describe(self, bank_dir, bank):
        f = self.lib
        s, _ = self.system()
        loaded = dict(self.load(s, bank_dir, [bank]))
        b = loaded[bank]
        count = C.c_int()
        f.FMOD_Studio_Bank_GetEventCount(b, C.byref(count))
        items = (C.c_void_p * max(1, count.value))()
        got = C.c_int()
        f.FMOD_Studio_Bank_GetEventList(b, items, count.value, C.byref(got))
        out = []
        buf = C.create_string_buffer(1024)
        for i in range(got.value):
            d = items[i]
            n = C.c_int()
            if f.FMOD_Studio_EventDescription_GetPath(d, buf, 1024, C.byref(n)) != 0:
                continue
            oneshot, is3d = C.c_int(), C.c_int()
            f.FMOD_Studio_EventDescription_IsOneshot(d, C.byref(oneshot))
            f.FMOD_Studio_EventDescription_Is3D(d, C.byref(is3d))
            lo, hi = C.c_float(), C.c_float()
            f.FMOD_Studio_EventDescription_GetMinMaxDistance(d, C.byref(lo), C.byref(hi))
            guid = Guid()
            f.FMOD_Studio_EventDescription_GetID(d, C.byref(guid))
            out.append({
                "path": buf.value.decode("utf-8", "replace"),
                "guid": bytes(guid).hex(),
                "oneshot": bool(oneshot.value),
                "3d": bool(is3d.value),
                "dist": [round(lo.value, 2), round(hi.value, 2)],
            })
        f.FMOD_Studio_System_Release(s)
        return out

    def render(self, bank_dir, bank, path, wav_out, seed):
        f = self.lib
        s, core = self.system(wav_out)
        self.seed(core, seed)
        self.load(s, bank_dir, [bank])
        d = C.c_void_p()
        self.ck(f.FMOD_Studio_System_GetEvent(s, path.encode("utf-8"), C.byref(d)), "GetEvent " + path)
        inst = C.c_void_p()
        self.ck(f.FMOD_Studio_EventDescription_CreateInstance(d, C.byref(inst)), "CreateInstance")
        self.ck(f.FMOD_Studio_EventInstance_Start(inst), "Start")
        state = C.c_int()
        t = 0.0
        stopped = None
        while t < MAX_SECONDS:
            f.FMOD_Studio_System_Update(s)
            t += BLOCK / RATE
            f.FMOD_Studio_EventInstance_GetPlaybackState(inst, C.byref(state))
            if stopped is None and state.value == PLAYBACK_STOPPED:
                stopped = t
            if stopped is not None and t - stopped >= TAIL_SECONDS:
                break
        f.FMOD_Studio_EventInstance_Release(inst)
        f.FMOD_Studio_System_Release(s)

    def seed(self, core, seed):
        class Advanced(C.Structure):
            _fields_ = [
                ("cbSize", C.c_int), ("maxMPEGCodecs", C.c_int), ("maxADPCMCodecs", C.c_int), ("maxXMACodecs", C.c_int),
                ("maxVorbisCodecs", C.c_int), ("maxAT9Codecs", C.c_int), ("maxFADPCMCodecs", C.c_int), ("maxOpusCodecs", C.c_int),
                ("ASIONumChannels", C.c_int), ("ASIOChannelList", C.c_void_p), ("ASIOSpeakerList", C.c_void_p),
                ("vol0virtualvol", C.c_float), ("defaultDecodeBufferSize", C.c_uint), ("profilePort", C.c_ushort),
                ("geometryMaxFadeTime", C.c_uint), ("distanceFilterCenterFreq", C.c_float), ("reverb3Dinstance", C.c_int),
                ("DSPBufferPoolSize", C.c_int), ("resamplerMethod", C.c_int), ("randomSeed", C.c_uint),
                ("maxConvolutionThreads", C.c_int), ("maxSpatialObjects", C.c_int),
            ]
        a = Advanced()
        a.cbSize = C.sizeof(Advanced)
        self.lib.FMOD_System_GetAdvancedSettings(core, C.byref(a))
        a.randomSeed = seed
        self.lib.FMOD_System_SetAdvancedSettings(core, C.byref(a))


def dump_banks(names, bank_dir):
    cat = Catalog()
    paths = all_bundle_paths()
    wanted = collections.defaultdict(set)
    for key, locs in cat.find(r"^Assets/SoundBanks/.*\.bytes$").items():
        name = os.path.splitext(os.path.basename(key))[0]
        if name not in names:
            continue
        for loc in locs:
            if loc["bundles"] and loc["bundles"][0] in paths:
                wanted[loc["bundles"][0]].add(name)
    found = set()
    for bundle, bank_names in sorted(wanted.items()):
        env = UnityPy.load(paths[bundle])
        for obj in env.objects:
            if obj.type.name != "TextAsset":
                continue
            data = obj.read()
            if data.m_Name not in bank_names:
                continue
            raw = data.m_Script.encode("utf-8", "surrogateescape") if isinstance(data.m_Script, str) else bytes(data.m_Script)
            with open(os.path.join(bank_dir, data.m_Name + ".bank"), "wb") as fh:
                fh.write(raw)
            found.add(data.m_Name)
    missing = sorted(set(names) - found)
    if missing:
        print("missing banks (not on disk):", ", ".join(missing))
    return found


def read_wav(path):
    with wave.open(path, "rb") as w:
        frames = w.readframes(w.getnframes())
        channels = w.getnchannels()
        width = w.getsampwidth()
    if width == 2:
        pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        pcm = np.frombuffer(frames, dtype="<f4").astype(np.float32)
    else:
        raise RuntimeError("unexpected sample width %d" % width)
    return pcm.reshape(-1, channels)


def trim(pcm):
    loud = np.nonzero(np.max(np.abs(pcm), axis=1) > SILENCE)[0]
    if not len(loud):
        return None
    end = min(len(pcm), loud[-1] + int(KEEP_AFTER * RATE))
    return pcm[:end]


def render_group(fmod, bank_dir, work, group, banks, pattern):
    sounds = collections.OrderedDict()
    for bank in banks:
        if not os.path.exists(os.path.join(bank_dir, bank + ".bank")):
            continue
        for ev in fmod.describe(bank_dir, bank):
            if not ev["path"].startswith("event:/") or not ev["oneshot"]:
                continue
            key = key_for(ev["path"])
            if pattern and not re.search(pattern, key):
                continue
            takes = []
            seen = set()
            for seed in range(1, variants_for(key) + 1):
                wav = os.path.join(work, "take.wav")
                fmod.render(bank_dir, bank, ev["path"], wav, seed * 7919)
                pcm = trim(read_wav(wav))
                os.remove(wav)
                if pcm is None:
                    continue
                digest = hashlib.md5(np.round(pcm * 4096).astype(np.int16).tobytes()).hexdigest()
                if digest in seen:
                    continue
                seen.add(digest)
                takes.append(pcm)
            if not takes:
                print("  silent", ev["path"])
                continue
            sounds[key] = {"event": ev["path"], "guid": ev["guid"], "takes": takes, "3d": ev["3d"], "dist": ev["dist"]}
            print("  %-34s %d take(s) %.2fs" % (key, len(takes), len(takes[0]) / RATE))
    return sounds


def is_stereo(pcm):
    if pcm.shape[1] < 2:
        return False
    peak = float(np.max(np.abs(pcm))) or 1.0
    return float(np.max(np.abs(pcm[:, 0] - pcm[:, 1]))) / peak > STEREO_DIFF


def build_sprite(work, group, sounds, gain):
    stereo = group in STEREO_GROUPS and any(is_stereo(t) for s in sounds.values() for t in s["takes"])
    channels = 2 if stereo else 1
    gap = np.zeros((int(GAP * RATE), channels), dtype=np.float32)
    chunks = [gap]
    cursor = len(gap)
    sprite = {}
    for key, s in sounds.items():
        for i, take in enumerate(s["takes"]):
            pcm = take if stereo else take.mean(axis=1, keepdims=True)
            pcm = np.clip(pcm * gain * lift_for(key), -1, 1)
            sprite["%s#%d" % (key, i)] = [round(cursor / RATE * 1000, 1), round(len(pcm) / RATE * 1000 + 30, 1)]
            chunks += [pcm, gap]
            cursor += len(pcm) + len(gap)
    pcm = np.concatenate(chunks)
    raw = os.path.join(work, group + ".wav")
    with wave.open(raw, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((pcm * 32767).astype("<i2").tobytes())
    outs = []
    for fmt in FORMATS:
        out = os.path.join(work, "%s.%s" % (group, fmt))
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw] + encoder_args(fmt, stereo) + [out], check=True)
        outs.append(out)
    os.remove(raw)
    return outs, sprite, stereo


def encoder_args(fmt, stereo):
    if fmt == "m4a":
        return ["-c:a", "aac", "-b:a", "112k" if stereo else "64k", "-movflags", "+faststart"]
    return ["-c:a", "libmp3lame", "-b:a", "128k" if stereo else "80k"]


def main():
    only = set(a.lower() for a in sys.argv[1:])
    groups = [g for g in GROUPS if not only or g[0] in only]
    bank_names = sorted({b for _, banks, _ in groups for b in banks} | {"Master", "Master.strings"})
    work = tempfile.mkdtemp(prefix="invokers_audio_")
    bank_dir = os.path.join(work, "banks")
    os.makedirs(bank_dir)
    try:
        print("dumping %d banks" % len(bank_names))
        dump_banks(bank_names, bank_dir)
        fmod = Fmod()
        rendered = collections.OrderedDict()
        for group, banks, pattern in groups:
            print(group)
            rendered[group] = render_group(fmod, bank_dir, work, group, banks, pattern)
        shutil.rmtree(bank_dir)
        manifest = json.load(open(MANIFEST, encoding="utf8")) if only and os.path.exists(MANIFEST) else {"groups": {}, "sounds": {}}
        peak = max(float(np.max(np.abs(t))) for g in rendered.values() for s in g.values() for t in s["takes"])
        gain = manifest.get("gain") if only and manifest.get("gain") else min(MAX_GAIN, TARGET_PEAK / peak)
        manifest["gain"] = round(gain, 4)
        os.makedirs(OUT_DIR, exist_ok=True)
        for group, sounds in rendered.items():
            if not sounds:
                continue
            files, sprite, stereo = build_sprite(work, group, sounds, gain)
            for f in files:
                shutil.copyfile(f, os.path.join(OUT_DIR, os.path.basename(f)))
                os.remove(f)
            for key in [k for k, v in manifest["sounds"].items() if v["g"] == group]:
                del manifest["sounds"][key]
            manifest["groups"][group] = {"src": "assets/audio/sfx/%s.m4a" % group, "stereo": stereo, "sprite": sprite}
            for key, s in sounds.items():
                entry = {"g": group, "n": len(s["takes"]), "len": round(len(s["takes"][0]) / RATE, 3), "event": s["event"]}
                if s["3d"]:
                    entry["dist"] = s["dist"]
                manifest["sounds"][key] = entry
            print("wrote %s.{%s} (%d sprites, %s)" % (group, ",".join(FORMATS), len(sprite), "stereo" if stereo else "mono"))
        manifest["steps"] = step_times(HEROES + TITANS + ENEMIES)
        guid_keys = {s["guid"]: key for sounds in rendered.values() for key, s in sounds.items()}
        manifest["emitters"] = {**manifest.get("emitters", {}), **prefab_emitters(HEROES + TITANS + ENEMIES, guid_keys)}
        with open(MANIFEST, "w", encoding="utf8", newline="\n") as fh:
            json.dump(manifest, fh, indent=1)
        print("gain %.3f, %d sounds" % (gain, len(manifest["sounds"])))
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
