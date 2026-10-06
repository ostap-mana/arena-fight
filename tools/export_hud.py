import os
import sys
import glob
import warnings
import UnityPy
from PIL import Image

warnings.filterwarnings("ignore")
UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "src", "assets", "GENERAL", "HUD"))

HUD_BUNDLE = "d1d383c58f"
ICON_BUNDLE = "ebb5e34e40"
SKILL_BUNDLE = "b0143d5491"
FX_BUNDLE = "bb3d2486c2"
GEMS_BUNDLE = "a17c66b4a8"
CHEST_BUNDLE = "adfde40a3b"
BATTLE_HUD_BUNDLE = "c60b75c4b2"
TOOLTIP_BUNDLE = "2748f4cd7c"
LOBBY_UI_BUNDLE = "2748f4cd7c"
TUTORIAL_BUNDLE = "f38b6f1953"
GLOW_BUNDLE = "8abb189e3a"
RELIC_BUNDLE = "8cbf72d8cb"
BACKGROUND_BUNDLE = "cb600fe7b2"
RELIC_SETS = ("Attack", "LifeSteal", "CriticalDamage", "EventSet2")
RELIC_SLOTS = ("Weapon", "Shield", "Helmet", "Pauldrons", "Gauntlets", "Chestplate", "Belt", "Boots")
RARITY_BORDER = {
    "common": (0.7490196, 0.7490196, 0.7490196),
    "uncommon": (0.2431373, 1.0, 0.2901961),
    "rare": (0.0, 0.827451, 1.0),
    "epic": (0.972549, 0.4039216, 1.0),
    "legendary": (1.0, 0.627451, 0.1764706),
}

