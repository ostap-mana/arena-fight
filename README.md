# INVOKERS — Titan Legacy (three.js playable)

Playable-ad style game built on three.js. Every model, texture and sound is pulled
straight out of the shipped build of *Invokers: Titan Legacy* — nothing is placeholder art.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
```

## Flow

1. **Hook** — hero select, three invokers, live 3D portraits rendered from the real models.
   `src/world/showcase.js` stages the select screen: a rim-light shader on the heroes (the picked one is lit and edged in its element colour, the others fall back to dim silhouettes), a rotating glow circle under the picked hero, contact shadows and a tightened key-light shadow, a rising light shaft (`T_FX_Reveal_Flare_1`), motes and arena embers, and heavier, darker fog to push the background back. The select camera solves its distance and tilt from the title and card positions, so the heroes stand between them on any aspect.
2. **Core loop** — top-down fight inside a Spire (tower) arena from the game, virtual stick + skills, four enemy waves. The hero's ultimate charges from damage dealt and taken; the titan card counts down 15 s.
3. **Climax** — titan card ready → `TITAN READY` → tap the card (or anywhere) to transform (crystal convergence, camera dolly, white-out).
4. **Titan gameplay** — huge form, ~14 s timer, AoE swipes that clear the wave.
5. **End card** — victory, loot reveal, store buttons and CTA.

### A/B variants

| URL | Variant |
| --- | --- |
| `/` | default |
| `/?v=fuse` | Match & Fuse — drag anima into the invoker before battle (grants +25 % HP at 3+) |
| `/?v=rescue` | Fail state / timed rescue — at 0 HP you get a 3 s window to transform |

### Controls

The fight is playable with one thumb anywhere on the screen:

| Gesture | Action |
| --- | --- |
| hold and drag | move (the stick appears under the finger), or `WASD`/arrows |
| release | the hero stops, auto-attacks and auto-casts ready skills on nearby enemies |
| tap | cast the ultimate if it is charged, otherwise the strongest ready skill (queued if the hero is mid-cast) |
| swipe | dash in the swipe direction |
| tap while the Titan is ready | transform |

The buttons on the right still work and show the cooldowns. A hint (`#gesturehint`) teaches the gestures at the start of the fight and shows "tap to transform" in portrait.

## Where the assets come from

The game ships as Unity 6000.3.21f1 with Addressables bundles; the launcher is Electron.

| Asset | Source |
| --- | --- |
| Characters (16 rigged models) | `Invokers_Data/StreamingAssets/aa/StandaloneWindows64/*.bundle` |
| Textures (VFX, logo) | same bundles |
| Arena (6 Spire tower locations) | Spire scenes `SPR_<Element>_01` from the game's download cache, `%USERPROFILE%\AppData\LocalLow\Unity\Hit_Zone_Invokers` |
| Battle HUD (HP bars, attack/skill/dash/ultimate buttons, ultimate VFX) | HUD atlas `d1d383c58f`, weapon attack icons `ebb5e34e40`, hero skill icons `b0143d5491`, FX textures `bb3d2486c2` |
| Fonts (Hitzone Regular/Medium, Montserrat Bold Italic) | `Font` assets in `ebb5e34e40`, subset to Latin-1 + punctuation |
| Audio | FMOD banks, already decoded to WAV in `Invokers Titan Legacy Music/` |

`tools/` holds the extraction pipeline (needs `UnityPy`, `numpy`, `ffmpeg`):

```bash
python tools/index_bundles.py        # index every object in every bundle
python tools/scan_chars.py           # find bundles with skinned characters + clips
python tools/export_glb.py          # export heroes, titan, enemies -> GLB with every AnimationClip
python tools/export_lobby.py        # export the high-detail lobby heroes (MDL_LOB, SH_CharacterLobby / hair shaders) for the select screen
python tools/export_tex.py fx        # export VFX / logo textures
python tools/export_spires.py        # export the Spire tower locations -> public/assets/locations
python tools/export_hud.py           # export the battle HUD sprites -> src/assets/GENERAL/HUD
python tools/export_fonts.py         # export the game fonts (Hitzone, Montserrat) -> src/font
python tools/split_logo.py           # cut the logo's O ring out for the spinning boot screen
bash   tools/audio.sh                # transcode WAV -> m4a
```

### Arena locations

The arena is a real Spire (tower mode) level from the game, not procedural geometry.
`tools/export_spires.py` finds the six cached Spire scenes (Fire, Water, Earth, Wind, Light, Dark),
walks the `Environment` hierarchy, and writes `public/assets/locations/spire_<element>.glb` plus
`index.json`. Meshes are shared between instances, textures are WebP (`EXT_texture_webp`), and the
baked lightmaps of the scene ship with it: each node carries its lightmap index and tiling/offset.
The arena center is recentered to the origin; the playable floor is flat out to a radius of about 19.

`src/world/arena.js` loads the location, batches equal meshes into `InstancedMesh`es with a per-instance
lightmap tiling attribute, renders the environment unlit with its baked lighting, rebuilds the layered
terrain shader (mask + base/red/green layers), scrolls lava and waterfalls, and adds a shadow catcher for
the characters. Pick a location with `?loc=fire|water|earth|wind|light|dark` (default `fire`).

