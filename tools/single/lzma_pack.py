import sys
import lzma


def main(argv):
    src, out, lc, lp, pb = argv[0], argv[1], int(argv[2]), int(argv[3]), int(argv[4])
    data = open(src, "rb").read()
    dict_size = 1 << max(16, min(27, (len(data) - 1).bit_length()))
    filters = [{"id": lzma.FILTER_LZMA1, "preset": 9 | lzma.PRESET_EXTREME, "dict_size": dict_size, "lc": lc, "lp": lp, "pb": pb, "nice_len": 273, "mf": lzma.MF_BT4, "depth": 0}]
    packed = lzma.compress(data, format=lzma.FORMAT_RAW, filters=filters)
    open(out, "wb").write(packed)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
