const SECONDARY = /Skirt|Cape|Cloth|Hair|Finger|Earring|Pad|Gem|Chain|Book|Key|Lock|Hat|Piece|Feather|Tail|Strap|Belt|Bag|Scarf|Ribbon|Tassel/i
const MOTION = { secondaryFull: true, secondary: SECONDARY, still: 0.0005, dropFloor: 0.25, vectorBits: 12, vectorTolerance: 0.002 }
const CLOSE = { ...MOTION, secondaryFull: true, fps: 30, secondaryFps: 15, bits: 11, secondaryBits: 10, tolerance: 0.005, secondaryTolerance: 0.015 }
const BATTLE = { ...MOTION, fps: 30, secondaryFps: 15, bits: 10, secondaryBits: 9, tolerance: 0.01, secondaryTolerance: 0.03 }
const CROWD = { ...MOTION, fps: 30, secondaryFps: 15, bits: 10, secondaryBits: 9, tolerance: 0.018, secondaryTolerance: 0.05 }
const HORDE = { ...CROWD, bits: 9, tolerance: 0.03, vectorTolerance: 0.004 }
const ANIM = { fps: 30, rotationBits: 12, translationBits: 14, constantRotation: 0.0006, constantValue: 0.0004, dropRest: true, anim: BATTLE }
export const ALPHA_QUALITY = 50
const MESH = { positionBits: 14, uvBits: 12, dropTangents: true, alphaQuality: ALPHA_QUALITY }
const CHARACTER = { ...ANIM, ...MESH, speed: 1, pruneJoints: true }

const SMALL = { positionBits: 12, uvBits: 10, uvFloatStep: 1 / 1024, texMax: 256, quality: 54, normalMax: 128, normalQuality: 40, dataMax: 128 }

export const GLB = [
  [/glb\/\w+_lob\.glb$/, {
    ...CHARACTER,
    keepClips: /^(Idle|IdleLOB|IntroLOB)$/,
    poseClips: /^Idle$/,
    anim: CLOSE,
    simplify: { total: 9500, error: 0.03, lockBorder: true, normalWeight: 0.4, minTriangles: 300 },
    positionBits: 13,
    uvBits: 11,
    uvFloatStep: 1 / 2048,
    texMax: 512,
    quality: 50,
    alphaQuality: 30,
    alphaFloor: 16,
    normalMax: 128,
    normalQuality: 44,
    imageRules: [[/Teeth/, { max: 64 }], [/Head|Hair/, { max: 256 }], [/Body_HiRes|Body_AlbedoAO$/, { max: 512, quality: 52 }], [/./, { max: 320 }]],
  }],
  [/glb\/(eld037|mag018|eld025)\.glb$/, { ...CHARACTER, ...SMALL, anim: { ...BATTLE, secondaryFull: true }, dropClips: /^(Shock|Freeze|Walk|Dash|Skill_3_PreCast|Skill_3_EndCast)$/ }],
  [/glb\/anim\w+\.glb$/, { ...CHARACTER, ...SMALL, texMax: 384, dropClips: /LOB|^Girl_anim$|^FX_A_/, imageRules: [[/VFX_AlbedoAO$/, { opaque: true }]] }],
  [/glb\/dem\d+\.glb$/, { ...CHARACTER, ...SMALL, anim: HORDE, quality: 50, normalMax: 0, keepClips: /^(Idle|Run|ComboAttack_\d+|Flinch|Death)$/ }],
  [/glb\/gia\d+\.glb$/, { ...CHARACTER, ...SMALL, anim: HORDE, quality: 50, normalMax: 0, keepClips: /^(Idle|Run|ComboAttack_1|Death|Skill_1_(PreCast|Cast|EndCast))$/ }],
  [/glb\/sakiel\.glb$/, { ...CHARACTER, ...SMALL, texMax: 256, dropClips: /LOB|^IdleBreak|^IdleIn$|^Walk$|^Dash$/ }],
  [/glb\/sakiel_wings\.glb$/, { ...CHARACTER, ...SMALL, pruneJoints: false }],
  [/glb\/loot\.glb$/, { ...MESH, ...SMALL, simplify: { total: 3500, error: 0.02, lockBorder: true, normalWeight: 0.4 }, imageRules: [[/T_Loot_Armor_BC$/, { opaque: true }]] }],
  [/glb\/fx_\w+\.glb$/, { ...CHARACTER, ...SMALL }],
  [/locations\/\w+\.glb$/, { ...MESH, positionBits: 12, uvBits: 12, uvSlack: 0.02, uvFloatStep: 1 / 512, texMax: 512, quality: 52, quality: 46, imageRules: [[/Main_final/, { max: 1024, quality: 44 }], [/Far_final/, { max: 512 }], [/Ground|Pattern|Elevator|Train|Gate|Sand/, { max: 512 }], [/./, { max: 256 }]] }],
]

