import os, sys, json, re
import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"
AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")

PATTERNS = [
    r"^S_Invokers_Logo$", r"^S_Invokers_Logo_custom$", r"^S_HUD_Invokers_Logo$",
    r"^T_FX_Mask_2[0-9]_\d_Slash$", r"^T_FX_Mask_25_1_Slash_Clamp$",
    r"^T_FX_Trail_(1|2|3|5|8|11|12|16)_1$",
    r"^T_FX_Smoke_(10_1|10_2|11_1|12_1|1_1|2_1|3_1)$",
    r"^T_FX_Glow_Particle_1_1$", r"^T_FX_flare_00$", r"^T_FX_Reveal_Flare_1$",
    r"^T_FX_Cracked_Glow_1_1$", r"^T_FX_Obj_Ground_Crack_1_1$",
    r"^T_FX_ExplosionRing_Gradient_1$",
    r"^T_FX_Circle_(1_1|12_1|2_2)$",
    r"^T_FX_Decal_(47_2|65_1_CEL)$", r"^T_FX_G_CAM_Decal_4_1$",
    r"^T_FX_Space_1_1$", r"^T_FX_Noise_\d+_1$",
    r"^T_FX_Obj_Bullet_1_1$", r"^T_FX_Obj_Arrow_1_1$",
    r"^T_FX_Shape_\d+_1(_Logo_NOC)?$",
    r"^T_SHR_Volcanic_Land_06_BC_v02$", r"^T_SHR_Obsidian_Rocks_01_v01_BC$",
    r"^T_SHR_RockLayered_01_BC$", r"^T_SHR_Cracks_0[12]_BC$",
    r"^T_SHR_Boss_Arena_Ogres_01_v01_(BC|NM)$",
    r"^T_Ground_Cracked_02_BC_noAlpha$",
    r"^T_LOB_StonePlatform_01_BC$", r"^T_LOBBY_RockLayered_01_BC$",
    r"^T_NOC_Wall_Central_01$", r"^T_NOC_Arch_01$",
    r"^T_CharacterReveal_Sky_03$", r"^T_FRB_BackgroundLobby_Sky$",
    r"^S_AbstractBackground_Arena$", r"^S_Background_Abstract$",
    r"^T_Map_Plane_part_0[1-8]$",
    r"^T_character_highlight(_\d)?$",
    r"^TEX_titans_crack_glow$",
]
RX = [re.compile(p) for p in PATTERNS]
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
done = set()

files = sorted(os.listdir(AA))
for i, f in enumerate(files):
    try:
        env = UnityPy.load(os.path.join(AA, f))
    except Exception:
        continue
    for o in env.objects:
        if o.type.name not in ("Texture2D", "Sprite"):
            continue
        try:
            d = o.read()
            n = d.m_Name
        except Exception:
            continue
        if n in done or not any(rx.match(n) for rx in RX):
            continue
        try:
            img = d.image
        except Exception as e:
            continue
        if img is None:
            continue
        if max(img.size) > 1024:
            sc = 1024 / max(img.size)
            img = img.resize((max(1, int(img.width * sc)), max(1, int(img.height * sc))))
        safe = re.sub(r"[^A-Za-z0-9_]+", "_", n)
        img.save(os.path.join(OUT, safe + ".png"))
        done.add(n)
        print("  +", n, img.size, file=sys.stderr)
    print(f"{i+1}/{len(files)} ({len(done)})", file=sys.stderr)

print("extracted", len(done))
