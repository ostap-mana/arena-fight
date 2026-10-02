#!/usr/bin/env bash
set -u
SRC="C:/Users/Yonix/Desktop/BUILD/Invokers Titan Legacy Music"
OUT="C:/Users/Yonix/Desktop/BUILD/invokers-playable/public/assets/audio"
mkdir -p "$OUT"
FF=ffmpeg

music() { $FF -y -v error -i "$1" -vn -ac 2 -c:a aac -b:a 88k "$OUT/$2.m4a"; echo "music $2"; }
sfx()   { $FF -y -v error -i "$1" -vn -ac 1 -ar 44100 -c:a aac -b:a 72k "$OUT/$2.m4a"; echo "sfx $2"; }

M="$SRC/Music"
S="$SRC/SFX and Voice"

music "$M/Music ELD/002 MUSIC_INGAME_ELD.wav" music_battle
music "$M/Music Meta/001 MUSIC_LOBBY.wav" music_lobby
music "$M/Music Summon/002 MUSIC_SMN_OUT.wav" music_titan
music "$M/Music PvP/001 MUSIC_PVP.wav" music_victory
music "$M/Ambience PvP/001 AMB_CSTL_BT_1.wav" amb_battle

sfx "$S/UI/015 ui_click_braam.wav" ui_braam
sfx "$S/VFX in-game/005 MGC_EXPL_1.wav" explosion
sfx "$S/VFX in-game/017 VC_EVIL_LAUGH_1.wav" boss_laugh

python "$(dirname "$0")/export_audio.py"
echo DONE