SPRITES = {
    "select/card-legendary": (LOBBY_UI_BUNDLE, "S_HeroCardRarityBackground_Legendary"),
    "select/card-epic": (LOBBY_UI_BUNDLE, "S_HeroCardRarityBackground_Epic"),
    "select/card-gradient": (LOBBY_UI_BUNDLE, "S_HeroCardGradient"),
    "select/card-data": (LOBBY_UI_BUNDLE, "S_HeroCardDataBackground"),
    "select/card-glow-legendary": (LOBBY_UI_BUNDLE, "S_RectangleGlow"),
    "select/card-glow-epic": (LOBBY_UI_BUNDLE, "S_RectangleGlow"),
    "select/card-selected": (LOBBY_UI_BUNDLE, "S_SelectedWithGlow"),
    "select/star": (LOBBY_UI_BUNDLE, "S_Default_Star"),
    "select/class-ranged": (LOBBY_UI_BUNDLE, "S_HeroClass_RangedAttacker"),
    "select/class-melee": (LOBBY_UI_BUNDLE, "S_HeroClass_MeleeAttacker"),
    "select/class-tank": (LOBBY_UI_BUNDLE, "S_HeroClass_Tank"),
    "select/class-support": (LOBBY_UI_BUNDLE, "S_HeroClass_Support"),
    "select/title-back": (LOBBY_UI_BUNDLE, "S_ScreenTitleBackground"),
    "select/title-shadow": (LOBBY_UI_BUNDLE, "S_SimpleShadow"),
    "select/title-ornament": (LOBBY_UI_BUNDLE, "S_TitleOrnamentLine"),
    "select/info-shadow": (LOBBY_UI_BUNDLE, "S_SimpleShadow"),
    "select/bottom-gradient": (LOBBY_UI_BUNDLE, "S_VerticalGradient"),
    "select/rarity-legendary": (LOBBY_UI_BUNDLE, "S_RoundedRectangle_4px"),
    "select/rarity-legendary-glow": (LOBBY_UI_BUNDLE, "S_CommonGlowEffect"),
    "select/rarity-epic": (LOBBY_UI_BUNDLE, "S_RoundedRectangle_4px"),
    "select/rarity-epic-glow": (LOBBY_UI_BUNDLE, "S_CommonGlowEffect"),
    "select/button": (LOBBY_UI_BUNDLE, "S_MainButton"),
    "select/tap-circle": (TUTORIAL_BUNDLE, "S_TutorialCircle"),
    "select/tutorial-arrow": (TUTORIAL_BUNDLE, "S_TutorialArrow"),
    "select/border-noise": (LOBBY_UI_BUNDLE, "T_FX_Noise_1_1_UI_LowScale"),
    "select/border-distort": (LOBBY_UI_BUNDLE, "T_FX_Noise_2_1_UI_LowScale"),
    "select/border-mask": (LOBBY_UI_BUNDLE, "T_FX_Mask_UI_1_2_LowScale"),
    "select/card-glare": (LOBBY_UI_BUNDLE, "T_FX_Chroma_Glare"),
    "select/button-glow": (LOBBY_UI_BUNDLE, "S_LocalUI_Shadow"),
    "select/button-sweep": (LOBBY_UI_BUNDLE, "S_HorizontalTwoSidedGradient"),
    "bars/hero-frame": (HUD_BUNDLE, "S_3DHPBar_Hero"),
    "bars/hero-fill": (HUD_BUNDLE, "S_3DHPBar_Hero_Fill"),
    "bars/fill-noise": (HUD_BUNDLE, "HeroFill_Overlay"),
    "bars/panel-back": (HUD_BUNDLE, "S_HeroPanel_Background"),
    "bars/panel-fill": (HUD_BUNDLE, "S_HeroPanel_Fill"),
    "bars/panel-top": (HUD_BUNDLE, "S_HeroPanelFillOrnament_Top"),
    "bars/enemy-regular": (HUD_BUNDLE, "S_3DHPBar_Regular"),
    "bars/enemy-elite": (HUD_BUNDLE, "S_3DHPBar_Elite"),
    "bars/enemy-boss": (HUD_BUNDLE, "S_3DHPBar_Boss"),
    "bars/titan-back": (HUD_BUNDLE, "S_HUD_TitanMeterBackground"),
    "bars/titan-fill": (HUD_BUNDLE, "S_HUD_TitanMeterChargeFill"),
    "bars/titan-ornament": (HUD_BUNDLE, "S_HUD_TitanMeterOrnament"),
    "buttons/skill-frame": (HUD_BUNDLE, "S_HUD_Skill_Button"),
    "buttons/ultimate-frame": (HUD_BUNDLE, "S_HUD_Skill_Ultimate"),
    "buttons/dash": (HUD_BUNDLE, "S_HUD_Dash_Icon"),
    "buttons/pressed": (HUD_BUNDLE, "S_HUD_PressedSkillButton_Effect"),
    "buttons/ready": (HUD_BUNDLE, "S_HUD_SkillReady_Effect"),
    "buttons/ult-ring": (HUD_BUNDLE, "S_HUD_RadialBorderProgressBar"),
    "buttons/glow": (HUD_BUNDLE, "S_HUD_GlowEffect"),
    "buttons/stick-base": (HUD_BUNDLE, "S_HUD_MainController"),
    "buttons/stick-knob": (HUD_BUNDLE, "S_HUD_ControllerPoint"),
    "buttons/attack-staff": (ICON_BUNDLE, "S_HUD_AttackButton_MagicStaff"),
    "buttons/attack-axe": (ICON_BUNDLE, "S_HUD_AttackButton_Axe"),
    "buttons/attack-pistol": (ICON_BUNDLE, "S_HUD_AttackButton_Pistol"),
    "buttons/attack-sword": (ICON_BUNDLE, "S_HUD_AttackButton_Sword"),
    "skills/lts019-1": (SKILL_BUNDLE, "S_LTS019_Skill_1"),
    "skills/lts019-2": (SKILL_BUNDLE, "S_LTS019_Skill_2"),
    "skills/lts033-1": (SKILL_BUNDLE, "S_LTS033_Skill_1"),
    "skills/lts033-2": (SKILL_BUNDLE, "S_LTS033_Skill_2"),
    "skills/noc015-1": (SKILL_BUNDLE, "S_NOC015_Skill_1"),
    "skills/noc015-2": (SKILL_BUNDLE, "S_NOC015_Skill_2"),
    "skills/lts019-3": (SKILL_BUNDLE, "S_LTS019_Skill_3"),
    "skills/lts033-3": (SKILL_BUNDLE, "S_LTS033_Skill_3"),
    "skills/noc015-3": (SKILL_BUNDLE, "S_NOC015_Skill_3"),
    "skills/lts019-ult": (SKILL_BUNDLE, "S_LTS019_Skill_Ultimate"),
    "skills/lts033-ult": (SKILL_BUNDLE, "S_LTS033_Skill_Ultimate"),
    "skills/noc015-ult": (SKILL_BUNDLE, "S_NOC015_Skill_Ultimate"),
    "fx/ult-swirl-a": (FX_BUNDLE, "T_FX_Noise_39_1_P"),
    "fx/ult-swirl-b": (FX_BUNDLE, "T_FX_Noise_40_1_P_2"),
    "fx/ult-ring-mask": (FX_BUNDLE, "T_FX_Gradient_Mask_R_1_1"),
    "fx/ult-noise": (FX_BUNDLE, "T_FX_Noise_75_1"),
    "icons/element-light": (ICON_BUNDLE, "S_Light_Element_Icon"),
    "icons/element-dark": (ICON_BUNDLE, "S_Dark_Element_Icon"),
    "icons/element-fire": (ICON_BUNDLE, "S_Fire_Element_Icon"),
    "icons/element-wind": (ICON_BUNDLE, "S_Wind_Element_Icon"),
    "icons/element-water": (ICON_BUNDLE, "S_Water_Element_Icon"),
    "icons/element-earth": (ICON_BUNDLE, "S_Earth_Element_Icon"),
    "icons/loot-weapon": (HUD_BUNDLE, "S_HUD_Swords_Icon"),
    "icons/loot-anima": (HUD_BUNDLE, "S_HUD_AnimaIcon"),
    "icons/loot-gems": (GEMS_BUNDLE, "S_GemShop_Gems1"),
    "icons/loot-chest": (CHEST_BUNDLE, "S-VIPChest_Gold"),
    "buttons/auto-off": (BATTLE_HUD_BUNDLE, "S_HUD_AutoPlayButton_Main"),
    "buttons/auto-on": (BATTLE_HUD_BUNDLE, "S_HUD_AutoPlayButton_Circle"),
    "buttons/auto-arrows": (BATTLE_HUD_BUNDLE, "S_HUD_AutoPlayButton_Arrows"),
    "buttons/auto-sword": (BATTLE_HUD_BUNDLE, "S_HUD_AutoPlayButton_Sword"),
    "buttons/auto-tab-on": (BATTLE_HUD_BUNDLE, "S_HUD_AutoPlayTab_Active"),
    "buttons/auto-tab-off": (BATTLE_HUD_BUNDLE, "S_HUD_AutoPlayTab_Active"),
    "buttons/titan-manual": (BATTLE_HUD_BUNDLE, "S_HUD_Titan_Manual"),
    "bars/friendly-back": (BATTLE_HUD_BUNDLE, "S_3DHPBarBack_Hero"),
    "bars/mana-back": (BATTLE_HUD_BUNDLE, "S_HUD_TitanMeterBackground"),
    "bars/mana-fill": (BATTLE_HUD_BUNDLE, "S_HUD_TitanMeterChargeFill"),
    "bars/mana-mask": (BATTLE_HUD_BUNDLE, "S_HUD_TitanMeterChargeFillMask"),
    "bars/mana-ornament": (BATTLE_HUD_BUNDLE, "S_HUD_TitanMeterOrnament"),
    "bars/mana-glow": (BATTLE_HUD_BUNDLE, "S_HUD_GlowEffect"),
    "bars/tooltip-back": (TOOLTIP_BUNDLE, "S_MasterPopupTooltip_Background"),
    "anima/background": (BATTLE_HUD_BUNDLE, "S_TitanPanel_TitanBackground"),
    "anima/mask": (BATTLE_HUD_BUNDLE, "S_TitanPanel_TitanMask"),
    "anima/highlight": (BATTLE_HUD_BUNDLE, "S_TitanPanel_TitanHighLight"),
    "anima/hero-background": (BATTLE_HUD_BUNDLE, "S_TitanPanel_HeroBackground"),
    "anima/shadow": (BATTLE_HUD_BUNDLE, "S_HUD_SquaredShadow"),
    "anima/gradient": (BATTLE_HUD_BUNDLE, "S_HUD_VerticalTwoSidedGradient"),
    "anima/flare": (BATTLE_HUD_BUNDLE, "S_HUD_FlareEffect"),
    "anima/press-circle": (BATTLE_HUD_BUNDLE, "S_HUD_SkillInQueue_Effect"),
    "buttons/stick-decor": (BATTLE_HUD_BUNDLE, "S_HUD_ControllerDecor"),
    "buttons/auto-badge-back": (BATTLE_HUD_BUNDLE, "S_HUD_ContentBracketsBackground"),
    "buttons/auto-badge-ring": (BATTLE_HUD_BUNDLE, "S_HUD_SkillInQueue_Effect"),
    "buttons/auto-badge-disk": (BATTLE_HUD_BUNDLE, "S_HUD_SimpleButton"),
    "fx/auto-circle": (GLOW_BUNDLE, "T_FX_Glow_Particle_7_1"),
    "panel/hero-background": (BATTLE_HUD_BUNDLE, "S_HeroPanel_HeroBackground"),
    "panel/hero-selected": (BATTLE_HUD_BUNDLE, "S_HeroPanel_HeroSelectionBackground"),
    "panel/portrait-mask": (LOBBY_UI_BUNDLE, "S_CommonSimpleCircle"),
    "wave/back": (BATTLE_HUD_BUNDLE, "S_HUD_LevelProgressionBackground"),
    "wave/fill": (BATTLE_HUD_BUNDLE, "S_HUD_LevelProgressionFill"),
    "wave/start": (BATTLE_HUD_BUNDLE, "S_HUD_LevelProgressionDecor_01"),
    "wave/end": (BATTLE_HUD_BUNDLE, "S_HUD_LevelProgressionDecor_02"),
    "wave/marker": (BATTLE_HUD_BUNDLE, "S_HUD_LevelProgressionSlider"),
    "wave/enemies": (BATTLE_HUD_BUNDLE, "S_HUD_EnemyCounter"),
    "wave/boss": (BATTLE_HUD_BUNDLE, "S_HUD_BossBadge"),
    "loot/background": (BATTLE_HUD_BUNDLE, "S_HUD_LootBackground"),
    "loot/flash": (BATTLE_HUD_BUNDLE, "S_HUD_HorizontalTwoSidedGradient"),
    "loot/star": (LOBBY_UI_BUNDLE, "S_Default_Star"),
}
SPRITES.update({f"loot/frame-{r}": (LOBBY_UI_BUNDLE, "S_ResourceRewardItemBackgroundSimple") for r in RARITY_BORDER})
SPRITES.update({
    "gear/background": (BACKGROUND_BUNDLE, "S_Background_Abstract"),
    "gear/back-shadow": (LOBBY_UI_BUNDLE, "S_BackButtonShadow"),
    "gear/back-arrow": (LOBBY_UI_BUNDLE, "S_BackButtonArrow"),
    "gear/power-ornament": (LOBBY_UI_BUNDLE, "S_HeroPowerOrnament"),
    "gear/power-icon": (LOBBY_UI_BUNDLE, "S_PowerColorized_Icon"),
    "gear/power-shadow": (LOBBY_UI_BUNDLE, "S_ShadowEaseRight"),
    "gear/slot-bg": (LOBBY_UI_BUNDLE, "S_EquipmentSlotBackground"),
    "gear/slot-dim": (LOBBY_UI_BUNDLE, "S_RoundedRectangle_8px"),
    "gear/item-gradient": (LOBBY_UI_BUNDLE, "S_HeroCardGradient"),
    "gear/stat-light": (LOBBY_UI_BUNDLE, "S_HorizontalTwoSidedGradient_Wide"),
    "gear/stat-dark": (LOBBY_UI_BUNDLE, "S_HorizontalTwoSidedGradient_Wide"),
    "gear/stat-flash": (LOBBY_UI_BUNDLE, "S_HorizontalTwoSidedGradient"),
    "gear/arrow-up": (LOBBY_UI_BUNDLE, "S_ArrowUp_Icon"),
    "gear/badge": (LOBBY_UI_BUNDLE, "S_Master_Notification"),
    "gear/badge-glow": (LOBBY_UI_BUNDLE, "S_CommonGlowEffect"),
    "gear/hero-bg": (LOBBY_UI_BUNDLE, "S_HeroCardRarityBackground_Small"),
    "gear/tab": (LOBBY_UI_BUNDLE, "S_Button_Selectable"),
    "gear/tab-on": (LOBBY_UI_BUNDLE, "S_Button_Selectable"),
})
SPRITES.update({f"gear/slot-{k.lower()}": (LOBBY_UI_BUNDLE, f"S_RelicSlot_{k}") for k in RELIC_SLOTS})
SPRITES.update({f"gear/border-{r}": (LOBBY_UI_BUNDLE, "S_GearBorder_8px") for r in RARITY_BORDER})
SPRITES.update({f"gear/glow-{r}": (LOBBY_UI_BUNDLE, "S_RectangleGlow") for r in RARITY_BORDER})
SPRITES.update({f"gear/set-{s.lower()}": (RELIC_BUNDLE, f"S_{s}_Icon") for s in RELIC_SETS})
SPRITES.update({f"loot/relic-{s.lower()}-{k.lower()}": (RELIC_BUNDLE, f"S_{s}_{k}") for s in RELIC_SETS for k in RELIC_SLOTS})

