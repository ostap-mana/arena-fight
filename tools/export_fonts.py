import io
import os
import sys
import glob
import warnings
import UnityPy
from fontTools.ttLib import TTFont
from fontTools import subset

warnings.filterwarnings("ignore")
UnityPy.config.FALLBACK_UNITY_VERSION = "6000.3.21f1"

AA = os.path.expandvars(r"%APPDATA%\zone.hitzone.invokers.launcher\game\Invokers_Data\StreamingAssets\aa\StandaloneWindows64")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "src", "font"))
FONT_BUNDLE = "ebb5e34e40"

FONTS = {
    "Hitzone-Regular": "hitzone-400.woff2",
    "Hitzone-Medium": "hitzone-500.woff2",
    "Montserrat-BoldItalic": "montserrat-700i.woff2",
}

UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2122, 0x2605, 0x2606]
)


def game_fonts():
    path = glob.glob(os.path.join(AA, FONT_BUNDLE + "*.bundle"))
    if not path:
        raise SystemExit(f"bundle {FONT_BUNDLE}* not found in {AA}")
    env = UnityPy.load(path[0])
    out = {}
    for o in env.objects:
        if o.type.name != "Font":
            continue
        d = o.read()
        if d.m_Name in FONTS and getattr(d, "m_FontData", None):
            out[d.m_Name] = bytes(d.m_FontData)
    return out


def subset_woff2(data):
    font = TTFont(io.BytesIO(data))
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "calt", "tnum", "lnum"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    wanted = [u for u in UNICODES if u in font.getBestCmap()]
    sub.populate(unicodes=wanted)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue(), len(wanted)


def main():
    fonts = game_fonts()
    missing = [n for n in FONTS if n not in fonts]
    for name, file in FONTS.items():
        if name not in fonts:
            continue
        data, count = subset_woff2(fonts[name])
        path = os.path.join(OUT, file)
        with open(path, "wb") as fh:
            fh.write(data)
        print(f"{file}  {len(data) // 1024} KB  {count} glyphs  <- {name}")
    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