A Spire is only exportable once the game client has downloaded it: open that tower in the game, then run
`python tools/export_spires.py [element ...]`.

### Battle HUD

Everything in the fight HUD is the game's own art, laid out after the `HUDScreen`, `3D_HPBar_*` and
`UnltimateButton` prefabs: the hero HP frame `S_3DHPBar_Hero` (fill tint and red damage trail from
`3D_HPBar_Friendly_M`), enemy bars `S_3DHPBar_Regular` / `Elite` / `Boss` projected over each enemy,
the per-weapon attack button from `CharacterWeaponToIconList` (Iristeia staff, Devi axe, Raziel pistol),
the heroes' real `Skill_1` / `Skill_2` / `Skill_Ultimate` icons, and the Titan mana bar.
The ultimate button shows charge as a radial ring with a percentage; when full it plays the activation
(ready burst, fiery noise ring, rotating energy swirls) and tapping it casts the hero's ultimate
(`SkillUlt_PreCast` → `SkillUlt_EndCast`, VFX SkillType 4). AUTO casts it too. The titan has no ultimate, so the button hides in titan form.
The Titan is summoned from its own card, a port of `AnimaButtonsLayout/Anima_1` (`AnimaCardButton`) placed
next to the AUTO button as in the game: `S_TitanPanel_TitanBackground`, the titan's `S_<CODE>_Large` portrait
masked by `S_TitanPanel_TitanMask`, the desaturated icon under the black 80 % `Cooldown` fill with its seconds counter,
the `S_TitanPanel_TitanHighLight` border and the appear/charged/pressed effects when it is ready, the light
`ActivationCooldown` fill that drains during titan form, and the hero's own portrait in `S_TitanPanel_HeroBackground` below.
With AUTO on, the joystick rests at the game's position with its `AutoPlayBadge`: the `S_HUD_ContentBracketsBackground`
tab, the gold `S_HUD_SkillInQueue_Effect` ring, the `S_HUD_SimpleButton` disk, and the orange `M_FX_Toggle_On_Circle_1_2`
arcs. `export_hud.py` bakes those arcs from `T_FX_Glow_Particle_7_1` through the `MESH_UI_FX_Disk_1_1` UV mapping into `fx/auto-circle.webp`.
The HUD scales with the screen through `--hud-scale`. The battle camera uses the game's own `CameraSetup` values from the Spire scene's `Spires_Cameras_Prefab`: distance 23, horizontal field of view 70°, the maximum pitch of 45°, and yaw 180° (`Gameplay_14`), so the whole arena fits on a landscape screen. The stick is rotated with the camera yaw, and the titan form pulls the camera back a further 20 %. In portrait the vertical field of view is capped at 62°, the camera pulls back and tilts steeper, and it centres on the hero; the floating joystick (`S_HUD_MainController`, 216 units with a 100-unit movement range as in `OnScreenJoystick`) rests at the bottom left and its centre follows the finger, so reversing direction is instant. Buttons sit on a thumb arc around the attack button.

### Model format

`public/assets/glb/<id>.glb` — mesh, skeleton, embedded textures and every animation clip of
the character. `tools/glb_jobs.json` lists which bundle each model comes from; to re-export a
subset run `python tools/export_glb.py "" tools/glb_jobs.json LTS019 OGR013`.

Unity is left-handed, so the exporter mirrors Z on positions, normals, quaternions and
bind matrices, and reverses triangle winding. Weapons are not re-parented: the clips animate
`WeaponRoot_L/R` directly.

### Animation

`tools/export_glb.py` decodes Unity's `StreamedClip` / `DenseClip` / `ConstantClip` curves
(bone paths matched by CRC32) into glTF animations. `src/core/model.js` loads them with
`GLTFLoader`, pins the horizontal motion of `Root_M` in place by counter-animating `Base`
(so lunges and falls stay on the actor's gameplay position), and finds each clip's impact
frame from the peak angular speed of the weapon / arm bones. `src/core/rig.js` plays them
through an `AnimationMixer`:

| State | Clips |
| --- | --- |
| idle / run / fly | `Idle`, `Run` |
| pose (select screen) | `IdleLOB`, falls back to `Idle` |
| attack | `ComboAttack_0..5` in sequence, the combo restarts after 2.4 s |
| cast (s1 / s2) | `Skill_1_PreCast` → `Skill_1_EndCast`, `Skill_2_*` for s2, wind-up squeezed to 0.34 s |
| dash | `Dash` fitted to 0.32 s |
| hit | `Flinch` |
| death | `Death` or a random `Death_2..5` |
| morph | `Morph` → `Morph_EndCast`, or `SkillUlt_*` |
| roar | `IdleBreak`, or `Skill_2_EndCast` for the titan |

Hit damage, slashes and skill effects fire on `rig.impactAt`, so they land on the swing.

## Stack

`three` (rendering) · `postprocessing` (bloom, chromatic aberration, vignette) ·
`gsap` (camera and UI tweens) · `howler` (audio bus, music cross-fade) · `vite`.

`play.mjs` drives the game through Playwright for screenshots:

```bash
node play.mjs http://localhost:5173/ '[{"wait":9000},{"click":[450,260]},{"shot":"a.png"}]'
```

## Notes

The composer runs on an 8-bit frame buffer on purpose — a half-float buffer renders black
through ANGLE/D3D11 on the test machine.