MAX_ICON = 256

FULL_RECT = {k for k, (b, _) in SPRITES.items() if b in (BATTLE_HUD_BUNDLE, TOOLTIP_BUNDLE, TUTORIAL_BUNDLE)}
TINT = {
    "buttons/auto-tab-on": (1.0, 0.9686275, 0.6),
    "buttons/auto-tab-off": (0.3294118, 0.5019608, 0.9607844),
    "bars/mana-glow": (0.9058824, 0.7686275, 0.4705882),
    "select/card-gradient": (0.0, 0.0, 0.0),
    "select/card-data": (0.0, 0.0, 0.0, 0.502),
    "select/card-glow-legendary": (0.896, 0.481, 0.123),
    "select/card-glow-epic": (0.671, 0.484, 0.925),
    "select/card-selected": (0.0, 1.0, 0.729),
    "select/title-shadow": (0.113, 0.124, 0.17),
    "select/info-shadow": (0.094, 0.09, 0.081),
    "select/bottom-gradient": (0.169, 0.196, 0.267),
    "select/rarity-legendary": (0.962, 0.528, 0.186),
    "select/rarity-legendary-glow": (0.962, 0.528, 0.186, 0.502),
    "select/rarity-epic": (0.882, 0.333, 0.827),
    "select/rarity-epic-glow": (0.882, 0.333, 0.827, 0.502),
    "select/button-glow": (0.906, 0.769, 0.471, 0.6),
    "anima/shadow": (0.1339, 0.1394207, 0.1603774),
    "anima/press-circle": (0.9058824, 0.7686275, 0.4705882),
    "buttons/stick-decor": (0.8980393, 0.8392158, 0.6627451, 0.2980392),
    "buttons/auto-badge-back": (0.8980393, 0.8392158, 0.6627451),
    "buttons/auto-badge-ring": (1.0, 0.7570274, 0.1568627),
    "buttons/auto-badge-disk": (1.0, 0.7327648, 0.0),
    "loot/flash": (0.8584906, 0.9572436, 0.9622642),
}
TINT.update({f"loot/frame-{r}": c for r, c in RARITY_BORDER.items()})
TINT.update({f"gear/border-{r}": c for r, c in RARITY_BORDER.items()})
TINT.update({f"gear/glow-{r}": c + (0.6,) for r, c in RARITY_BORDER.items()})
TINT.update({f"gear/slot-{k.lower()}": (0.8980392, 0.8392157, 0.6627451) for k in RELIC_SLOTS})
TINT.update({
    "gear/power-shadow": (0.1098039, 0.1162263, 0.1320755, 0.7490196),
    "gear/slot-dim": (0.0, 0.0, 0.0, 0.4),
    "gear/item-gradient": (0.0, 0.0, 0.0, 0.5019608),
    "gear/stat-light": (0.8113208, 0.8113208, 0.8113208, 0.0509804),
    "gear/stat-dark": (0.0, 0.0, 0.0, 0.1490196),
    "gear/stat-flash": (0.2039216, 0.8490566, 0.2196079),
    "gear/arrow-up": (0.3044, 0.9339623, 0.3218),
    "gear/badge-glow": (0.9921569, 0.145098, 0.2329412, 0.5019608),
    "gear/tab-on": (0.9058824, 0.7686275, 0.4705882),
})
LOSSY = {"gear/background": (1920, 82)}