const SOFT_ALPHA = { alpha_quality: 100, alpha_tolerance: 4 }
const VFX_READS_ALPHA = /vfx\/tex\/(T_FX_Mask_4_1_Liquid_copy|T_FX_Noise_40_1_P_2|T_FX_Noise_99_1|T_FX_Obj_Rocks_1_1_3x3_A|T_FX_Move_Click_1_1_A)\.webp$/

export const IMAGE = [
  [/glb\/tex\/(m\/)?T_LOB_\w+_MSES\.webp$/, { max: 256, quality: 52, subsampling: '4:4:4', ...SOFT_ALPHA }],
  [/glb\/tex\/T_ING_\w+_MSE\.webp$/, { max: 128, quality: 50, subsampling: '4:4:4' }],
  [/glb\/tex\/\w+_VFX(_HiRes)?\.webp$/, { max: 256, quality: 50, subsampling: '4:4:4' }],
  [/glb\/tex\/T_Loot_Armor_MOG\.webp$/, { max: 256, quality: 50, subsampling: '4:4:4' }],
  [/glb\/tex\//, { max: 256, quality: 52 }],
  [/vfx\/tex\/T_FX_Obj_Meteor_Red_1_1\.webp$/, { max: 128, quality: 40, alpha_binary: true }],
  [/vfx\/tex\/T_ING_ELD025_Weapon_Albedo\.webp$/, { max: 256, quality: 44, ...SOFT_ALPHA }],
  [VFX_READS_ALPHA, { max: 128, quality: 40, ...SOFT_ALPHA }],
  [/vfx\/tex\/T_FX_Flipbook/, { max: 384, quality: 46, opaque: true }],
  [/vfx\/tex\/\w*(Decal|Circle|Albedo|Logo)\w*\.webp$/, { max: 256, quality: 44, opaque: true }],
  [/vfx\/tex\//, { max: 128, quality: 40, opaque: true }],
  [/fx\/T_FX_(Decal|Circle)/, { max: 512, quality: 58 }],
  [/fx\/T_FX_(Obj_Bullet_1_1|Shape_5_1)\.webp$/, { max: 256, quality: 56, opaque: true }],
  [/fx\//, { max: 256, quality: 56 }],
  [/img\//, { max: 512, quality: 70, ...SOFT_ALPHA, exact: false }],
]

const HUD_SOFT = /(shadow|glow|gradient|title-back|background|hero-bg|tap-circle|press-circle|stick-base|stick-knob|flash|sweep|highlight|mask)-/

const HUD_OUTCOME = /(victory-band|defeat-band|play-now)-/
const HUD_BUTTON = /assets\/(button|retry-plate)-[\w-]{8}\.webp$/

export const HUD = [
  [HUD_OUTCOME, { max: 1024, quality: 78, ...SOFT_ALPHA, exact: false }],
  [HUD_BUTTON, { max: 1024, quality: 86, ...SOFT_ALPHA, exact: false }],
  [HUD_SOFT, { max: 1024, quality: 44, ...SOFT_ALPHA, alpha_tolerance: 2, exact: false }],
  [/./, { max: 1024, quality: 44, ...SOFT_ALPHA, exact: false }],
]

export const AUDIO = {
  rate: 22050,
  sfx: { codec: { kbps: 24 }, variants: 1, cap: 2, caps: [[/_intro$/, 8], [/^dem\d+_death$/, 1.8], [/^dem\d+_attack_\d+$/, 1.0], [/^dem\d+_/, 1.2], [/^gia\d+_skill_\d+$/, 1.45], [/^gia\d+_death$/, 1.6], [/^gia\d+_/, 1.0], [/_death$/, 2.8], [/_(morph|summon_vo|ult)$/, 3.4], [/^vo_|^ui_click_battle$/, 2.4]], floor: -44, gap: 0.03 },
  music: {
    music_lobby: { length: 1e9, loop: true, codec: { kbps: 24 } },
    music_battle: { length: 1e9, loop: true, codec: { kbps: 24 } },
    music_titan: { length: 17.5, fadeOut: 3, codec: { kbps: 24 } },
    music_endcard: { length: 15.78, loop: false, codec: { kbps: 24 } },
    music_victory: { length: 0.3, fadeOut: 0.3, gain: 0, codec: { kbps: 24 } },
    amb_battle: { length: 7.8, xfade: 1, loop: true, codec: { kbps: 20 } },
  },
  oneShot: { codec: { kbps: 24 } },
  aliases: { music_endcard: 'music_lobby' },
}

export function profileFor(table, file) {
  const hit = table.find(([pattern]) => pattern.test(file))
  return hit ? hit[1] : null
}