DISK_BAKE = {
    "fx/auto-circle": {
        "size": 256,
        "radii": (0.468, 0.538, 0.933, 1.0),
        "v": (0.0, 0.086, 0.935, 1.0),
        "tiling": (-2.0, 1.0),
        "color": (1.0, 0.6235294, 0.0),
        "color_mult": 2.2706029,
        "alpha_power": 7.5,
        "alpha_mult": 2.28,
    },
}

LUMINANCE_TO_ALPHA = {"fx/ult-ring-mask", "select/border-mask"}
EDGE_BLEED = {"buttons/ultimate-frame"}
HERO_FRAME = "bars/hero-frame"
HERO_FRAME_RING = (97.0, 27.5, 21.5, 28.5)
HERO_FRAME_CUT = 75


def luminance_mask(img):
    alpha = img.convert("L")
    white = Image.new("L", img.size, 255)
    return Image.merge("RGBA", (white, white, white, alpha))


def clear_edge_bleed(img, core=200, grow=3):
    import numpy as np
    a = np.array(img)
    alpha = a[..., 3]
    keep = alpha > core
    for _ in range(grow):
        k = keep.copy()
        k[1:, :] |= keep[:-1, :]
        k[:-1, :] |= keep[1:, :]
        k[:, 1:] |= keep[:, :-1]
        k[:, :-1] |= keep[:, 1:]
        keep = k
    alpha[~keep] = 0
    return Image.fromarray(a, "RGBA")


def trim_hero_frame(img):
    import numpy as np
    a = np.array(img)
    h, w = a.shape[:2]
    cx, cy, rx, ry = HERO_FRAME_RING
    sx = w / 400.0
    sy = h / 56.0
    ys, xs = np.mgrid[0:h, 0:w]
    inside = ((xs + 0.5 - cx * sx) / (rx * sx)) ** 2 + ((ys + 0.5 - cy * sy) / (ry * sy)) ** 2 <= 1.0
    keep = (xs + 0.5 >= cx * sx) | inside
    a[..., 3][~keep] = 0
    return Image.fromarray(a, "RGBA").crop((round(HERO_FRAME_CUT * sx), 0, w, h))


def sample_wrapped(tex, u, v):
    import numpy as np
    h, w = tex.shape
    x = (u % 1.0) * w - 0.5
    y = (1.0 - v % 1.0) * h - 0.5
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    x0w, x1w = x0 % w, (x0 + 1) % w
    y0c, y1c = np.clip(y0, 0, h - 1), np.clip(y0 + 1, 0, h - 1)
    top = tex[y0c, x0w] * (1 - fx) + tex[y0c, x1w] * fx
    bottom = tex[y1c, x0w] * (1 - fx) + tex[y1c, x1w] * fx
    return top * (1 - fy) + bottom * fy


def bake_disk(img, spec):
    import numpy as np
    tex = np.asarray(img.convert("L"), dtype=np.float64) / 255.0
    n = spec["size"]
    px = (np.arange(n) + 0.5) / n * 2.0 - 1.0
    x, y = np.meshgrid(px, -px)
    r = np.hypot(x, y)
    u = (np.degrees(np.arctan2(y, x)) / 360.0 + 0.75) % 1.0
    v = np.interp(r, spec["radii"], spec["v"])
    tu, tv = spec["tiling"]
    t = sample_wrapped(tex, u * tu, v * tv)
    inside = (r >= spec["radii"][0]) & (r <= spec["radii"][-1])
    alpha = np.clip(t ** spec["alpha_power"] * spec["alpha_mult"], 0.0, 1.0) * inside
    linear = np.array(spec["color"]) ** 2.2
    rgb = np.clip(linear * spec["color_mult"] * t[..., None], 0.0, 1.0) ** (1 / 2.2)
    out = np.dstack([rgb, alpha[..., None]])
    return Image.fromarray(np.round(out * 255).astype(np.uint8), "RGBA")


def bundle_path(prefix):
    found = glob.glob(os.path.join(AA, prefix + "*.bundle"))
    return found[0] if found else None


def full_rect(sprite, img):
    w, h = round(sprite.m_Rect.width), round(sprite.m_Rect.height)
    if img.size == (w, h):
        return img
    off = sprite.m_RD.textureRectOffset
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(img, (round(off.x), h - round(off.y) - img.height))
    return canvas


def tint(img, color):
    rgba = tuple(color) + (1.0,) * (4 - len(color))
    channels = [c.point(lambda v, k=k: round(v * k)) for c, k in zip(img.split(), rgba)]
    return Image.merge("RGBA", channels)


def images_of(prefix):
    path = bundle_path(prefix)
    if path is None:
        return None, None
    env = UnityPy.load(path)
    sprites = {}
    textures = {}
    for o in env.objects:
        if o.type.name == "Sprite":
            d = o.read()
            sprites.setdefault(d.m_Name, d)
        elif o.type.name == "Texture2D":
            d = o.read()
            textures.setdefault(d.m_Name, d)
    return sprites, textures


def main(only):
    by_bundle = {}
    for key, (prefix, name) in SPRITES.items():
        if only and not any(key.startswith(o) for o in only):
            continue
        by_bundle.setdefault(prefix, []).append((key, name))
    missing = []
    for prefix, items in by_bundle.items():
        sprites, textures = images_of(prefix)
        if sprites is None:
            missing.extend(f"{name} (bundle {prefix} not found)" for _, name in items)
            continue
        for key, name in items:
            sprite = sprites.get(name) or textures.get(name)
            if sprite is None:
                missing.append(name)
                continue
            path = os.path.join(OUT, key + ".webp")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            img = sprite.image.convert("RGBA")
            if key in FULL_RECT and hasattr(sprite, "m_RD"):
                img = full_rect(sprite, img)
            if key in TINT:
                img = tint(img, TINT[key])
            if key in LUMINANCE_TO_ALPHA:
                img = luminance_mask(img)
            if key in EDGE_BLEED:
                img = clear_edge_bleed(img)
            if key == HERO_FRAME:
                img = trim_hero_frame(img)
            if key in DISK_BAKE:
                img = bake_disk(img, DISK_BAKE[key])
            if key.startswith("icons/") and max(img.size) > MAX_ICON:
                k = MAX_ICON / max(img.size)
                img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
            if key in LOSSY:
                side, quality = LOSSY[key]
                if max(img.size) > side:
                    k = side / max(img.size)
                    img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
                img.convert("RGB").save(path, format="WEBP", quality=quality, method=6)
            else:
                img.save(path, format="WEBP", lossless=True, exact=True, method=6)
            print(f"{key}.webp  {img.width}x{img.height}  <- {name}")
    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
