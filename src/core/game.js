import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ChromaticAberrationEffect, FXAAEffect, DepthOfFieldEffect, HueSaturationEffect, BrightnessContrastEffect, BlendFunction } from 'postprocessing'
import gsap from 'gsap'

import { HEROES, TITANS, ENEMIES, WAVES } from '../data/heroes.js'
import { loadModelData, prefetchModel, buildModel, castBodyShadow, cullOffscreen, useOwnLook, useSharedLook, texturesReady, landingTime, strideSpeed } from './model.js'
import { Actor } from '../entities/actor.js'
import { buildArena, aimArenaCut, ARENA_RADIUS } from '../world/arena.js'
import { FX } from '../world/fx.js'
import { Showcase, standRadius } from '../world/showcase.js'
import { LobbyGradeEffect, FocusSharpenEffect, SanitizeEffect } from '../world/lobby-post.js'
import { Vfx } from '../world/vfx.js'
import { HeroFx, prefabRole, yawOf } from '../world/hero-fx.js'
import { MomentFx, MOMENT_FX } from '../world/moment-fx.js'
import { ARENA_GATES, DEFAULT_LOCATION } from '../data/locations.js'
import { loadCharacterLighting, tickCharacters, setLobbyView, CHARACTER_LIGHT, LOBBY_LIGHT, SHADOW_MODE, dissolveLook, resetDissolve } from '../world/character-shader.js'
import { DynamicLights } from '../world/lights.js'
import { Loot } from '../world/loot.js'
import { GuideLine } from '../world/guide-line.js'
import { SHADOW_MAP_SIZE, fitShadowToView } from '../world/shadow-fit.js'
import { audio, STEPS } from './audio.js'
import { Input } from './input.js'
import { Turntable } from './turntable.js'
import { Gear, ATK_PER_DMG, BUILD_PIECES, planDrops } from './gear.js'
import { BUILDS, POWER_GOAL, SET_NAME } from '../data/builds.js'
import { HIT_KINDS, ENEMY_HITS, SKILL_HITS } from '../data/hits.js'
import { UI } from '../ui/ui.js'
import { FloatText } from '../ui/float-text.js'
import { GEAR_TOP, ringHeroFit } from '../ui/gear-ring.js'
import { stream, seed } from './rng.js'
import { wireBus, sayOnce, sayProgress, openStore, stepDoor, tellState, bootMark } from '../net/bus.js'
import { trackRenderer, trackPartial, trackRunStart, trackRunEnd, trackRetry } from '../net/track.js'
import { prefetchProgress } from './fetch.js'
import { compileFor, primePrograms } from './compile.js'
import { ResolutionGovernor } from './governor.js'
import { view, safeInsets } from './viewport.js'
import { COARSE } from './tier.js'
import { prewarmObject, texturesOf, uploadTexturesNow } from './prewarm.js'
import { Lifecycle } from './lifecycle.js'

const random = stream('sim')
const rollRandom = stream('hit-roll')

const SKILL_SLOT = { s1: 0, s2: 1 }
const skillAnim = s => s.anim || SKILL_SLOT[s.key] + 1
const FIRST_WAVE_BANNER = 3.2
const GESTURE_HINT_DELAY = FIRST_WAVE_BANNER
const MOVE_HINT_TIME = 9
const AUTO_SKILLS = ['s1', 's2']
const AUTO_ATTACK_SLACK = 0.6
const AUTO_SKILL_SLACK = 0.5
const AUTO_ULT_SHARE = 0.6
const AUTO_SKILL_WAIT = 1
const AUTO_ULT_WAIT = 3
const AUTO_SKILL_PACK = 2
const AUTO_ULT_PACK = 3
const AUTO_ULT_LOW = 0.4
const _near = { e: null, d: 0 }
const GEAR_HINT_TIME = 4
const GEAR_OPEN_DELAY = 2.3
const SHIELD_CLOSE_DELAY = 0.9
const GEAR_SETTLE_WAIT = 420
const BANNER_GAP_MS = 80
const SET_BLAST_RADIUS = 4.5
const SET_BLAST_KNOCK = 2.2
const SET_BLAST_STUN = 0.5
const SET_CRITS = 3
const SET_SAY_GAP = 1.5
const HERO_NUMBER_GAP = 0.35
const HERO_NUMBER_MIN = 0.005
const HERO_NUMBER_LIFT = 1.15
const HERO_NUMBER_SCALE = 100
const HERO_NUMBER_STYLE = { color: '', fontSize: '' }
const LEECH_RATE = 0.012
const MORPH_SWAP = 0.45
const MORPH_CAMERA = 1.5
const SPAWN_RING = [7.5, 11]
const BLOOM_BASE = 0.45
const BLOOM_THRESHOLD = 0.9
const BATTLE_POST = {
  saturation: 0.12,
  contrast: 0.08,
  vignette: 0.45,
}
const LOBBY_POST = {
  bloom: 0.9,
  threshold: 0.64,
  saturation: 0.16,
  contrast: 0.1,
  vignette: 0.62,
  bokeh: 2.6,
  focusRange: 4.5,
  fadeOut: 0.55,
}
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _cutA = new THREE.Vector3()
const _cutB = new THREE.Vector3()
const _cutEye = new THREE.Vector3()
const _cutUp = new THREE.Vector3()
const _off = new THREE.Vector3()
const PORTRAIT_HFOV = THREE.MathUtils.degToRad(36)
const PORTRAIT_PITCH = THREE.MathUtils.degToRad(45)
const PORTRAIT_DIST = 0.46
const PORTRAIT_FAR_PITCH = THREE.MathUtils.degToRad(55)
const PORTRAIT_FAR_DIST = 1.4
const PHONE_LAND_FAR_DIST = 1.5
const PHONE_SHORT_SIDE = [480, 600]
const CLOSE_UP_DIST = 8
const BATTLE_YAW = Math.PI
const BATTLE_PITCH = THREE.MathUtils.degToRad(45)
const BATTLE_DIST = 23
const BATTLE_HFOV = THREE.MathUtils.degToRad(70)
const BATTLE_MAX_VFOV = 62
const BATTLE_LOOK_Y = 0.6
const BATTLE_ZOOM = 0.55
const BOSS_FIT_TOP = 0.54
const BOSS_BACK = 1.2
const BOSS_FIT_RATE = 1.6
const BOSS_FOCUS = 0.45
const BOSS_FOCUS_MAX = 5
const BOSS_LOOK = 0.3
const BOSS_PULL_MAX = 2.6
const TITAN_ZOOM_OUT = 1.2
const TITAN_CHARGE_TIME = 19
const TITAN_AUTO_DELAY = 1.2
const TITAN_OVERTIME = 1.5
const TITAN_DMG = 1.4
const TITAN_SMASH = 3
const TITAN_END_CALM = 3.6
const TITAN_END_GAP = 1.2
const TITAN_WAVE_CAP = 0.65
const TITAN_BOSS_WOUND = 0.3
const TITAN_BOSS_TRICKLE = 25
const TITAN_BOSS_DMG = 0.75
const TITAN_RESCUE = 0.3
const TITAN_RESCUE_DELAY = 0.25
const TITAN_HEAL = 0.3
const BOSS_TITAN_HOLD = 7
const TITAN_BORN_MIN = 0.5
const BOSS_SPAWN_DIST = 13
const BOSS_CAST_GAP = 1.4
const BOSS_RECOVER = 0.35
const BOSS_CAST_OVERRUN = 1.5
const BOSS_MIN_CAST_SPEED = 0.45
const BOSS_CHARGE_OVERSHOOT = 3
const BOSS_DASH_TIME = 0.32
const BOSS_HIT_SOUND = { hellfire: 'explosion_vfx_2', infernalCharge: 'dash' }
const BOSS_ENTRANCE_PAUSE = 0.8
const HERO_MIN_FADE = 0.08
const BOSS_MIN_FADE = 0.1
const BOSS_CHAIN_FADE = 0.1
const BOSS_RUN_FADE = 0.1
const BOSS_REST_FADE = 0.15
const BOSS_TURN = 2.4
const BOSS_RUN_TURN = 3.5
const BOSS_TURN_ACCEL = 9
const BOSS_SETTLE = 0.35
const BOSS_AIM = 0.3
const BOSS_WHEEL = 1.6
const BOSS_WHEEL_NEAR = 3
const BOSS_STILL = 0.05
const BOSS_SKILL_LEAD = 0.6
const BOSS_CHARGE_MIN = 22
const BOSS_CORPSE_HOLD = 1.6
const BOSS_SINK_TIME = 1.4
const DAMAGE_PHONE_SCALE = 0.95
const BOSS_SINK_DEPTH = 0.55
const ENEMY_MIN_FADE = 0.1
const ENEMY_CHAIN_FADE = 0.08
const ENEMY_TURN = 9
const ANIM_LOD_CROWD = 8
const ANIM_LOD_NEAR = 7
const ENEMY_AIM = 0.6
const ENEMY_HIT_FADE = 0.12
const ENEMY_REST_FADE = 0.25
const TURN_IN_PLACE = 1.6
const CHASE_SLACK = 0.5
const CHASE_FAR = 3
const ENEMY_REST_MIN = 0.5
const ENEMY_HIT_SLACK = 0.7
const SHOVE_SNAP = 0.3
const SHOVE_RATE = 10
const THAW_FRAMES = 3
const LEAP_LIFT = 0.92
const LEAP_LAND_CLIP = 'Skill_1_EndCast'
const LEAP_EDGE = 1.5
const INTRO_VOICE_LATE = 0.3
const LOOT_SHOWCASE = 1.1
const LOOT_VICTORY_WAIT = 3.6
const RUN_RATE = [0.6, 1.8]
const KNOCK = { hero: 0.5, titan: 1.2, shot: 1, bolt: 1.3 }
const KNOCK_RATE = 14
const MOB_POISE = 0.9
const HIT_SHAKE = { hero: 0.16, titan: 0.35 }
const LOOT_WARM_AT = new THREE.Vector3(0, -0.4, 0)
const LOOT_WARM_SCALE = 0.001
const GEAR_SLOWMO = 0.3
const GEAR_HERO_SHARE = 0.36
const GEAR_NEAREST = 0.12
const GEAR_FIT = 0.2
const GEAR_SMOOTH = 0.25
const GEAR_INTRO_SLOWMO = 0.04
const GEAR_INTRO_DELAY = 0.45
const GEAR_INTRO_PRAISE = 0.36
const GEAR_INTRO_CLOSE = 2.1
const WEAR_FLASH = 0xffe0a0
const WEAR_MUTE = new Set(['PS_G_Glow_1_2_Fade', 'PS_Star_1_1_ReUse', 'PS_Star_1_1_ReUse '])
const GEAR_CLEAR = 3.2
const GEAR_CLEAR_FRONT = 9
const GEAR_CLEAR_RATE = 8
const GEAR_ZONE_PUSH = 16
const GEAR_ZONE_PAD = 10
const GEAR_CHASE = 7
const GEAR_LOOK = 0.55
const GEAR_IN = 0.8
const GEAR_CUT_INSET = 3
const NO_CUT = 1e6
const GEAR_OUT = 0.16
const GEAR_BACK = 0.45
const HERO_TAP_PAD = 12
const HERO_TAP_WIDTH = 0.38
const MOVE_FX = 'move'
const CORPSE_MELT_START = 0.7
const CORPSE_MELT_TIME = 0.8
const CORPSE_SHADOW_OFF = 0.55
const GATES = ARENA_GATES[DEFAULT_LOCATION] || []
const ENTRY_GATES = 3
const ENTRY_BEHIND = 1.2
const ENTRY_INSET = 1
const ENTRY_INNER_MIN = 8
const ENTRY_LANE = 1.15
const ENTRY_START = 0.35
const ENTRY_GATE_STAGGER = 0.3
const ENTRY_STEP = 0.16
const ENTRY_STEP_JITTER = 0.08
const ENTRY_RUSH = 2.2
const ENTRY_RUSH_TIME = 2.2
const ENTRY_NEAR = 7
const ENTRY_MAX = 4
const ENTRY_CLOSE = 6
const ENTRY_BOSS_CLOSE = 16
const ENTRY_DIST_COST = 0.02
const ENTRY_PROGRESS = 0.02
const ENTRY_STALL = 0.35
const ENTRY_AIM_MAX = 1.2
const ENTRY_EASE = 5
const CAM_SAFE_NDC = 0.74
const CAM_SAFE_RIGHT_PORTRAIT = 0.56
const CAM_SAFE_BACK = 0.86
const CAM_SAFE_RATE = 2.5
const GATE_LOOK_TIME = 2.6
const GATE_LOOK_RATE = 2.4
const GATE_FOCUS = 0.6
const GATE_FOCUS_MAX = [4.6, 8.5]
const GATE_PULL = 0.38
const LOOT_FX = 'loot'
const LAZY_INPUT_QUIET_MS = 1200
const LAZY_POLL_MS = 250
const GUIDE_ARROW = 'T_FX_Move_Click_1_1_A'
const GUIDE_ENGAGE = 1.5
const GUIDE_RELEASE = 3.5
const GUIDE_LOOT_GAP = 0.5
const _guideAt = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _zero = new THREE.Vector3()
const ARENA_SHADOW_SPAN = 24
const ARENA_SHADOW = { near: 1, far: 90, bias: -0.0006, normalBias: 0.035, radius: { high: 4, low: 2 } }
const SELECT_SHADOW = { bias: -0.0005, normalBias: 0.012, depthPad: 2, radius: { high: 5, low: 3 } }
const SELECT_SHADOW_CENTER = new THREE.Vector3(0, 1, -0.4)
const SELECT_SHADOW_MIN = new THREE.Vector3(-4.5, -0.1, -1.9)
const SELECT_SHADOW_MAX = new THREE.Vector3(4.5, 2.9, 1.1)
const SELECT_SINGLE_SHADOW_REACH = 2.6
const _singleShadowMin = new THREE.Vector3()
const _singleShadowMax = new THREE.Vector3()
const KEY_DISTANCE = 40
const _lightBasis = new THREE.Matrix4()
const _corner = new THREE.Vector3()
const _casters = []
const SELECT_VIEW_DIR = new THREE.Vector3(0, 3.1, 8.0).normalize()
const SELECT_HERO_Z = -0.4
const SELECT_HERO_TOP = 2.6
const SELECT_HERO_HALF = 2.15
const SELECT_POSE_TOP = 2.3
const SELECT_POSE_GAP = 0.012
const SELECT_POSE_EDGE = 0.955
const SELECT_POSE_NEAREST = 2.6
const SELECT_POSE_EDGE_FALLBACK = [[SELECT_HERO_HALF, 1, 0], [-SELECT_HERO_HALF, 1, 0]]
const SELECT_SPACING = 4.2
const SELECT_SPACING_MARGIN = 0.6
const SELECT_GLIDE_DONE = 0.05
const SELECT_EDGE = 0.96
const SELECT_CARD_LIFT = 14
const INTRO_IN = 0.2
const INTRO_EXIT = 0.85
const INTRO_BLEND = 0.8
const INTRO_OUT = 0.3
const IDLE_BREAK_IN = 0.2
const IDLE_BREAK_GAP = [7, 11]
const SELECT_CAM_SMOOTH = 0.45
const ORBIT_SETTLE = 6
const ORBIT_SOLO = 0.35
const HERO_LIGHT_BACK = 1.7
const HERO_HEIGHT = 2.04
const HERO_RADIUS = 0.74
const MOB_SCALE = 1.15
const SHADOWLESS = ['vfx', 'fx', 'loot', 'showcase', 'guide']
const MOB_SIZES = Object.values(ENEMIES).filter(d => !d.boss).map(d => d.size || 1)
const MOB_HP_POW = 1.5
const MOB_ARMOR_POW = 0.3
const MOB_DMG_POW = 1.2
const MOB_SPEED_POW = -0.35
const MOB_RATE_POW = 0.5
const HIT_ROLL = 0.07
const WAVE_HP = [0.72, 1.65]
const WAVE_DMG = [0.85, 1.85]
const BOSS_MIGHT = 3.3
const ELITE_SIZE = 1.5
const ULT_CHARGE = 0.000625
const HIT_STOP = { basic: 38, ranged: 22, skill: 70, ult: 110, titan: 60, morph: 90 }
const CRIT_STOP = 75
const KILL_STOP = 55
const HEAVY_STOP = 60
const STOP_GAP = 110
const STOP_SCALE = 0.06
const KILL_KNOCK = { basic: 1.4, heavy: 2.2 }
const KILL_OVERKILL_MAX = 1.2
const CRIT_KNOCK = 1.7
const CRIT_SHAKE = 0.3
const NUMBER_GROW = 0.4
const NUMBER_SIZE = [0.85, 2.1]
const CRIT_NUMBER = 1.3
const meanPow = p => MOB_SIZES.reduce((sum, k) => sum + k ** p, 0) / MOB_SIZES.length
const MOB_HP_NORM = meanPow(MOB_HP_POW + MOB_ARMOR_POW)
const MOB_DMG_NORM = meanPow(MOB_DMG_POW - MOB_RATE_POW)
const mobCost = k => k ** (MOB_HP_POW + MOB_ARMOR_POW) / MOB_HP_NORM
const mobHit = k => k ** MOB_DMG_POW / MOB_DMG_NORM
const PACK_SPAN = 2
const PACK_SPREAD = 0.6
const CONFIRM_TIME = 0.55
const CONFIRM_PUSH = 0.8
const SETTLE_FRAME_MS = 26
const SETTLE_CALM_FRAMES = 6
const SETTLE_MAX_MS = 1400
const LOBBY_SOUND_FADE = 350
const SHIELD_HIT_MULT = 2.2
const DOT_FLASH = 0.1
const STATUS_GAP = 1.4
const STATUS_LIFT = 1.65
const HERO_KNOCK_TITAN = 0.4
const BOSS_HIT_CHROMA = 1.8
const BOSS_STRIKE = [1, 1.15, 1.45]
const BOSS_SWINGS = [
  { arc: 0.9, radius: 9.5, ahead: 0, dmg: 0.7 },
  { arc: Math.PI, radius: 5.5, ahead: 4.5, dmg: 2.4 },
  { arc: 1.3, radius: 9, ahead: 0, dmg: 1.4 },
]
const ELITE_SWING = { arc: 1, radius: 0, ahead: 0, dmg: 1 }
const ELITE_SWING_SPEED = 0.7
const DODGE_REACH = 3
const BOSS_HIT_CAP = 0.3
const HERO_PUSH_MAX = 7
const BOSS_AOE_REACH = 7.5
const BOSS_STRIKE_REACH = 32
const BOSS_STRIKE_SHAKE = 0.3
const BOSS_STRIKE_FLASH = 0xff6a1a
const BOSS_LAND_SHAKE = 0.75
const BOSS_LAND_STOP = 95
const BOSS_FINISH_PUSH = 4
const BOSS_SKILL_STOP = 130
const BOSS_STEP_SHAKE = 0.1
const BOSS_STEP_REACH = 28
const WEAK_HURT = 1.6
const WEAK_DEAL = 0.45
const WEAK_WARN = 0.08
const WEAK_WARN_GAP = 8
const WEAK_EASE = 0.6
const WEAK_GRACE = 5
const WEAK_SPAN_MIN = 1200
const IMMUNE_TEXT_GAP = 0.45
const GATE_WARN_DELAY = 2.1
const DEFEAT_REASON_DELAY = 2.4
const STATE_KEYS = { KeyV: 'victory', KeyD: 'defeat', KeyR: 'restart' }
const RETRY_DELAY = 160
const BOOT_PROGRESS = { fetch: 0.8, parse: 0.15 }
const SELECT_TEXTURE_WAIT = 4000
const PIXEL_BUDGET = { low: 1e6, high: 3.7e6 }
const MOBILE_MIN_RATIO = 1
const BLOOM_LEVELS = { low: 6, high: 8 }
const BUSY_STATES = new Set(['attack', 'attack2', 'cast', 'morph', 'unmorph', 'roar'])
const LAYERED_STATES = new Set(['attack', 'attack2', 'cast'])
const WINDUP_STATES = LAYERED_STATES
const TWIST_MAX = 1.45
const _axis = [0, 0]
const _still = [0, 0]
const NO_OPTS = {}
const TITAN_SWING = { slot: 'titan_swing', max: 2, steal: true }
const _camVel = new THREE.Vector3()
const _selectPose = new THREE.Vector3()
const _selectPoseGoal = new THREE.Vector3()
const _selectPoseVel = new THREE.Vector3()
const _dampA = new THREE.Vector3()
const _dampB = new THREE.Vector3()

function hitWorth(mods) {
  return mods.atk * (1 + mods.crit * (mods.critMult - 1))
}

function gainPct(now, was) {
  return Math.round((now / was - 1) * 100)
}

function smoothDamp(current, target, velocity, smoothTime, dt) {
  const omega = 2 / smoothTime
  const x = omega * dt
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  _dampA.copy(current).sub(target)
  _dampB.copy(_dampA).multiplyScalar(omega).add(velocity).multiplyScalar(dt)
  velocity.addScaledVector(_dampB, -omega).multiplyScalar(k)
  current.copy(target).add(_dampA.add(_dampB).multiplyScalar(k))
}

function swingShape() {
  return { center: new THREE.Vector3(), yaw: 0, radius: 0, arc: Math.PI, width: 0, length: 0, dmg: 1, warn: null }
}

function readySkill(e, d) {
  const skills = e.def.skills
  for (let i = 0; i < skills.length; i++) {
    const k = skills[i]
    if (e.skillCd[k.key] <= 0 && d <= k.reach && d >= (k.min || 0)) return k
  }
  return null
}

function skillSoon(e, d, lead) {
  if (e.castGap > lead) return null
  const skills = e.def.skills
  for (let i = 0; i < skills.length; i++) {
    const k = skills[i]
    if (e.skillCd[k.key] <= lead && d <= k.reach && d >= (k.min || 0)) return k
  }
  return null
}

function stepCrossed(times, prev, t) {
  for (let i = 0; i < times.length; i++) {
    const s = times[i]
    if (t >= prev ? s > prev && s <= t : s > prev || s <= t) return true
  }
  return false
}

function anyAlive(actors) {
  for (let i = 0; i < actors.length; i++) if (!actors[i].dead) return true
  return false
}
const _fitCam = new THREE.PerspectiveCamera()
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a))
const HAPTIC_MS = 12

function haptic(ms = HAPTIC_MS) {
  if (!navigator.vibrate) return
  try { navigator.vibrate(ms) } catch {}
}

function enemyPeak(def, plan) {
  let peak = 1
  for (const packs of plan) {
    let n = 0
    for (const p of packs) if (ENEMIES[p.type] === def) n += p.count
    peak = Math.max(peak, n)
  }
  return peak
}

function enemyModel(def) {
  return loadModelData(def.model)
}

function settled(promise) {
  return Promise.race([promise, null]).catch(() => null)
}

function soundCode(def) {
  return def.sfx || def.model
}

function bisect(lo, hi, goHigher) {
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (goHigher(mid)) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.ui = new UI('ui')
    this.turntable = new Turntable(this.ui.select)
    this.floats = new FloatText(this.ui.root)
    this.state = 'boot'
    this.t = 0
    this.timeScale = 1
    this.enemies = []
    this.pending = []
    this.spawning = 0
    this.waveIndex = 0
    this.titan = 0
    this.titanReady = false
    this.titanMode = false
    this.titanT = 0
    this.ult = 0
    this.ultReady = false
    this.kills = 0
    this.lootWait = 0
    this.gearK = 0
    this.gearBack = 0
    this.heroCut = new THREE.Plane(new THREE.Vector3(0, 1, 0), NO_CUT)
    this.heroCuts = [this.heroCut]
    this.gearT = 0
    this.gearTo = 0
    this.dots = []
    this.dotPool = []
    this.statusAt = {}
    this.gearDist = 1
    this.gearSlow = GEAR_SLOWMO
    this.gearIntro = null
    this.dmgNodes = []
    this.shakeT = 0
    this.shakeAmp = 0
    this.heroIndex = 0
    this.cooldowns = { s1: 0, s2: 0, attack: 0 }
    this.readyAt = { s1: 0, s2: 0 }
    this.ultReadyAt = 0
    this.selectActors = []
    this.modelSpares = new Map()
    this.lazyQueue = []
    this.lazyDone = new Set()
    this.lazyBusy = false
    this.lastInputAt = 0
    this.warmedModels = new WeakSet()
    this.fxWarms = new Map()
    this.warmedFx = new Set()
    this.renderHold = 0
    this.revealing = null
    this.hintTimers = []
    this.heroCueOn = false
    this.setupRenderer()
    this.input = new Input()
    this.input.attachStick(this.ui.stick)
    this.input.onTap = (x, y) => {
      if (this.tapOnHero(x, y)) this.toggleGear()
      else if (this.gearOpen) this.closeGear()
    }
    this.input.onSteer = () => {
      if (this.gearOpen) this.closeGear()
      if (!this.steered) this.finishMoveHint()
    }
    this.epoch = 0
    this.benched = false
    this.bindUI()
    this.wireHost()
    bootMark('module')
  }

  wireHost() {
    wireBus({
      start: () => this.bench(false),
      pause: () => this.bench(true),
      resume: () => this.bench(false),
      hold: () => this.bench(true),
      audio: on => audio.silence('volume', !on),
    })
    trackPartial(() => this.runStats())
    tellState(() => {
      const h = this.hero
      return {
        seed: seed(),
        time: this.t,
        mode: this.state,
        wave: this.waveIndex,
        hp: h ? h.hp : 0,
        x: h ? h.pos.x : 0,
        z: h ? h.pos.z : 0,
        foes: this.enemies.filter(e => !e.dead).length,
        kills: this.kills,
        titan: this.titanMode,
        power: this.gear ? this.gear.power() : 0,
      }
    })
  }

  bench(on) {
    this.benched = on
    audio.silence('host', on)
    if (!on) this.lifecycle.wake()
  }

  setupRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    r.debug.checkShaderErrors = !import.meta.env.PROD
    this.contextLost = false
    this.lifecycle = new Lifecycle(this)
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    r.localClippingEnabled = true
    this.renderer = r
    trackRenderer(r)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x070c1a, 0.018)

    this.camera = new THREE.PerspectiveCamera(46, view.w / view.h, 0.4, 220)
    this.camera.position.set(0, 13, 13)
    this.camera.lookAt(0, 1.2, 0)
    this.camOffset = new THREE.Vector3(0, 7.8, 7.4)
    this.camLook = new THREE.Vector3(0, 1.3, 0)
    this.bossPull = 1
    this.bossView = 0
    this.gateView = 0
    this.gateLookT = 0
    this.gateIndex = -1
    this.waveGates = []
    this.rerouteK = 0
    this.camSafe = 1
    this.camSafeWant = 1
    this.gateSafe = 1
    this.gateSafeWant = 1
    this.gateAt = new THREE.Vector3()
    this.camTarget = new THREE.Vector3()
    this.camYaw = 0
    this.selectOrbit = 0
    this.orbitHome = false
    this.selectFit = null
    this.battleView = false
    this.fitCamera()

    const gl = r.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''
    const soft = /swiftshader|llvmpipe|software|basic render/i.test(gpu)
    this.softGPU = soft
    this.gpuName = gpu
    this.quality = soft || COARSE ? 'low' : 'high'
    this.setupResolution(COARSE)
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    SHADOW_MODE.projected = false
    this.composer = new EffectComposer(r)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new BloomEffect({
      intensity: BLOOM_BASE,
      luminanceThreshold: BLOOM_THRESHOLD,
      luminanceSmoothing: 0.08,
      mipmapBlur: true,
      radius: 0.5,
      levels: BLOOM_LEVELS[this.quality],
    })
    if (this.quality === 'low') this.bloom.luminancePass.resolution.scale = 0.5
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0004, 0.0004) })
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: BATTLE_POST.vignette })
    this.battleGrade = new HueSaturationEffect({ saturation: BATTLE_POST.saturation })
    this.battleContrast = new BrightnessContrastEffect({ contrast: BATTLE_POST.contrast })
    this.battlePasses = []
    if (this.quality === 'high') this.battlePasses.push(new EffectPass(this.camera, new FXAAEffect()))
    this.battlePass = new EffectPass(this.camera, this.bloom, this.battleGrade, this.battleContrast, this.vignette, new SanitizeEffect())
    this.battlePasses.push(this.battlePass)
    for (const p of this.battlePasses) this.composer.addPass(p)
    this.buildLobbyPost()

    addEventListener('resize', () => {
      this.resize()
      this.render()
    })
  }

  setupResolution(coarse) {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const floor = Math.min(1, dpr)
    const fit = Math.sqrt(PIXEL_BUDGET[this.quality] / (view.w * view.h))
    const start = clamp(Math.min(dpr, fit), floor, dpr)
    this.governor = new ResolutionGovernor({ start, min: coarse ? Math.min(floor, MOBILE_MIN_RATIO) : floor, max: coarse ? start : dpr })
    this.renderer.setPixelRatio(start)
    this.renderer.setSize(view.w, view.h)
  }

  buildLobbyPost() {
    const cam = this.camera
    this.lobbyBloom = new BloomEffect({
      intensity: LOBBY_POST.bloom,
      luminanceThreshold: LOBBY_POST.threshold,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.82,
      levels: BLOOM_LEVELS[this.quality],
    })
    if (this.quality === 'low') this.lobbyBloom.luminancePass.resolution.scale = 0.5
    this.lobbySat = new HueSaturationEffect({ saturation: LOBBY_POST.saturation })
    this.lobbyContrast = new BrightnessContrastEffect({ contrast: LOBBY_POST.contrast })
    this.lobbyVignette = new VignetteEffect({ offset: 0.3, darkness: LOBBY_POST.vignette })
    this.lobbyGrade = new LobbyGradeEffect()
    this.lobbySharpen = new FocusSharpenEffect()
    const effects = [this.lobbySharpen, this.lobbyGrade, this.lobbyBloom, this.lobbySat, this.lobbyContrast, this.lobbyVignette, new SanitizeEffect()]
    this.lobbyPasses = []
    if (!this.softGPU && this.quality === 'high') {
      this.lobbyDof = new DepthOfFieldEffect(cam, { focusDistance: 8, focusRange: LOBBY_POST.focusRange, bokehScale: LOBBY_POST.bokeh, resolutionScale: 0.5 })
      this.lobbyDof.target = new THREE.Vector3()
      effects.unshift(this.lobbyDof)
      this.lobbyPasses.push(new EffectPass(cam, new FXAAEffect()))
    }
    const lobbyPass = new EffectPass(cam, ...effects)
    lobbyPass.dithering = true
    this.lobbyPasses.push(lobbyPass)
    for (const p of this.lobbyPasses) this.composer.addPass(p)
    this.battlePass.renderToScreen = true
    lobbyPass.renderToScreen = true
    this.lobbyMix = { k: 1 }
    this.switchPost(false)
  }

  switchPost(lobby) {
    for (const p of this.battlePasses) p.enabled = !lobby
    for (const p of this.lobbyPasses) p.enabled = lobby
  }

  mixLobbyPost(k) {
    this.lobbyBloom.intensity = THREE.MathUtils.lerp(BLOOM_BASE, LOBBY_POST.bloom, k)
    this.lobbyBloom.luminanceMaterial.threshold = THREE.MathUtils.lerp(BLOOM_THRESHOLD, LOBBY_POST.threshold, k)
    this.lobbySat.saturation = LOBBY_POST.saturation * k
    this.lobbyContrast.contrast = LOBBY_POST.contrast * k
    this.lobbyVignette.darkness = LOBBY_POST.vignette * k
    this.lobbyGrade.mix = k
    this.lobbySharpen.mix = k
    if (this.lobbyDof) this.lobbyDof.bokehScale = LOBBY_POST.bokeh * k
  }

  setLobbyPost(on) {
    gsap.killTweensOf(this.lobbyMix)
    if (on) {
      this.lobbyMix.k = 1
      this.mixLobbyPost(1)
      this.switchPost(true)
      return
    }
    gsap.to(this.lobbyMix, {
      k: 0,
      duration: LOBBY_POST.fadeOut,
      ease: 'power2.in',
      onUpdate: () => this.mixLobbyPost(this.lobbyMix.k),
      onComplete: () => this.switchPost(false),
    })
  }

  focusLobby(actor) {
    if (!actor) return
    _v.set(actor.pos.x, actor.pos.y + 1.1, actor.pos.z)
    this.lobbyGrade.focus = this.lobbySharpen.focus = this.camera.position.distanceTo(_v)
    if (this.lobbyDof) this.lobbyDof.target.copy(_v)
  }

  resize(ease = false) {
    this.camera.aspect = view.w / view.h
    this.fitCamera()
    this.renderer.setSize(view.w, view.h)
    this.composer.setSize(view.w, view.h)
    if (this.ui.cardEls) this.ui.selectCard(this.heroIndex)
    if (this.state === 'select') this.fitSelectCamera(ease)
    this.syncSelectSkins()
  }

  bindUI() {
    this.ui.end.querySelector('#cta').addEventListener('click', () => {
      audio.play('ui_click_main')
      openStore('end')
    })
    for (const store of this.ui.end.querySelectorAll('.store')) {
      store.addEventListener('click', () => {
        audio.play('ui_click_main')
        openStore('end-store')
      })
    }
    this.ui.end.querySelector('.replay').addEventListener('click', () => this.retry())
    this.ui.powerGoal.addEventListener('click', () => {
      if (this.state !== 'battle' || !this.hero || this.hero.dead || !this.gear) return
      haptic()
      this.toggleGear()
    })
    this.ui.onSkill = key => {
      if (this.state !== 'battle' || this.gearOpen || !this.hero || this.hero.dead) return
      if (this.heroWindup() && this.castReady(key)) {
        this.queuedCast = key
        haptic()
        return
      }
      if (this.castNow(key)) haptic()
    }
    this.ui.gearRing.onClose = () => this.closeGear()
    this.ui.gearRing.onChange = kind => {
      audio.play(kind === 'filter' ? 'ui_click_tab' : kind === 'unequip' ? 'ui_click_back' : 'ui_click_add')
      if (kind !== 'filter') this.applyGear()
      if ((kind === 'equip' || kind === 'auto') && this.gearIntro) this.finishGearIntro()
    }
    this.ui.gearRing.onWear = item => this.wearFx(item)
    addEventListener('keydown', e => {
      if (e.code === 'Escape' && this.gearOpen) this.closeGear()
      if (STATE_KEYS[e.code]) this.stateKey(STATE_KEYS[e.code])
    })
    this.ui.outcome.onCta = () => {
      audio.play('outcome_cta')
      openStore('outcome')
    }
  }

  async boot() {
    const fonts = ['400 20px Hitzone', '500 20px Hitzone', '20px "Hitzone Med"', '20px "Montserrat It"']
    const fontsReady = Promise.all(fonts.map(f => document.fonts?.load(f).catch(() => {})))
    addEventListener('pointerdown', () => { this.lastInputAt = performance.now() }, { capture: true, passive: true })
    audio.probe()
    const lobbyIds = [...new Set(HEROES.map(h => h.lobby || h.model))]
    const total = lobbyIds.length + 1
    let done = 0
    let booting = true
    const advance = () => { done++ }
    const showProgress = () => {
      if (!booting) return
      this.ui.progress(BOOT_PROGRESS.fetch * prefetchProgress() + BOOT_PROGRESS.parse * (done / total))
      requestAnimationFrame(showProgress)
    }
    showProgress()
    const arenaReady = buildArena(this.scene).then(async arena => {
      this.arena = arena
      await loadCharacterLighting(arena.id)
      advance()
    })
    const lobbyReady = lobbyIds.map(id => loadModelData(id).then(advance))
    this.fx = new FX(this.scene)
    this.lights = new DynamicLights()
    this.vfx = new Vfx(this.scene)
    this.heroFx = new HeroFx(this.vfx, this.camera)
    this.heroFx.onSpawn = (name, pos) => audio.emit(name, pos)
    this.moments = new MomentFx(this.vfx, this.camera)
    this.loot = new Loot(this.scene, this.vfx, this.camera)
    this.loot.onCollect = item => this.collectLoot(item)
    this.guide = new GuideLine(this.scene)
    this.skipShadowWalk()
    for (const h of HEROES) {
      if (h.skinMute) this.heroFx.muteSkin(h.vfx, h.skinMute)
      if (h.lobbyMute) this.heroFx.muteLobby(h.vfx, h.lobbyMute)
      if (h.castMute) this.heroFx.muteCast(h.vfx, h.castMute)
      if (h.lobbyFocus) this.heroFx.focusLobby(h.vfx, h.lobbyFocus)
    }
    for (const e of Object.values(ENEMIES)) {
      if (e.skinMute) this.heroFx.muteSkin(e.vfx, e.skinMute)
      if (e.castMute) this.heroFx.muteCast(e.vfx, e.castMute)
    }
    await new Promise(r => requestAnimationFrame(r))
    this.warmPost()
    audio.prime()
    await Promise.all([arenaReady, ...lobbyReady])
    bootMark('models')
    this.setupLights()
    await Promise.all([audio.init(), Promise.race([fontsReady, new Promise(r => setTimeout(r, 3000))])])
    bootMark('audio')
    booting = false
    this.ui.progress(BOOT_PROGRESS.fetch + BOOT_PROGRESS.parse)
    this.ui.release()
    this.selectWarm = this.warmSelect().catch(e => console.warn('select warm-up', e))
    this.backgroundLoad = this.selectWarm.then(() => this.loadInBackground())
    this.renderHold++
    this.bootHold = true
    this.loop()
    this.enterSelect()
  }

  warmPost() {
    for (const lobby of [true, false]) {
      this.switchPost(lobby)
      this.composer.render()
    }
  }

  async warmSelect() {
    await this.prepareSelect()
    await this.compileScene()
    bootMark('compiled')
    await Promise.race([texturesReady(), new Promise(r => setTimeout(r, SELECT_TEXTURE_WAIT))])
    audio.fetchBoot()
    await new Promise(r => requestAnimationFrame(r))
    this.composer.render()
    bootMark('warm')
  }

  quiet() {
    return this.revealing || Promise.resolve()
  }

  async calm() {
    for (;;) {
      await this.quiet()
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
      if (this.state !== 'select') return
      const busy = this.selectActors.some(a => a.rig.state === 'intro') || performance.now() - this.lastInputAt < LAZY_INPUT_QUIET_MS
      if (!busy) return
      await new Promise(r => setTimeout(r, LAZY_POLL_MS))
    }
  }

  async loadInBackground() {
    const nextFrame = () => new Promise(r => requestAnimationFrame(r))
    const vfxIds = [...new Set([HEROES[this.heroIndex], ...HEROES].map(h => h.vfx).filter(Boolean))]
    for (const id of vfxIds) {
      await this.quiet()
      await this.vfx.preload([id])
      await nextFrame()
    }
    await this.quiet()
    await this.vfx.warm(this.renderer, this.camera, { names: this.lobbyFxNames(), target: this.composer.inputBuffer, onlyNamed: true, pause: nextFrame })
    await this.warmLobbySpawns(nextFrame)
    this.syncSelectSkins()
    this.want(this.battleJobs(HEROES[this.heroIndex]))
    this.want(HEROES.map(h => [`bytes:${h.model}`, () => prefetchModel(h.model)]))
  }

  battleJobs(hero) {
    const titan = TITANS[hero.titan]
    const enemyVfx = [...new Set(this.enemyDefs().map(def => def.vfx).filter(Boolean))]
    const model = (key, load) => [key, gentle => load().then(data => gentle && this.warmModel(data))]
    const fx = (id, load) => [`vfx:${id}`, gentle => load().then(() => gentle && this.warmFxLibs([id], () => this.calm()))]
    return [
      model(`model:${hero.model}`, () => loadModelData(hero.model)),
      hero.vfx && fx(hero.vfx, () => this.vfx.preload([hero.vfx]).then(() => this.heroFx.preloadModels(hero.vfx))),
      titan && model(`model:${titan.model}`, () => loadModelData(titan.model)),
      titan && titan.vfx && fx(titan.vfx, () => this.vfx.preload([titan.vfx])),
      ['sounds', () => this.fetchLaterSounds()],
      ...this.enemyDefs().map(def => model(`enemy:${def.model}`, () => enemyModel(def))),
      ...enemyVfx.map(id => fx(id, () => this.vfx.preload([id]))),
      fx(LOOT_FX, () => this.loadLoot()),
      fx(MOVE_FX, () => this.vfx.preload([MOVE_FX])),
      fx(MOMENT_FX, () => this.vfx.preload([MOMENT_FX])),
    ].filter(Boolean)
  }

  async warmModel(data) {
    if (!data || this.warmedModels.has(data)) return
    this.warmedModels.add(data)
    await this.calm()
    const model = this.takeModel(data)
    await this.calm()
    await prewarmObject(this.renderer, model.root, this.camera, this.scene, this.composer.inputBuffer, () => this.calm())
    this.spareModel(model)
  }

  warmFxLibs(ids, pause = null) {
    const fresh = ids.filter(id => id && !this.fxWarms.has(id) && this.vfx.library(id))
    if (fresh.length) {
      const names = this.loot.fxNames()
      const job = this.vfx.warm(this.renderer, this.camera, { names, target: this.composer.inputBuffer, libs: fresh, pause })
      fresh.forEach(id => this.fxWarms.set(id, job))
    }
    return Promise.all(ids.map(id => this.fxWarms.get(id)))
  }

  fetchLaterSounds() {
    audio.fetch(['music_battle', 'amb_battle', 'common', 'enemies'])
    audio.fetchSfx()
    audio.fetch(['music_titan', 'music_victory', 'music_endcard'])
  }

  loadLoot() {
    if (!this.lootLoad) this.lootLoad = this.loot.load()
    return this.lootLoad
  }

  want(jobs, first = false) {
    if (this.state !== 'select' || this.confirming) return
    const fresh = jobs.filter(([key]) => !this.lazyDone.has(key))
    const keys = new Set(fresh.map(([key]) => key))
    const rest = this.lazyQueue.filter(([key]) => !keys.has(key))
    this.lazyQueue = first ? [...fresh, ...rest] : [...rest, ...fresh]
    this.pumpLazy()
  }

  async pumpLazy() {
    if (this.lazyBusy) return
    this.lazyBusy = true
    while (this.lazyQueue.length) {
      await this.calm()
      const job = this.lazyQueue.shift()
      if (!job) break
      this.lazyDone.add(job[0])
      await Promise.resolve(job[1](true)).catch(e => console.warn('lazy load', job[0], e))
    }
    this.lazyBusy = false
  }

  loadBattle(hero) {
    this.lazyQueue = []
    return Promise.all(this.battleJobs(hero).map(([key, run]) => {
      this.lazyDone.add(key)
      return Promise.resolve(run(false)).catch(e => console.warn('battle load', key, e))
    }))
  }

  tapOnHero(x, y) {
    const h = this.hero
    if (this.state !== 'battle' || !h || h.dead || !this.gear) return false
    _v.set(h.pos.x, h.pos.y, h.pos.z).project(this.camera)
    const footX = (_v.x * 0.5 + 0.5) * view.w
    const footY = (-_v.y * 0.5 + 0.5) * view.h
    _v.set(h.pos.x, h.pos.y + h.height, h.pos.z).project(this.camera)
    const headX = (_v.x * 0.5 + 0.5) * view.w
    const headY = (-_v.y * 0.5 + 0.5) * view.h
    const half = Math.max(30, (footY - headY) * HERO_TAP_WIDTH)
    return Math.abs(x - (footX + headX) / 2) <= half && y >= headY - HERO_TAP_PAD && y <= footY + HERO_TAP_PAD
  }

  toggleGear() {
    if (this.gearOpen) this.closeGear()
    else this.openGear()
  }

  openGear(intro = null) {
    if (this.gearOpen) return
    this.gearOpen = true
    if (!this.setPending) this.setAtOpen = this.setLive
    if (this.gear.items.length) this.gearHinted = true
    this.gearIntro = intro
    this.gearSlow = intro ? GEAR_INTRO_SLOWMO : GEAR_SLOWMO
    this.gearPower = this.gear.power()
    this.gearFrom = this.gear.modifiers()
    this.input.release()
    this.queuedCast = null
    this.cancelLeaps()
    this.cueHero(false)
    audio.play('ui_expand_in')
    this.gearSpan = null
    if (!this.heroLocked() && !this.heroWindup()) this.hero.rig.play('idle', { force: true, fade: 0.2 })
    this.gearWant = this.gearHeroSpan()
    const span = this.placeGear()
    if (this.gearK < 0.01) this.gearDist = clamp(span / this.gearWant, GEAR_NEAREST, 1)
    this.ui.openGear(this.gear, intro)
    if (!intro && this.underpowered() && this.gear.bestPower() >= POWER_GOAL) this.ui.gearRing.cueAuto(true)
    this.gearTo = 1
  }

  gearHeroSpan() {
    const safe = safeInsets()
    return Math.min(view.h * GEAR_HERO_SHARE, ringHeroFit(view.w - safe.l - safe.r, this.ui.hudScale))
  }

  canIntroGear() {
    const boss = !!(WAVES[this.waveIndex] && WAVES[this.waveIndex].boss)
    return this.state === 'battle' && !boss && !this.gearOpen && !this.titanMode && !!this.hero && !this.hero.dead && !this.heroLocked()
  }

  introGear(item) {
    this.gearHinted = true
    const epoch = this.epoch
    setTimeout(() => {
      if (epoch !== this.epoch) return
      if (!this.canIntroGear() || !this.gear.items.includes(item)) {
        this.gearHinted = false
        return
      }
      this.openGear(item)
    }, GEAR_INTRO_DELAY * 1000)
  }

  finishGearIntro() {
    this.gearIntro = null
    const gain = (this.gear.power() - this.gearPower).toLocaleString('en-US')
    const dmg = gainPct(hitWorth(this.gear.modifiers()), hitWorth(this.gearFrom))
    const epoch = this.epoch
    setTimeout(() => {
      if (epoch !== this.epoch || !this.gearOpen) return
      if (dmg > 0) this.ui.gearRing.coach(`+${dmg}% DAMAGE`, `+${gain} power · tap your hero anytime to equip`)
      else this.ui.gearRing.coach(`+${gain} POWER`, 'tap your hero anytime to equip')
    }, GEAR_INTRO_PRAISE * 1000)
    setTimeout(() => {
      if (epoch === this.epoch && this.gearOpen && !this.gearIntro) this.closeGear()
    }, GEAR_INTRO_CLOSE * 1000)
  }

  wearFx(item) {
    const h = this.hero
    if (!h || h.dead || this.state !== 'battle') return
    const cfg = this.loot.config
    if (cfg && cfg.hit) this.vfx.spawn('loot', cfg.hit, { follow: this.lootAnchor(), lifetime: 1.2, mute: WEAR_MUTE })
    this.lights.flash(h.pos, WEAR_FLASH, 1.3, 4.5, 0.45, h.height * 0.6)
    audio.play('loot_take', { slot: 'loot_take', max: 2, gap: 0.06 })
    haptic()
  }

  placeGear() {
    const h = this.hero
    if (!h) return 0
    this.camera.updateMatrixWorld()
    _v.set(h.pos.x, h.pos.y, h.pos.z).project(this.camera)
    const footX = (_v.x * 0.5 + 0.5) * view.w
    const bottom = (-_v.y * 0.5 + 0.5) * view.h
    _v2.set(h.pos.x, h.pos.y + h.height * GEAR_TOP, h.pos.z).project(this.camera)
    const x = (footX + (_v2.x * 0.5 + 0.5) * view.w) / 2
    const top = (-_v2.y * 0.5 + 0.5) * view.h
    if (this.gearOpen && this.gearWant) this.fitGearDist(bottom - top)
    const k = this.gearSpan ? GEAR_SMOOTH : 1
    const s = this.gearSpan || this.gearBox || (this.gearBox = { x, top, bottom })
    s.x += (x - s.x) * k
    s.top += (top - s.top) * k
    s.bottom += (bottom - s.bottom) * k
    this.gearSpan = s
    this.ui.gearRing.place(s.x, s.top, s.bottom, this.gearWant)
    this.cutBelowGear()
    return s.bottom - s.top
  }

  clipHero(actor) {
    this.uncutHero()
    actor.root.traverse(o => {
      if (!o.material) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.clippingPlanes = this.heroCuts
    })
  }

  uncutHero() {
    this.heroCut.normal.set(0, 1, 0)
    this.heroCut.constant = NO_CUT
  }

  cutBelowGear() {
    const y = this.ui.gearRing.cutY
    if (y == null) return this.uncutHero()
    const cam = this.camera
    const ny = 1 - (2 * (y - GEAR_CUT_INSET)) / view.h
    _cutA.set(-1, ny, 0.5).unproject(cam)
    _cutB.set(1, ny, 0.5).unproject(cam)
    _cutEye.setFromMatrixPosition(cam.matrixWorld)
    this.heroCut.setFromCoplanarPoints(_cutEye, _cutA, _cutB)
    _cutUp.set(0, ny + 0.5, 0.5).unproject(cam)
    if (this.heroCut.distanceToPoint(_cutUp) < 0) this.heroCut.negate()
  }

  fitGearDist(span) {
    const reach = THREE.MathUtils.lerp(1, this.gearDist, this.gearK)
    const fit = clamp(span * reach / this.gearWant, GEAR_NEAREST, 1)
    this.gearDist += (fit - this.gearDist) * GEAR_FIT
  }

  closeGear() {
    if (!this.gearOpen) return
    this.gearOpen = false
    this.uncutHero()
    const skipped = !!this.gearIntro
    this.gearIntro = null
    audio.play('ui_expand_out')
    this.ui.closeGear()
    this.gearTo = 0
    this.gearBack = 1
    this.applyGear()
    const power = this.gear.power()
    if (power > this.gearPower && this.state === 'battle') this.ui.showPowerGain(this.gearPower, power, this.gearGains())
    if (this.shieldPending) {
      const epoch = this.epoch
      setTimeout(() => {
        if (epoch === this.epoch && !this.gearOpen) this.celebrateShield()
      }, GEAR_SETTLE_WAIT)
    }
    if (this.setPending) {
      const epoch = this.epoch
      setTimeout(() => { if (epoch === this.epoch) this.flushSet() }, GEAR_SETTLE_WAIT)
    }
    if (this.shieldUp && !this.shieldFragile && this.state === 'battle') this.cueHero(true)
    else if (skipped && this.state === 'battle') this.cueHero(true, GEAR_HINT_TIME)
  }

  gearGains() {
    const was = this.gearFrom
    const now = this.gear.modifiers()
    if (!was) return ''
    const parts = [
      [gainPct(hitWorth(now), hitWorth(was)), 'DMG'],
      [gainPct(now.hp, was.hp), 'HP'],
      [gainPct(was.taken, now.taken), 'DEF'],
    ].filter(p => p[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 1)
    return parts.map(([v, label]) => `+${v}% ${label}`).join(' · ')
  }

  applyGear() {
    if (!this.gear) return
    const wasWeak = this.weak >= WEAK_WARN
    this.gearMods = this.gear.modifiers()
    const h = this.titanMode ? this.heroBase : this.hero
    if (!h) return
    const max = this.heroDef.hp * this.gearMods.hp
    const before = h.hp
    const gain = Math.max(0, max - (this.hpPeak || max))
    this.hpPeak = Math.max(this.hpPeak || 0, max)
    h.hp = clamp(h.hp + gain, 1, max)
    h.maxHp = max
    if (h.hp > before && this.state === 'battle' && !this.titanMode) this.healSum += h.hp - before
    if (!this.titanMode) this.ui.setHp(h.hp, h.maxHp)
    this.showPower()
    if (this.shieldUp && !this.shieldFragile && !this.underpowered()) this.breakShield()
    if (wasWeak && this.state === 'battle' && !this.bossDown() && this.weakness() === 0) this.floatText(h.pos.x, h.height * STATUS_LIFT + h.pos.y, h.pos.z, 'POWER RESTORED', 'dmg status')
    const live = this.gear.stats().full
    if (live === this.setLive) return
    this.setLive = live
    if (this.state !== 'battle') return
    if (this.gearOpen || this.titanMode) this.setPending = true
    else if (live) this.setActivated()
    else this.setLost()
  }

  underpowered() {
    return !!this.gear && this.gear.power() < POWER_GOAL
  }

  expectedPower(given) {
    const ideal = new Gear(this.heroDef, this.gear.build)
    const plan = this.loot.plan || []
    for (let i = 0; i < given; i++) ideal.add(plan[i])
    return ideal.bestPower()
  }

  weakness() {
    if (!this.gear || !this.loot.plan) return 0
    const plan = this.loot.plan
    const dropped = Math.min(this.loot.planGiven || 0, plan.length)
    const at = this.givenAt
    while (this.givenSeen < dropped) at[this.givenSeen++] = this.t
    let given = 0
    while (given < dropped && this.t - at[given] >= WEAK_GRACE) given++
    if (!this.expected || this.expected.given !== given) this.expected = { given, power: this.expectedPower(given) }
    const base = this.gear.startPower()
    return clamp((this.expected.power - this.gear.power()) / Math.max(WEAK_SPAN_MIN, this.expected.power - base), 0, 1)
  }

  painNow() {
    const target = this.weakness()
    const dt = this.t - this.weakAt
    this.weakAt = this.t
    this.weak = target < this.weak ? target : this.weak + (target - this.weak) * Math.min(1, dt * WEAK_EASE)
    return this.weak
  }

  warnWeak() {
    if (this.t - this.weakWarnAt < WEAK_WARN_GAP || this.gearOpen || this.shieldUp || this.bossDown()) return
    this.weakWarnAt = this.t
    this.ui.showBanner('TOO WEAK', this.gear.hasUpgrade() ? 'equip your new gear' : 'pick up gear', 2)
  }

  showPower() {
    if (!this.gear) return
    const canWin = this.gear.bestPower() >= POWER_GOAL && this.underpowered()
    this.ui.setPower(this.gear.power(), POWER_GOAL, canWin)
    const waiting = this.gearHinted && this.gear.hasUpgrade()
    const calling = this.bossWave() && this.boss && !this.boss.dead && !this.titanMode && !this.titanReady
    const gate = this.shieldUp && !this.shieldFragile
    this.ui.setTip(gate ? 'Shield up · tap your hero' : canWin || waiting ? 'Tap your hero to equip' : this.shieldUp ? 'Hit him · break his shield' : calling ? 'Hit the boss · call your titan' : '')
  }

  raiseShield() {
    this.shieldUp = true
    this.shieldFragile = !this.underpowered()
    this.immuneT = 0
    this.ui.setShield(true, this.shieldFragile)
    this.showPower()
    if (this.shieldFragile) return
    const epoch = this.epoch
    setTimeout(() => {
      if (epoch !== this.epoch || !this.shieldUp || this.state !== 'battle') return
      const owned = this.gear.buildCount(this.gear.bestBuild())
      this.ui.showBanner('TOO WEAK', owned < BUILD_PIECES ? `complete your set · ${owned}/${BUILD_PIECES}` : 'equip your best gear', 2.6)
      audio.play('boss_laugh')
      setTimeout(() => {
        if (epoch !== this.epoch || !this.shieldUp || this.state !== 'battle' || this.hero.dead) return
        if (this.gearOpen) this.ui.gearRing.cueAuto(this.gear.bestPower() >= POWER_GOAL)
        else this.openGear()
      }, GEAR_OPEN_DELAY * 1000)
    }, GATE_WARN_DELAY * 1000)
  }

  breakShield() {
    this.shieldUp = false
    this.shieldFragile = false
    this.ui.setShield(false)
    this.showPower()
    this.cueHero(false)
    if (this.state !== 'battle') return
    if (this.gearOpen) this.shieldPending = true
    else this.celebrateShield()
    const epoch = this.epoch
    setTimeout(() => {
      if (epoch === this.epoch && this.gearOpen) this.closeGear()
    }, SHIELD_CLOSE_DELAY * 1000)
  }

  celebrateShield() {
    this.shieldPending = false
    if (this.state !== 'battle') return
    audio.play('ui_braam')
    this.shake(0.6, 0.45)
    if (this.boss && !this.boss.dead) this.lights.flash(this.boss.pos, 0xffd070, 3.2, 6, 0.6, this.boss.height * 0.5)
    this.ui.flashGoal()
    this.bannerAfter('SHIELD BROKEN', 'strike now', 2.2)
  }

  bannerAfter(title, sub, dur) {
    const now = performance.now()
    const start = Math.max(this.ui.bannerUntil || 0, this.bannerQueue || 0)
    if (start <= now) {
      this.ui.showBanner(title, sub, dur)
      this.bannerQueue = now + dur * 1000
      return
    }
    this.bannerQueue = start + BANNER_GAP_MS + dur * 1000
    const epoch = this.epoch
    setTimeout(() => {
      if (epoch === this.epoch && this.state === 'battle' && !this.bossDown()) this.ui.showBanner(title, sub, dur)
    }, start - now + BANNER_GAP_MS)
  }

  bossDown() {
    return !!(this.boss && this.boss.dead)
  }

  setActivated() {
    if (this.state !== 'battle' || this.titanMode || !this.setLive || this.bossDown() || this.t - this.setSaidAt < SET_SAY_GAP) return
    this.setSaidAt = this.t
    const b = this.gear.build
    const h = this.hero
    this.bannerAfter(`${SET_NAME[b.set].toUpperCase()} SET`, b.bonusText, 2.2)
    this.ui.flashGoal()
    audio.play('loot_drop_artifact')
    this.shake(0.45, 0.4)
    this.lights.flash(h.pos, WEAR_FLASH, 4, 7, 0.6, h.height * 0.6)
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead || e.def.boss) continue
      const dx = e.pos.x - h.pos.x
      const dz = e.pos.z - h.pos.z
      const d = Math.hypot(dx, dz)
      if (d < 0.01 || d > SET_BLAST_RADIUS + e.radius) continue
      this.stun(e, SET_BLAST_STUN)
      this.knock(e, dx / d, dz / d, SET_BLAST_KNOCK)
    }
    if (this.setShown) return
    this.setShown = true
    if (b.set === 'attack') this.resetSkillCooldowns()
    else if (b.set === 'criticaldamage') this.forceCrits = SET_CRITS
    if (b.leech) {
      this.leechPool = LEECH_RATE * h.maxHp
      this.floatText(h.pos.x, h.height * STATUS_LIFT + h.pos.y, h.pos.z, 'LIFESTEAL', 'dmg status')
    }
  }

  flushSet() {
    if (!this.setPending || this.gearOpen || this.titanMode) return
    this.setPending = false
    if (this.setLive === this.setAtOpen) return
    if (this.setLive) this.setActivated()
    else this.setLost()
  }

  setLost() {
    if (this.state !== 'battle' || this.titanMode || this.setLive || this.bossDown()) return
    this.ui.showBanner('SET BROKEN', 'bonus lost · tap your hero', 2)
    audio.play('ui_button_locked')
  }

  leechHit() {
    const h = this.hero
    const heal = Math.min(this.leechPool, this.gear.build.leech * h.maxHp, h.maxHp - h.hp)
    if (heal <= 0) return
    h.hp += heal
    this.leechPool -= heal
    this.healSum += heal
    this.ui.setHp(h.hp, h.maxHp)
  }

  relicTag(item, setBefore) {
    if (this.gear.isBuild(item)) {
      const n = Math.min(BUILD_PIECES, this.gear.buildCount(this.gear.bestBuild()))
      if (n > setBefore) return `SET ${n}/${BUILD_PIECES}`
    }
    return this.gear.isUpgrade(item) ? 'UPGRADE' : ''
  }

  lootAnchor() {
    const id = this.heroVfx()
    return id ? this.vfx.socket(id, this.hero, 'FX_Center') : this.hero.root
  }

  collectLoot(item) {
    audio.play('loot_notification', { slot: 'loot_note', max: 1, gap: 0.35 })
    if (!this.gear) {
      this.ui.lootRelic(item)
      return
    }
    const ready = this.gear.bestPower() >= POWER_GOAL
    const setBefore = this.gear.buildCount(this.gear.bestBuild())
    const added = this.gear.add(item)
    this.ui.lootRelic(item, this.relicTag(added, setBefore))
    if (this.gearOpen) this.ui.gearRing.refresh(added)
    this.showPower()
    const nowReady = this.gear.bestPower() >= POWER_GOAL && this.underpowered()
    const bossWave = !!(WAVES[this.waveIndex] && WAVES[this.waveIndex].boss)
    if (this.gearOpen || this.state !== 'battle' || bossWave) return
    if (!this.gearHinted) {
      if (this.canIntroGear()) this.introGear(added)
    } else if (nowReady && !ready) {
      this.ui.showBanner('SET 4/4 READY', 'tap your hero to equip', 2)
      audio.play('loot_drop_artifact')
      this.cueHero(true, GEAR_HINT_TIME)
    }
  }

  lobbyFxNames() {
    return HEROES.flatMap(h => this.heroLobbyFxNames(h))
  }

  heroLobbyFxNames(h) {
    return [...(h.intro || []).map(([, name]) => name), ...(h.lobbySkin === false ? [] : this.heroFx.skinNames(h.vfx, true))]
  }

  async warmLobbySpawns(pause) {
    const heroes = [...new Set([HEROES[this.heroIndex], ...HEROES])].filter(h => h.vfx)
    for (const h of heroes) {
      await this.vfx.warmSpawned(this.renderer, this.camera, h.vfx, this.heroLobbyFxNames(h), { target: this.composer.inputBuffer, scene: this.scene, focus: this.heroFx.lobbyFocus.get(h.vfx) || null, pause })
    }
  }

  enemyDefs() {
    return [...new Set(WAVES.flatMap(w => w.spawns.map(([type]) => ENEMIES[type])))]
  }

  takeModel(data) {
    const spare = this.modelSpares.get(data)
    const model = spare && spare.pop()
    if (model) {
      model.skins.forEach((s, i) => {
        s.material.transparent = model.fade[i][0]
        s.material.opacity = model.fade[i][1]
        resetDissolve(s.material)
      })
      useSharedLook(model)
      return model
    }
    const fresh = buildModel(data, { castShadow: true, shareLook: true })
    fresh.data = data
    fresh.fade = fresh.skins.map(s => [s.material.transparent, s.material.opacity])
    return fresh
  }

  spareModel(model) {
    if (!model || !model.data) return
    model.root.removeFromParent()
    const spare = this.modelSpares.get(model.data) || []
    spare.push(model)
    this.modelSpares.set(model.data, spare)
  }

  retireActor(actor) {
    actor.flash = 0
    actor.tint(0)
    actor.rig.mixer.stopAllAction()
    actor.rig.mixer.uncacheRoot(actor.root)
    this.spareModel(actor.model)
  }

  async stageBattle(hero) {
    const datas = []
    const fading = new Set()
    for (const def of this.enemyDefs()) {
      const data = await settled(enemyModel(def))
      for (let i = 0; i < enemyPeak(def, this.wavePlan); i++) datas.push(data)
      if (data && !def.boss) fading.add(data)
    }
    const titan = TITANS[hero.titan]
    if (titan) datas.push(await settled(loadModelData(titan.model)))
    const staged = []
    const stage = data => {
      const model = this.takeModel(data)
      model.root.position.set(0, -40, 0)
      this.scene.add(model.root)
      staged.push(model)
      return model
    }
    for (const data of datas) {
      if (!data) continue
      stage(data)
      await new Promise(r => setTimeout(r))
    }
    for (const data of fading) {
      const ghost = stage(data)
      useOwnLook(ghost)
      for (const s of ghost.skins) {
        if (dissolveLook(s.material, 0.5)) continue
        s.material.transparent = true
        s.material.opacity = 0.99
      }
      await new Promise(r => setTimeout(r))
    }
    const heroData = await settled(loadModelData(hero.model))
    for (const data of new Set([...datas, heroData])) {
      if (!data) continue
      strideSpeed({ clips: data.clips, root: data.scene }, 'Run')
      await new Promise(r => setTimeout(r))
    }
    return () => staged.forEach(m => this.spareModel(m))
  }

  battleVfxIds(hero) {
    const titan = TITANS[hero.titan]
    return [hero.vfx, titan && titan.vfx, ...this.enemyDefs().map(d => d.vfx)].filter(id => id && this.vfx.library(id))
  }

  syncSelectSkins() {
    if (this.state !== 'select' || !this.selectActors) return
    for (let i = 0; i < this.selectActors.length; i++) {
      const a = this.selectActors[i]
      const h = HEROES[i]
      const lit = !!(a.skinFx && a.skinFx.length)
      const want = !!h.vfx && h.lobbySkin !== false && a.root.visible && i === this.heroIndex
      if (want && !lit) this.heroFx.attachSkin(h.vfx, a, { lobby: true })
      else if (!want && lit) this.heroFx.detachSkin(a, true)
    }
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0x7fa8ff, 0x241a14, 0.85)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xffe3b8, 2.5)
    key.castShadow = true
    const map = SHADOW_MAP_SIZE[this.quality]
    key.shadow.mapSize.set(map, map)
    this.scene.add(key)
    if (this.arena) {
      const catcher = this.arena.shadowCatcher.material
      catcher.color.copy(CHARACTER_LIGHT.uShadowColor.value)
      catcher.opacity = 0.62
    }
    this.key = key
    this.arenaShadow()

    const rim = new THREE.DirectionalLight(0x7fc0ff, 2.2)
    rim.position.set(-10, 7, -9)
    this.scene.add(rim)

    const back = new THREE.DirectionalLight(0xff9a5a, 1.2)
    back.position.set(4, 5, -12)
    this.scene.add(back)

    this.heroLight = new THREE.PointLight(0x9fd8ff, 26, 15, 2)
    this.heroLight.position.set(0, 2.4, 0)
    this.scene.add(this.heroLight)
  }

  updateLights(dt) {
    const target = this.hero && !this.hero.dead ? this.hero : null
    if (this.lights.aura.follow !== target) this.lights.setAura(target, target ? this.activeDef().color : 0, this.titanMode ? 2.2 : 1.6, this.titanMode ? 9 : 6, this.titanMode ? 2.4 : 1.2)
    this.lights.update(dt)
  }

  aimKey(dir, center) {
    this.key.target.position.copy(center)
    this.key.target.updateMatrixWorld()
    this.key.position.copy(dir).multiplyScalar(KEY_DISTANCE).add(center)
    this.key.updateMatrixWorld()
  }

  arenaShadow() {
    const s = this.key.shadow
    this.aimKey(CHARACTER_LIGHT.uCharLightDir.value, _zero)
    s.bias = ARENA_SHADOW.bias
    s.normalBias = ARENA_SHADOW.normalBias
    s.radius = ARENA_SHADOW.radius[this.quality]
    s.camera.near = ARENA_SHADOW.near
    s.camera.far = ARENA_SHADOW.far
    this.fitBattleShadow()
  }

  selectShadow() {
    const s = this.key.shadow
    this.aimKey(LOBBY_LIGHT.uLobbyLightDir.value, SELECT_SHADOW_CENTER)
    s.bias = SELECT_SHADOW.bias
    s.normalBias = SELECT_SHADOW.normalBias
    s.radius = SELECT_SHADOW.radius[this.quality]
    _singleShadowMin.copy(SELECT_SHADOW_MIN).setX(this.camTarget.x - SELECT_SINGLE_SHADOW_REACH)
    _singleShadowMax.copy(SELECT_SHADOW_MAX).setX(this.camTarget.x + SELECT_SINGLE_SHADOW_REACH)
    this.fitShadowBox(_singleShadowMin, _singleShadowMax, SELECT_SHADOW.depthPad)
  }

  fitShadowBox(min, max, depthPad) {
    const c = this.key.shadow.camera
    _lightBasis.lookAt(this.key.position, this.key.target.position, c.up).setPosition(this.key.position).invert()
    let left = Infinity
    let right = -Infinity
    let bottom = Infinity
    let top = -Infinity
    let near = Infinity
    let far = -Infinity
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(_lightBasis)
      left = Math.min(left, _corner.x)
      right = Math.max(right, _corner.x)
      bottom = Math.min(bottom, _corner.y)
      top = Math.max(top, _corner.y)
      near = Math.min(near, -_corner.z)
      far = Math.max(far, -_corner.z)
    }
    const half = Math.max(right - left, top - bottom) / 2
    const cx = (left + right) / 2
    const cy = (bottom + top) / 2
    c.left = cx - half
    c.right = cx + half
    c.bottom = cy - half
    c.top = cy + half
    c.near = Math.max(0.1, near - depthPad)
    c.far = far + depthPad
    c.updateProjectionMatrix()
  }

  fitBattleShadow() {
    const floorY = this.arena ? this.arena.shadowCatcher.position.y : 0
    _casters.length = 0
    if (this.hero) _casters.push(this.hero)
    for (const e of this.enemies) _casters.push(e)
    fitShadowToView(this.key, this.camera, floorY, ARENA_SHADOW_SPAN, _casters)
  }

  async prepareSelect() {
    if (this.selectActors && this.selectActors.length) return
    const actors = []
    for (let i = 0; i < HEROES.length; i++) {
      const h = HEROES[i]
      const data = await loadModelData(h.lobby || h.model)
      const a = new Actor(buildModel(data, { castShadow: true }), { targetHeight: 1.9 })
      a.setPos((i - 1) * this.selectSpacing(), SELECT_HERO_Z)
      a.targetFacing = a.facing = (h.turn || 0) - (i - 1) * 0.16
      a.rig.play('pose', { force: true })
      a.rig.t = i * 1.7
      this.scene.add(a.root)
      actors.push(a)
    }
    this.selectActors = actors
    this.showcase = new Showcase(this.scene, this.selectActors, HEROES, this.arena)
  }

  async enterSelect() {
    let revealed
    this.revealing = new Promise(resolve => { revealed = resolve })
    this.state = 'select'
    this.ui.veilHold()
    this.setLobbyPost(true)
    this.cardTapped = -1
    this.selectOrbit = 0
    this.selectFrom = -1
    this.orbitHome = false
    this.turntable.enabled = true
    this.ui.buildCards(i => this.tapCard(i), i => this.confirmPick(i))
    this.ui.show('select', true)
    await this.selectWarm
    await this.prepareSelect()
    this.fitSelectCamera()
    this.heroIndex = 0
    this.syncSelectSkins()
    this.camTarget.set(0, 0, 0)
    _camVel.set(0, 0, 0)
    this.camera.position.copy(this.camTarget).add(this.camOffset)
    this.camSnap = true
    this.ui.selectCard(0)
    this.highlightSelected()
    setLobbyView(this.camera)
    this.selectShadow()
    const warm = this.warmIntroFx()
    await this.compileHidden()
    if (this.bootHold) {
      this.bootHold = false
      this.renderHold--
    }
    await this.settleFrames()
    for (const inst of warm) this.vfx.kill(inst)
    this.ui.progress(1)
    this.ui.hideBoot()
    this.ui.playSelectIntro()
    this.ui.veilOut()
    this.playIntro(0)
    audio.track('music_lobby')
    this.ui.releaseImages()
    bootMark('select')
    this.revealing = null
    revealed()
  }

  settleFrames() {
    return new Promise(resolve => {
      const start = performance.now()
      let last = start
      let calm = 0
      const tick = now => {
        calm = now - last < SETTLE_FRAME_MS ? calm + 1 : 0
        last = now
        if (calm >= SETTLE_CALM_FRAMES || now - start > SETTLE_MAX_MS) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  compileScene(scene = this.scene) {
    return compileFor(this.renderer, scene, this.camera, this.composer.inputBuffer)
  }

  async compileHidden() {
    this.renderHold++
    try {
      await new Promise(r => requestAnimationFrame(r))
      await this.compileScene()
    } finally {
      this.renderHold--
    }
  }

  async warmBattleFx(ids) {
    const hidden = new THREE.Vector3(0, -40, 0)
    const fresh = ids.filter(id => id && !this.warmedFx.has(id))
    fresh.forEach(id => this.warmedFx.add(id))
    const shared = [LOOT_FX, MOVE_FX, MOMENT_FX]
    await this.warmFxLibs([...ids, ...shared])
    const warm = fresh.flatMap(id => this.heroFx.warmSkills(id, hidden))
    if (!this.warmedFx.has(MOMENT_FX) && this.moments.ready) {
      this.warmedFx.add(MOMENT_FX)
      warm.push(...this.moments.warm(hidden))
    }
    const probe = this.loot.ready ? this.loot.warmProbe(LOOT_WARM_AT, LOOT_WARM_SCALE) : null
    const moveLib = this.vfx.library(MOVE_FX)
    if (moveLib && !this.guide.ready) this.guide.setMap(moveLib.texture(GUIDE_ARROW))
    this.guide.warm(true)
    await this.compileHidden()
    uploadTexturesNow(this.renderer, [...texturesOf(this.scene), ...this.vfx.textures([...ids, ...shared])])
    this.composer.render()
    primePrograms(this.renderer)
    await new Promise(r => requestAnimationFrame(r))
    this.guide.warm(false)
    for (const inst of warm) this.vfx.kill(inst)
    if (probe) probe.removeFromParent()
  }

  warmIntroFx() {
    const out = []
    const hidden = new THREE.Vector3(0, -40, 0)
    for (const h of HEROES) {
      if (!h.vfx) continue
      for (const [, name] of h.intro || []) {
        const inst = this.vfx.spawn(h.vfx, name, { pos: hidden, scale: 0.001, lifetime: 0.1, focus: this.heroFx.lobbyFocus.get(h.vfx) || null, camera: this.camera })
        if (inst) out.push(inst)
      }
    }
    return out
  }

  playIntro(i) {
    const a = this.selectActors[i]
    if (!a) return
    this.stopIntroFx(a)
    if (!a.rig.has('IntroLOB')) return
    a.rig.play('intro', { force: true, fade: INTRO_IN })
    a.introT = 0
    a.introQueue = (HEROES[i].intro || []).map(([t, name, off]) => ({ t, name, off }))
    this.stopLobbySounds()
    a.introVoice = `${HEROES[i].model}_intro`
    this.sayIntro(a)
  }

  sayIntro(a) {
    if (!a.introVoice || a.introT > INTRO_VOICE_LATE || !audio.unlocked() || !audio.loaded(a.introVoice)) return
    audio.play(a.introVoice)
    a.introVoice = null
  }

  stopLobbySounds(fade = LOBBY_SOUND_FADE) {
    for (const h of HEROES) {
      audio.stop(`${h.model}_intro`, fade)
      audio.stop(`${h.model}_break_1`, fade)
    }
  }

  stopIntroFx(a) {
    for (const inst of a.introFx || []) this.vfx.kill(inst)
    a.introFx = []
    a.introQueue = []
  }

  settleHero(a) {
    this.stopIntroFx(a)
    if (a.rig.state !== 'pose') a.rig.play('pose', { fade: INTRO_OUT })
    a.breakAt = Infinity
  }

  nextIdleBreak(a) {
    a.breakAt = this.t + IDLE_BREAK_GAP[0] + random() * (IDLE_BREAK_GAP[1] - IDLE_BREAK_GAP[0])
  }

  orbitSelectCamera(dt) {
    const turn = this.turntable.take(dt)
    if (turn) {
      this.orbitHome = false
      this.selectOrbit = THREE.MathUtils.euclideanModulo(this.selectOrbit - turn + Math.PI, Math.PI * 2) - Math.PI
    } else if (this.orbitHome && this.selectOrbit) {
      this.selectOrbit *= Math.exp(-ORBIT_SETTLE * dt)
      if (Math.abs(this.selectOrbit) < 0.001) this.selectOrbit = 0
    }
    const actors = this.selectActors
    const gliding = Math.abs(this.camTarget.x - actors[this.heroIndex].pos.x) > SELECT_GLIDE_DONE
    const leaving = gliding && !this.selectOrbit && !this.confirming ? this.selectFrom : -1
    let flipped = false
    for (let i = 0; i < actors.length; i++) {
      const shown = i === this.heroIndex || i === leaving
      if (actors[i].root.visible !== shown) flipped = true
      actors[i].root.visible = shown
      if (this.showcase) this.showcase.showStand(i, shown)
    }
    if (flipped) this.syncSelectSkins()
    this.placeHeroLight()
  }

  orbitAmount() {
    return this.state === 'select' ? Math.min(1, Math.abs(this.selectOrbit) / ORBIT_SOLO) : 0
  }

  updateSelectActors(dt) {
    this.orbitSelectCamera(dt)
    const actors = this.selectActors
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]
      const rig = a.rig
      if (rig.state === 'intro') {
        a.introT += dt
        this.sayIntro(a)
        while (a.introQueue.length && a.introQueue[0].t <= a.introT) {
          const e = a.introQueue.shift()
          const life = e.off ? e.off - e.t : Math.max(0.5, rig.total * INTRO_EXIT + INTRO_BLEND - e.t)
          const inst = HEROES[i].vfx ? this.heroFx.playLobby(HEROES[i].vfx, a, e.name, life) : null
          if (inst) a.introFx.push(inst)
        }
        if (rig.stateT >= rig.total * INTRO_EXIT) {
          rig.play('pose', { fade: INTRO_BLEND })
          a.introQueue = []
          this.nextIdleBreak(a)
        }
      } else if (rig.state === 'idlebreak') {
        if (rig.stateT >= rig.total - INTRO_OUT) {
          rig.play('pose', { fade: INTRO_OUT })
          this.nextIdleBreak(a)
        }
      } else if (i === this.heroIndex && !this.confirming && rig.has('IdleBreakLOB_1') && this.t >= (a.breakAt ?? Infinity)) {
        rig.play('idlebreak', { force: true, fade: IDLE_BREAK_IN })
        audio.play(`${HEROES[i].model}_break_1`)
      }
      cullOffscreen(a.model, i !== this.heroIndex && rig.state === 'pose')
      a.update(dt)
    }
  }

  confirmSelect() {
    this.fetchBattleSounds()
    this.confirming = true
    this.turntable.enabled = false
    this.turntable.stop()
    this.loadBattle(HEROES[this.heroIndex])
    this.confirmT = 0
    this.ui.leaveSelect()
    setTimeout(() => this.startBattle(), CONFIRM_TIME * 1000)
  }

  selectSpacing() {
    return this.selectGap || SELECT_SPACING
  }

  layoutSelect() {
    if (!this.selectActors) return
    const gap = this.selectSpacing()
    for (let i = 0; i < this.selectActors.length; i++) {
      const a = this.selectActors[i]
      a.setPos((i - 1) * gap, SELECT_HERO_Z)
      a.baseFacing = (HEROES[i].turn || 0) - (i - 1) * 0.16 + (HEROES[i].poseTurn || 0)
      a.targetFacing = a.facing = a.baseFacing
    }
    this.placeHeroLight()
  }

  fitSelectCamera(ease = false) {
    this.layoutSelect()
    const h = view.h
    const head = this.ui.select.querySelector('.head')
    const titleBottom = head.getBoundingClientRect().bottom
    const cardsBox = this.ui.cards.getBoundingClientRect()
    const column = getComputedStyle(this.ui.cards).flexDirection === 'column'
    const feetPx = (column ? h - safeInsets().b : cardsBox.top) - SELECT_CARD_LIFT - h * 0.035
    const sideNdc = column ? Math.min(SELECT_POSE_EDGE, (2 * (cardsBox.left - 2 * SELECT_CARD_LIFT)) / view.w - 1) : SELECT_POSE_EDGE
    const headPx = Math.max(titleBottom + h * 0.1, feetPx - h * 0.42)
    const toNdc = px => 1 - (2 * px) / h
    const p = this.portraitAmount()
    _fitCam.fov = this.camera.fov
    _fitCam.aspect = this.camera.aspect
    _fitCam.updateProjectionMatrix()
    const project = (x, y, dist, look, z = 0) => {
      _fitCam.position.copy(SELECT_VIEW_DIR).multiplyScalar(dist)
      _fitCam.lookAt(0, look, 0)
      _fitCam.updateMatrixWorld()
      return _v.set(x, y, z).project(_fitCam)
    }
    const lookFor = dist => bisect(-4, 4, look => project(0, 0, dist, look).y > toNdc(feetPx))
    const tooClose = dist => {
      const look = lookFor(dist)
      if (project(0, SELECT_HERO_TOP, dist, look).y > toNdc(headPx)) return true
      return project(SELECT_HERO_HALF, 1, dist, look).x > SELECT_EDGE
    }
    const dist = bisect(4.5, 14, tooClose)
    this.camOffset.copy(SELECT_VIEW_DIR).multiplyScalar(dist)
    this.camLook.set(0, lookFor(dist), 0)
    const bandTop = titleBottom + h * SELECT_POSE_GAP
    const reach = standRadius(p)
    const tallest = Math.max(...HEROES.map(hero => hero.poseTop || SELECT_POSE_TOP))
    const points = [[reach, 0, 0], [-reach, 0, 0], ...HEROES.flatMap(hero => hero.poseEdge || SELECT_POSE_EDGE_FALLBACK)]
    const lookTop = d => bisect(-4, 4, look => project(0, tallest, d, look).y > toNdc(bandTop))
    const stageTooClose = d => {
      const look = lookTop(d)
      if (project(0, 0, d, look, reach).y < toNdc(feetPx)) return true
      return points.some(([x, y, z]) => {
        const q = project(x, y, d, look, z)
        return Math.abs(q.x) > sideNdc || q.y > SELECT_POSE_EDGE || q.y < toNdc(feetPx)
      })
    }
    const close = bisect(SELECT_POSE_NEAREST, 14, stageTooClose)
    this.selectFit = { dist: close, look: lookTop(close) }
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(_fitCam.fov) / 2) * _fitCam.aspect * close
    this.selectGap = Math.max(SELECT_SPACING, halfWidth + SELECT_HERO_HALF + SELECT_SPACING_MARGIN)
    this.layoutSelect()
    if (!ease) this.camSnap = true
    this.blendSelectPose(0, !ease)
  }

  blendSelectPose(dt, snap) {
    const f = this.selectFit
    if (!f) return
    _selectPoseGoal.set(f.dist, f.look, 0)
    if (snap || !_selectPose.x) {
      _selectPose.copy(_selectPoseGoal)
      _selectPoseVel.set(0, 0, 0)
    } else if (dt > 0) {
      smoothDamp(_selectPose, _selectPoseGoal, _selectPoseVel, SELECT_CAM_SMOOTH, dt)
    }
    this.camOffset.copy(SELECT_VIEW_DIR).multiplyScalar(_selectPose.x)
    this.camLook.set(0, _selectPose.y, 0)
  }

  highlightSelected() {
    const h = HEROES[this.heroIndex]
    this.heroLight.color.set(h.color)
    this.placeHeroLight()
    this.heroLight.intensity = 22
  }

  placeHeroLight() {
    const picked = this.selectActors[this.heroIndex]
    if (!picked) return
    const orbit = this.state === 'select' ? this.selectOrbit : 0
    this.heroLight.position.set(picked.pos.x - Math.sin(orbit) * HERO_LIGHT_BACK, 2.6, picked.pos.z - Math.cos(orbit) * HERO_LIGHT_BACK)
  }

  focusHero(i) {
    const prev = this.selectActors[this.heroIndex]
    if (i !== this.heroIndex) this.selectFrom = this.heroIndex
    this.turntable.stop()
    this.orbitHome = true
    this.heroIndex = i
    this.ui.selectCard(i)
    this.highlightSelected()
    if (prev) this.settleHero(prev)
    this.syncSelectSkins()
    if (this.state === 'select') this.fitSelectCamera(true)
  }

  tapCard(i) {
    if (this.state !== 'select' || this.confirming || !this.selectActors[i]) return
    if (this.cardTapped === i) return this.confirmPick(i)
    this.cardTapped = i
    audio.play('ui_click_main')
    if (i !== this.heroIndex) this.focusHero(i)
  }

  confirmPick(i = this.heroIndex) {
    if (this.state !== 'select' || this.confirming || !this.selectActors[i]) return
    audio.play('ui_click_battle')
    if (i !== this.heroIndex) this.focusHero(i)
    this.confirmSelect()
  }

  fetchBattleSounds() {
    const hero = HEROES[this.heroIndex]
    audio.fetch([hero.model, TITANS[hero.titan].model, 'common', 'enemies'])
  }

  async startBattle() {
    const veiled = this.confirming
    if (veiled) {
      this.composer.render()
      this.ui.freeze(this.renderer.domElement)
      this.renderHold++
    }
    this.state = 'intro'
    this.ui.show('select', false)
    this.setLobbyPost(false)
    if (this.showcase) {
      this.showcase.dispose()
      this.showcase = null
    }
    this.arenaShadow()
    for (const a of this.selectActors) this.scene.remove(a.root)
    const hero = HEROES[this.heroIndex]
    this.stopLobbySounds()
    this.fetchBattleSounds()
    for (const a of this.selectActors) {
      this.heroFx.detachSkin(a)
      this.stopIntroFx(a)
    }
    this.selectActors = []
    const battleLoad = this.loadBattle(hero)
    const [battleModel] = await Promise.all([loadModelData(hero.model), hero.vfx ? this.vfx.preload([hero.vfx]).then(() => this.heroFx.preloadModels(hero.vfx)) : null])
    this.hero = new Actor(this.takeModel(battleModel), { targetHeight: HERO_HEIGHT, radius: HERO_RADIUS })
    this.hero.rig.minFade = HERO_MIN_FADE
    this.hero.rig.retimeCombo(hero.combo)
    this.clipHero(this.hero)
    this.scene.add(this.hero.root)
    if (hero.vfx) this.heroFx.attachSkin(hero.vfx, this.hero)
    this.hero.hp = this.hero.maxHp = hero.hp
    this.hpPeak = hero.hp
    this.hero.setPos(0, -4)
    this.hero.targetFacing = this.hero.facing = 0
    this.hero.root.scale.setScalar(this.hero.scale)
    this.heroDef = hero
    const build = BUILDS[hero.id]
    this.gear = new Gear(hero, build)
    this.expected = null
    this.givenAt = new Float64Array(build ? build.plan.length : 0)
    this.givenSeen = 0
    this.shieldPending = false
    this.redTaught = false
    this.setLive = this.setShown = this.titanCall = this.rescueGuard = this.setPending = this.setAtOpen = false
    this.bossSeenAt = this.bannerQueue = 0
    this.setSaidAt = -SET_SAY_GAP
    this.forceCrits = this.leechPool = this.healSum = this.takenSum = this.numberT = 0
    this.weak = 0
    this.weakAt = this.t
    this.weakWarnAt = -WEAK_WARN_GAP
    this.clearDots()
    this.wavePlan = WAVES.map(w => this.planWave(w))
    if (build) {
      const roster = this.wavePlan.flatMap((packs, wave) => (WAVES[wave].boss ? [] : packs.map(p => ({ table: ENEMIES[p.type].loot, wave, count: p.count }))))
      this.loot.setPlan(planDrops(build), roster)
    }
    this.applyGear()
    this.titanDef = TITANS[hero.titan]
    this.titanLoad = this.loadTitan(this.titanDef)
    this.ui.setAnima(this.titanDef, hero)
    this.ui.setTitan(this.titan, this.titanReady, this.titanSecondsLeft())
    this.ui.setHp(this.hero.hp, this.hero.maxHp)
    this.heroLight.color.set(hero.color)

    this.battleView = true
    this.camYaw = BATTLE_YAW
    this.camOffset.copy(this.battleOffset())
    this.camLook.set(0, BATTLE_LOOK_Y, 0)
    this.fitCamera()
    this.camSnap = true
    await battleLoad
    const unstage = await this.stageBattle(hero)
    await this.warmBattleFx(this.battleVfxIds(hero))
    unstage()
    if (veiled) this.renderHold--

    audio.track('music_battle')
    audio.layer('amb_battle', true)
    this.ui.show('hud', true)
    this.confirming = false
    this.thawAfterFrames()
    this.input.enabled = true
    this.startHints()

    this.waveIndex = -1
    this.state = 'battle'
    trackRunStart()
    this.ui.setWaves(WAVES.map(w => !!w.boss))
    this.nextWave()
  }

  thawAfterFrames() {
    let frames = THAW_FRAMES
    const wait = () => (--frames > 0 ? requestAnimationFrame(wait) : this.ui.thaw())
    requestAnimationFrame(wait)
  }

  nextWave() {
    this.waveIndex++
    if (this.waveIndex >= WAVES.length) { this.victory(); return }
    const w = WAVES[this.waveIndex]
    const boss = w.boss && ENEMIES[w.boss]
    this.ui.setWave(this.waveIndex)
    this.waveBanner(boss)
    if (boss) {
      if (this.hero) this.loot.flushPlan(this.hero.pos)
      this.loot.collectAll()
      this.raiseShield()
    }
    audio.play('ui_braam')
    this.clearT = 0
    this.pending = []
    let delay = 0.35
    const gates = boss ? null : this.entryGates()
    this.waveGates = gates || []
    const clock = gates ? gates.map((_, k) => ENTRY_START + k * ENTRY_GATE_STAGGER) : null
    this.rerouteK = 0
    let pack = 0
    for (const p of this.wavePlan[this.waveIndex]) {
      const ang = random() * Math.PI * 2
      const slot = gates ? pack++ % gates.length : -1
      let t = gates ? clock[slot] : delay
      for (let i = 0; i < p.count; i++) {
        this.pending.push({ type: p.type, t, hp: p.hp, dmg: p.dmg, ang, gate: gates ? gates[slot] : undefined, lane: i - (p.count - 1) / 2 })
        t += gates ? ENTRY_STEP + random() * ENTRY_STEP_JITTER : 0.06 + random() * 0.08
      }
      t += 0.2 + random() * 0.2
      if (gates) clock[slot] = t
      else delay = t
    }
    if (gates) {
      this.pending.sort((a, b) => a.t - b.t)
      this.lookAtGate(gates[0])
    }
    this.waveTimer = 0
    this.waveTotal = this.pending.length
    this.waveKills = 0
  }

  waveBanner(boss) {
    const n = this.waveIndex + 1
    const total = WAVES.length
    if (boss) {
      this.ui.showBanner('FINAL BOSS', boss.name, 2, 'boss')
      return
    }
    const bossWave = WAVES.findIndex(w => w.boss) + 1
    const ahead = bossWave === n + 1 ? 'the boss is next' : 'more monsters'
    const dur = this.waveIndex === 0 ? FIRST_WAVE_BANNER : this.underpowered() ? 2.4 : 1.8
    const sub = this.waveIndex === 0 ? 'beat the monsters · grab their gear'
      : this.underpowered() ? `${ahead} · equip your gear`
      : ahead
    this.ui.showBanner(`WAVE ${n}/${total}`, sub, dur)
    this.ui.callBossStop(dur)
  }

  tallyWaveKills() {
    for (const e of this.enemies) {
      if (!e.dead || e.tallied) continue
      e.tallied = true
      if (e.wave === this.waveIndex) this.waveKills++
    }
    const boss = WAVES[this.waveIndex] && WAVES[this.waveIndex].boss && this.boss
    const share = boss && boss.wave === this.waveIndex && !boss.dead ? 1 - boss.hp / boss.maxHp : this.waveTotal ? this.waveKills / this.waveTotal : 0
    const legs = WAVES.length - 1
    this.ui.setWaveProgress(legs ? (this.waveIndex + share) / legs : 1)
    sayProgress((Math.max(0, this.waveIndex) + share) / WAVES.length)
  }

  async spawnEnemy(type, spot = NO_OPTS) {
    const def = ENEMIES[type]
    const epoch = this.epoch
    this.spawning++
    const loaded = await Promise.all([enemyModel(def), def.vfx ? this.vfx.preload([def.vfx]) : null]).catch(() => null)
    if (epoch !== this.epoch) return
    this.spawning--
    if (!loaded || this.state === 'end') return
    const [data] = loaded
    const base = def.scale * (def.boss ? 1 : MOB_SCALE)
    const k = def.boss ? 1 : def.size || 1
    const size = base * k
    const hpK = def.boss ? 1 : (k ** MOB_HP_POW / MOB_HP_NORM) * (spot.hp || 1)
    const wave = clamp(this.waveIndex, 0, WAVE_HP.length - 1)
    const a = new Actor(this.takeModel(data), {
      targetHeight: 1.78 * size,
      hp: def.hp * hpK * (def.boss ? 1 : WAVE_HP[wave]),
      radius: 0.72 * size,
    })
    a.range = def.range + 0.72 * (size - base)
    a.size = k
    a.might = def.boss ? BOSS_MIGHT : (k ** MOB_DMG_POW / MOB_DMG_NORM) * (spot.dmg || 1) * WAVE_DMG[wave]
    a.armor = k ** -MOB_ARMOR_POW
    a.moveSpeed = def.speed * k ** MOB_SPEED_POW
    a.rate = def.rate * k ** MOB_RATE_POW
    a.def = def
    a.type = type
    a.wave = this.waveIndex
    a.turnRate = def.turn || (def.boss ? BOSS_TURN : ENEMY_TURN)
    a.rig.minFade = def.boss ? BOSS_MIN_FADE : ENEMY_MIN_FADE
    a.rig.chainFade = def.boss ? BOSS_CHAIN_FADE : ENEMY_CHAIN_FADE
    if (def.impacts) a.rig.retime(def.impacts)
    if (!def.boss) {
      castBodyShadow(a.model)
      cullOffscreen(a.model)
    }
    a.cd = random() * a.rate
    if (def.skills) {
      a.cd = a.rate
      a.skillCd = Object.fromEntries(def.skills.map(s => [s.key, s.first ?? s.cd]))
      a.castGap = 0
    }
    if (def.boss) {
      this.placeBoss(a)
      a.rig.comboHold = true
      a.turnAccel = BOSS_TURN_ACCEL
    } else if (spot.gate !== undefined) this.placeAtGate(a, this.freeGate(spot.gate), spot.lane || 0)
    else this.placeNearHero(a, spot.ang)
    a.pos.y = def.fly || 0
    a.rig.play(def.fly ? 'fly' : 'idle', { force: true })
    a.rig.t = random() * 3
    this.scene.add(a.root)
    this.enemies.push(a)
    if (this.enemyVfx(def)) this.heroFx.attachSkin(def.vfx, a)
    this.ui.trackEnemy(a, def.boss ? 'boss' : k >= ELITE_SIZE ? 'elite' : 'regular')

    audio.play('mob_spawn', { at: a.pos, slot: 'spawn', max: 2, gap: 0.1 })
    if (def.boss) {
      this.boss = a
      this.bossSeenAt = this.t
      this.shake(0.5, 0.5)
      this.showPower()
    }
  }

  planWave(w) {
    if (w.boss) return w.spawns.map(([type, count]) => ({ type, count }))
    const packs = []
    for (const [type, n] of w.spawns) {
      const k = ENEMIES[type].size || 1
      const count = Math.max(1, Math.round(n / k))
      const share = n / count
      const hp = share / mobCost(k)
      const dmg = share / mobHit(k)
      const span = Math.max(1, Math.round(PACK_SPAN / k))
      for (let left = count; left > 0; left -= span) packs.push({ type, count: Math.min(span, left), hp, dmg })
    }
    for (let i = packs.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const t = packs[i]
      packs[i] = packs[j]
      packs[j] = t
    }
    return packs
  }

  placeNearHero(a, packAng) {
    const h = this.hero
    const ang = packAng === undefined ? random() * Math.PI * 2 : packAng + (random() - 0.5) * PACK_SPREAD
    const r = SPAWN_RING[0] + random() * (SPAWN_RING[1] - SPAWN_RING[0])
    let x = (h ? h.pos.x : 0) + Math.cos(ang) * r
    let z = (h ? h.pos.z : 0) + Math.sin(ang) * r
    const lim = ARENA_RADIUS - 1.5
    const d = Math.hypot(x, z)
    if (d > lim) {
      x *= lim / d
      z *= lim / d
    }
    a.setPos(x, z)
  }

  entryGates(min = ENTRY_CLOSE) {
    const h = this.hero
    if (!GATES.length || !h) return null
    const ax = -Math.sin(this.camYaw)
    const az = -Math.cos(this.camYaw)
    const ranked = GATES.map((g, i) => {
      const dx = g.x - h.pos.x
      const dz = g.z - h.pos.z
      const d = Math.hypot(dx, dz) || 1
      return { i, d, score: (dx * ax + dz * az) / d - d * ENTRY_DIST_COST }
    }).sort((a, b) => b.score - a.score)
    const far = ranked.filter(o => o.d >= min)
    return (far.length ? far : ranked).slice(0, ENTRY_GATES).map(o => o.i)
  }

  freeGate(index) {
    const h = this.hero
    const gate = GATES[index]
    if (!h || !gate || Math.hypot(gate.x - h.pos.x, gate.z - h.pos.z) >= ENTRY_CLOSE) return index
    const n = this.waveGates.length
    for (let k = 0; k < n; k++) {
      const j = this.waveGates[(this.rerouteK + k) % n]
      const g = GATES[j]
      if (j === index || Math.hypot(g.x - h.pos.x, g.z - h.pos.z) < ENTRY_CLOSE) continue
      this.rerouteK = (this.rerouteK + k + 1) % n
      if (index === this.gateIndex && this.gateLookT > 0) {
        this.gateIndex = j
        this.gateAt.set(g.x, 0, g.z)
      }
      return j
    }
    return index
  }

  placeAtGate(a, index, lane) {
    const gate = GATES[index]
    const r = Math.hypot(gate.x, gate.z) || 1
    const nx = gate.x / r
    const nz = gate.z / r
    const side = lane * ENTRY_LANE
    const inner = Math.max(ENTRY_INNER_MIN, ARENA_RADIUS - ENTRY_INSET - a.radius)
    const behind = r + (gate.behind ?? ENTRY_BEHIND)
    a.setPos(nx * behind - nz * side, nz * behind + nx * side)
    a.entryX = nx * inner - nz * side
    a.entryZ = nz * inner + nx * side
    a.entryR = Math.hypot(a.entryX, a.entryZ)
    a.faceTo(a.entryX, a.entryZ)
    a.facing = a.targetFacing
    a.entering = true
    a.entryT = 0
    a.entryBest = Infinity
    a.entryStall = 0
    a.entryAim = false
    a.easeIn = false
    a.rushT = 0
  }

  enterArena(e, h, dt) {
    e.entryT += dt
    if (e.stagger > 0) e.stagger = Math.max(0, e.stagger - dt)
    if (e.poise > 0) e.poise -= dt
    if (e.entryAim) return this.aimEntry(e, h, dt)
    const r = Math.hypot(e.pos.x, e.pos.z)
    const inside = r < ARENA_RADIUS - 0.4
    const hd = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z)
    const close = hd < e.range + h.radius + 1
    const dx = e.entryX - e.pos.x
    const dz = e.entryZ - e.pos.z
    const left = Math.hypot(dx, dz) || 1
    if (left < e.entryBest - ENTRY_PROGRESS) {
      e.entryBest = left
      e.entryStall = 0
    } else e.entryStall += dt
    const blocked = hd < e.radius + h.radius + 0.6 || e.entryStall > ENTRY_STALL
    if (r <= e.entryR + 0.05 || e.entryT > ENTRY_MAX || (inside && close) || blocked) {
      if (e.def.boss) {
        e.entryAim = true
        e.rig.play('idle', { fade: BOSS_REST_FADE })
        return this.aimEntry(e, h, dt)
      }
      e.entering = false
      e.easeIn = !inside
      e.rushT = ENTRY_RUSH_TIME
      return false
    }
    e.targetFacing = Math.atan2(dx, dz)
    const slow = this.titanMode ? 0.7 : 1
    if (e.def.boss) {
      if (e.rig.state !== 'run') e.rig.play('run', { fade: BOSS_RUN_FADE })
      this.bossStride(e, dt)
    } else {
      const step = Math.min(left, e.moveSpeed * ENTRY_RUSH * slow * dt)
      e.pos.x += (dx / left) * step
      e.pos.z += (dz / left) * step
      if (e.def.fly) {
        if (e.rig.state !== 'fly' && e.rig.finished) e.rig.play('fly', { fade: 0.18 })
      } else if (e.rig.state !== 'run') e.rig.play('run', { fade: 0.18, speed: this.runRate(e, e.def) * ENTRY_RUSH * slow })
    }
    this.settleEnemy(e, h, dt)
    return true
  }

  aimEntry(e, h, dt) {
    e.targetFacing = Math.atan2(h.pos.x - e.pos.x, h.pos.z - e.pos.z)
    this.bossStride(e, dt)
    this.settleEnemy(e, h, dt)
    const off = Math.abs(wrapAngle(e.targetFacing - e.facing))
    if (off > BOSS_AIM && e.entryT < ENTRY_MAX + ENTRY_AIM_MAX) return true
    e.entering = false
    e.entryAim = false
    e.easeIn = Math.hypot(e.pos.x, e.pos.z) > ARENA_RADIUS - 0.4
    e.chasing = false
    e.restT = ENEMY_REST_MIN
    this.bossSeenAt = this.t
    return false
  }

  easeRush(e, h, dt) {
    e.rushT -= dt
    if (e.rushT > 0 && Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z) > ENTRY_NEAR) return
    e.rushT = 0
    if (!e.def.fly && e.rig.state === 'run') e.rig.play('run', { force: true, fade: 0.18, speed: this.runRate(e, e.def) * (this.titanMode ? 0.7 : 1) })
  }

  keepHeroInFrame(dt) {
    const h = this.hero
    let boss = 1
    let gate = 1
    if (h && this.gearK <= 0) {
      this.camera.updateMatrixWorld()
      _v.set(h.pos.x, h.pos.y + h.height * 0.5, h.pos.z).project(this.camera)
      const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y)) / CAM_SAFE_NDC
      const side = Math.max(edge, _v.x / THREE.MathUtils.lerp(CAM_SAFE_NDC, CAM_SAFE_RIGHT_PORTRAIT, this.portraitAmount()))
      boss = edge > 1 ? 0 : edge < CAM_SAFE_BACK ? 1 : this.camSafeWant
      gate = side > 1 ? 0 : side < CAM_SAFE_BACK ? 1 : this.gateSafeWant
    }
    this.camSafeWant = boss
    this.gateSafeWant = gate
    const k = Math.min(1, dt * CAM_SAFE_RATE)
    this.camSafe += (boss - this.camSafe) * k
    this.gateSafe += (gate - this.gateSafe) * k
  }

  lookAtGate(index) {
    const gate = GATES[index]
    if (!gate) return
    this.gateIndex = index
    this.gateAt.set(gate.x, 0, gate.z)
    this.gateLookT = GATE_LOOK_TIME
  }

  placeBoss(a) {
    const gates = this.entryGates(ENTRY_BOSS_CLOSE)
    if (gates) {
      this.placeAtGate(a, gates[0], 0)
      return
    }
    const h = this.hero
    const hx = h ? h.pos.x : 0
    const hz = h ? h.pos.z : 0
    const away = Math.hypot(hx, hz) > 2 ? Math.atan2(-hx, -hz) : Math.atan2(Math.sin(this.camYaw), Math.cos(this.camYaw))
    let x = hx + Math.sin(away) * BOSS_SPAWN_DIST
    let z = hz + Math.cos(away) * BOSS_SPAWN_DIST
    const r = Math.hypot(x, z)
    const lim = ARENA_RADIUS - 3
    if (r > lim) {
      x *= lim / r
      z *= lim / r
    }
    a.setPos(x, z)
    a.faceTo(hx, hz)
    a.facing = a.targetFacing
  }

  enemyVfx(def) {
    return def && def.vfx && this.vfx.library(def.vfx) ? def.vfx : null
  }

  updateBossCast(e, dt) {
    for (const s of e.def.skills) e.skillCd[s.key] -= dt
    const c = e.cast
    if (c) {
      c.t += dt
      if (c.dash) this.bossDash(e, c)
      if (c.leap) this.leapStep(e, c)
      if (!c.dash && c.t >= c.done && ((e.def.boss ? e.rig.finished : e.rig.oneShotDone) || c.t >= c.done + BOSS_CAST_OVERRUN)) {
        e.cast = null
        e.castGap = BOSS_CAST_GAP
      }
      return true
    }
    e.castGap = Math.max(0, e.castGap - dt)
    const h = this.hero
    const busy = e.def.boss ? !this.bossStill(e) : e.rig.state === 'attack' && !e.rig.oneShotDone
    if (e.castGap > 0 || this.gearOpen || !h || h.dead || busy || this.unmorphing) return false
    if (this.titanMode && this.titanT < TITAN_END_CALM) return false
    if (e.def.boss && (this.titanReady || this.state === 'morph')) return false
    const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z)
    const s = readySkill(e, d)
    if (!s) return false
    if (s.kind !== 'nova' && !this.aimedAt(e, h)) return false
    this.bossCast(e, s, d)
    return true
  }

  facingHero(e, h, tolerance) {
    return Math.abs(wrapAngle(Math.atan2(h.pos.x - e.pos.x, h.pos.z - e.pos.z) - e.facing)) <= tolerance
  }

  aimedAt(e, h) {
    if (!e.def.boss) return this.facingHero(e, h, ENEMY_AIM)
    return this.facingHero(e, h, BOSS_AIM) && Math.abs(e.turnVel) < BOSS_SETTLE
  }

  bossStill(e) {
    return e.rig.finished && !e.rig.comboOpen && e.rig.weightOf('Run') < BOSS_STILL
  }

  bossChasing(e, d, range) {
    const off = Math.abs(wrapAngle(e.targetFacing - e.facing))
    const wheel = d > BOSS_WHEEL_NEAR
    const skill = skillSoon(e, d, BOSS_SKILL_LEAD)
    if (e.chasing) {
      if (wheel && off > BOSS_AIM) return true
      const brake = e.def.speed * e.rig.weightOf('Run') * BOSS_REST_FADE * 0.5
      return !skill && d - brake > range
    }
    if (e.restT < ENEMY_REST_MIN) return false
    return (wheel && off > BOSS_WHEEL) || (!skill && d > range + CHASE_SLACK)
  }

  bossStride(e, dt) {
    const w = e.rig.weightOf('Run')
    if (w <= 0) return
    e.pos.x += Math.sin(e.facing) * e.def.speed * w * dt
    e.pos.z += Math.cos(e.facing) * e.def.speed * w * dt
  }

  sinkCorpse(e, dt) {
    e.update(dt)
    const sink = (e.dying - e.rig.total - BOSS_CORPSE_HOLD) / BOSS_SINK_TIME
    if (sink <= 0) return false
    e.pos.y = -e.height * BOSS_SINK_DEPTH * Math.min(1, sink * sink)
    return sink >= 1
  }

  bossCast(e, s, dist) {
    if (s.kind === 'leap') {
      this.leapCast(e, s)
      return
    }
    const h = this.hero
    e.skillCd[s.key] = s.cd
    if (e.def.boss) {
      e.targetFacing = e.facing
      e.turnVel = 0
    } else {
      e.faceTo(h.pos.x, h.pos.z)
      e.facing = e.targetFacing
    }
    const native = !!(e.def.boss && s.dashSpeed)
    e.rig.play(native ? 'chargeWind' : 'cast', { force: true, fade: 0.1, skill: s.fx })
    if (!e.def.boss && e.rig.impactAt > 0 && e.rig.impactAt < s.windup) {
      e.rig.play('cast', { force: true, fade: 0.1, skill: s.fx, speed: Math.max(BOSS_MIN_CAST_SPEED, e.rig.impactAt / s.windup) })
    }
    const impact = native ? e.rig.total : e.def.boss ? s.impact ?? e.rig.impactAt : Math.max(e.rig.impactAt, s.windup)
    const yaw = e.facing
    const fwd = _v.set(Math.sin(yaw), 0, Math.cos(yaw))
    const c = { s, t: 0, impact, done: impact + BOSS_RECOVER, yaw, radius: s.radius || 0, arc: s.arc || Math.PI, width: s.width || 0, length: s.length || 0 }
    if (s.kind === 'circle') c.center = h.pos.clone().setY(0)
    else if (s.kind === 'line') {
      c.center = h.pos.clone().setY(0)
      if (random() < 0.5) c.yaw += Math.PI / 2
    } else if (s.kind === 'charge') {
      c.length = clamp(dist + BOSS_CHARGE_OVERSHOOT, e.def.boss ? BOSS_CHARGE_MIN : 6, s.length)
      c.from = e.pos.clone().setY(0)
      c.to = c.from.clone().addScaledVector(fwd, c.length - e.radius)
      c.center = c.from.clone().addScaledVector(fwd, c.length / 2)
    } else c.center = e.pos.clone().setY(0)
    if (native) {
      const edge = Math.hypot(c.to.x, c.to.z)
      const lim = ARENA_RADIUS - e.radius
      if (edge > lim) c.to.multiplyScalar(lim / edge)
      c.native = true
      c.done = Infinity
      c.dashTime = c.from.distanceTo(c.to) / s.dashSpeed
    }
    c.warn = this.fx.warn({ x: c.center.x, z: c.center.z, yaw: c.yaw, radius: c.radius, arc: c.arc, width: c.width, length: c.length, windup: impact })
    e.cast = c
    const vfxId = this.enemyVfx(e.def)
    const onImpact = () => this.bossImpact(e, c)
    const timing = native && vfxId ? { at: this.dashBlocks(vfxId, s, impact, c.dashTime) } : undefined
    if (vfxId && this.heroFx.hasSkill(vfxId, s.fx)) this.heroFx.castSkill(vfxId, s.fx, e, [], { impact, center: c.center, onImpact, timing })
    else this.heroFx.later(impact, onImpact)
    const skillSound = `${soundCode(e.def)}_skill_${s.fx}`
    audio.play(audio.has(skillSound) ? skillSound : `${soundCode(e.def)}_ult`, { at: e.pos, slot: 'boss_skill', max: 1 })
    if (s.name) this.ui.showBanner(s.name, 'get out of the circle', 2)
  }

  bossImpact(e, c) {
    if (e.dead || e.cast !== c || this.state === 'end') return
    const color = e.def.color || 0xff4a3a
    this.shake(c.s.kind === 'nova' ? 0.9 : 0.45, c.s.kind === 'nova' ? 0.6 : 0.3)
    this.lights.flash(c.center, color, c.s.kind === 'nova' ? 6 : 4, Math.max(c.radius, c.width) * 2.4 + 4, 0.6, 1.2)
    const hitSound = BOSS_HIT_SOUND[c.s.key]
    if (hitSound) audio.play(hitSound, { at: c.center, slot: 'boss_hit', max: 1 })
    if (c.native) {
      c.dash = { t0: c.t }
      e.airborne = true
      e.rig.play('charge', { force: true, fade: 0 })
      return
    }
    if (c.s.kind === 'charge') c.dash = { t0: c.t }
    const h = this.hero
    if (!h || h.dead || this.state !== 'battle') return
    if (!this.insideCast(c, h)) {
      if (this.nearCast(c, h)) this.sayDodged()
      return
    }
    this.hurtHero(c.s.dmg * e.might, SKILL_HITS[c.s.key], c.center)
    this.hitStop(BOSS_SKILL_STOP)
    const vfxId = this.enemyVfx(e.def)
    if (vfxId) this.heroFx.skillHitFx(vfxId, c.s.fx, e, h)
  }

  dashBlocks(vfxId, s, start, length) {
    const at = {}
    for (const x of this.heroFx.entries(vfxId, s.fx)) {
      if (prefabRole(x.fx) === 'hit') continue
      at[x.fx] = x.block === s.dashBlock ? start + (x.on ? length : 0) : 0
    }
    return at
  }

  gallop(e, c) {
    const t = c.t - c.dash.t0
    const r = BOSS_MIN_FADE
    const end = c.dashTime + r
    const run = t < r ? (t * t) / (2 * r) : t < end - r ? t - r / 2 : c.dashTime - ((end - t) * (end - t)) / (2 * r)
    const k = t >= end ? 1 : clamp(run / c.dashTime, 0, 1)
    if (t >= end - r && !c.braking) {
      c.braking = true
      e.rig.play('chargeEnd', { force: true, fade: 0 })
    }
    e.pos.x = THREE.MathUtils.lerp(c.from.x, c.to.x, k)
    e.pos.z = THREE.MathUtils.lerp(c.from.z, c.to.z, k)
    const h = this.hero
    if (!c.struck && h && !h.dead && this.state === 'battle' && Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z) <= e.radius + h.radius) {
      c.struck = true
      this.hurtHero(c.s.dmg * e.might, SKILL_HITS[c.s.key], e.pos)
      this.hitStop(BOSS_SKILL_STOP)
      this.shake(1, 0.5)
      this.lights.flash(h.pos, BOSS_STRIKE_FLASH, 6, 12, 0.5, 1)
      audio.play('step_big_anima_bosses', { at: h.pos, slot: 'boss_strike', max: 1, gap: 0.2 })
      const vfxId = this.enemyVfx(e.def)
      if (vfxId) this.heroFx.skillHitFx(vfxId, c.s.fx, e, h)
    }
    if (k < 1) return
    if (!c.struck && h && !h.dead && this.nearCast(c, h)) this.sayDodged()
    c.dash = null
    e.airborne = false
    c.done = c.t + Math.max(0, e.rig.total - e.rig.stateT)
  }

  bossDash(e, c) {
    if (c.native) {
      this.gallop(e, c)
      return
    }
    const k = clamp((c.t - c.dash.t0) / BOSS_DASH_TIME, 0, 1)
    const eased = 1 - Math.pow(1 - k, 3)
    e.pos.x = THREE.MathUtils.lerp(c.from.x, c.to.x, eased)
    e.pos.z = THREE.MathUtils.lerp(c.from.z, c.to.z, eased)
    if (k >= 1) c.dash = null
  }

  leapCast(e, s) {
    const h = this.hero
    const rig = e.rig
    e.skillCd[s.key] = s.cd
    e.faceTo(h.pos.x, h.pos.z)
    const speed = s.speed || 1
    rig.play('leap', { force: true, fade: 0.1, speed })
    const lift = rig.impactAt * LEAP_LIFT
    const land = rig.starts[rig.starts.length - 1] + (rig.impacts.get(LEAP_LAND_CLIP) || 0) / speed
    const to = h.pos.clone().setY(0)
    const edge = Math.hypot(to.x, to.z)
    const lim = ARENA_RADIUS - LEAP_EDGE
    if (edge > lim) to.multiplyScalar(lim / edge)
    const from = e.pos.clone().setY(0)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const length = Math.hypot(dx, dz)
    const yaw = Math.atan2(dx, dz)
    const c = { s, t: 0, impact: land, done: land + BOSS_RECOVER, yaw, radius: s.radius, arc: Math.PI, width: 0, length: 0, center: to, from, leap: { lift, land, landed: false } }
    const trail = length - s.radius
    if (trail > 0) {
      const mid = trail / 2 / length
      c.path = this.fx.warn({ x: from.x + dx * mid, z: from.z + dz * mid, yaw, width: s.width, length: trail, windup: land })
    }
    c.warn = this.fx.warn({ x: to.x, z: to.z, radius: s.radius, windup: land })
    e.cast = c
    if (!this.redTaught && this.state === 'battle' && !this.gearOpen) {
      this.redTaught = true
      this.ui.showBanner('WATCH THE RED', 'step out before it lands', 1.6)
    }
    audio.play(`${soundCode(e.def)}_skill_${s.fx}`, { at: e.pos, slot: 'enemy_skill', max: 2 })
  }

  cancelLeaps() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead || !e.cast || !e.cast.leap) continue
      this.fx.dropWarn(e.cast.warn)
      this.fx.dropWarn(e.cast.path)
      e.cast = null
      e.airborne = false
      e.castGap = BOSS_CAST_GAP
      e.rig.play('idle', { force: true, fade: 0.2 })
    }
  }

  leapStep(e, c) {
    const l = c.leap
    if (l.landed) return
    const k = clamp((c.t - l.lift) / (l.land - l.lift), 0, 1)
    e.airborne = k > 0 && k < 1
    e.knockX = e.knockZ = 0
    if (k > 0) {
      e.pos.x = THREE.MathUtils.lerp(c.from.x, c.center.x, k)
      e.pos.z = THREE.MathUtils.lerp(c.from.z, c.center.z, k)
    }
    if (k < 1) return
    l.landed = true
    e.airborne = false
    this.leapLand(e, c)
  }

  leapLand(e, c) {
    if (e.dead || this.state === 'end') return
    const at = c.center
    const color = e.def.color || 0xff4a3a
    this.shake(0.5 * Math.min(1, e.size || 1), 0.35)
    this.lights.flash(at, color, 4, c.radius * 2.4 + 4, 0.6, 1.2)
    const vfxId = this.enemyVfx(e.def)
    if (vfxId) {
      const list = this.heroFx.entries(vfxId, c.s.fx)
      const land = c.s.land || NO_OPTS
      for (let i = 0; i < list.length; i++) this.heroFx.spawnAt(vfxId, list[i].fx, new THREE.Vector3(at.x, 0.03, at.z), e.facing, land.scale || e.scale, 3, land.mute || null)
    }
    const h = this.hero
    if (!h || h.dead || this.state !== 'battle' || this.gearOpen) return
    if (!this.insideCast(c, h)) {
      if (this.nearCast(c, h)) this.sayDodged()
      return
    }
    this.hurtHero(c.s.dmg * e.might, SKILL_HITS[c.s.key], at)
  }

  insideCast(c, a) {
    const dx = a.pos.x - c.center.x
    const dz = a.pos.z - c.center.z
    const r = a.radius
    if (c.width) {
      const along = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)
      const side = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)
      return Math.abs(along) <= c.length / 2 + r && Math.abs(side) <= c.width / 2 + r
    }
    const d = Math.hypot(dx, dz)
    if (d > c.radius + r) return false
    if (c.arc >= Math.PI) return true
    let da = Math.atan2(dx, dz) - c.yaw
    while (da > Math.PI) da -= Math.PI * 2
    while (da < -Math.PI) da += Math.PI * 2
    return Math.abs(da) <= c.arc + r / Math.max(d, 0.5)
  }

  nearCast(c, a) {
    return Math.hypot(a.pos.x - c.center.x, a.pos.z - c.center.z) < Math.max(c.radius, c.length / 2) + DODGE_REACH
  }

  cancelBossCast(e) {
    if (e.swing && e.swing.warn) {
      this.fx.dropWarn(e.swing.warn)
      e.swing.warn = null
    }
    if (e.preSwing && e.preSwing.warn) {
      this.fx.dropWarn(e.preSwing.warn)
      e.preSwing.warn = null
    }
    if (!e.cast) return
    this.fx.endWarn(e.cast.warn)
    if (e.cast.path) this.fx.endWarn(e.cast.path)
    e.cast = null
    e.airborne = false
  }

  shake(amp, dur) {
    this.shakeAmp = Math.max(this.shakeAmp, amp)
    this.shakeT = Math.max(this.shakeT, dur)
  }

  hitStop(ms) {
    if (this.gearOpen) return
    const now = performance.now()
    const until = this.stopUntil || 0
    if (now < until ? now + ms <= until : now - until < STOP_GAP && ms < HEAVY_STOP) return
    this.stopUntil = now + ms
    this.timeScale = STOP_SCALE
    clearTimeout(this._hs)
    this._hs = setTimeout(() => { this.timeScale = 1 }, ms)
  }

  hitFreeze(e, ms) {
    if (!e || e.def.boss || this.committed(e)) return
    e.freeze(ms / 1000)
  }

  numberSize(value, crit) {
    const base = this.heroDef ? this.heroDef.atkDmg : value
    return clamp(1 + NUMBER_GROW * Math.log2(Math.max(0.25, value / base)), NUMBER_SIZE[0], NUMBER_SIZE[1]) * (crit ? CRIT_NUMBER : 1)
  }

  damageNumber(x, y, z, value, crit, kill) {
    _v.set(x, y, z).project(this.camera)
    const at = `translate(${((_v.x * 0.5 + 0.5) * view.w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * view.h).toFixed(1)}px)`
    const s = this.ui.hudScale / DAMAGE_PHONE_SCALE
    const k = this.numberSize(value, crit)
    const dx = (random() - 0.5) * 70 * s
    const text = Math.round(value * ATK_PER_DMG).toLocaleString('en-US')
    const size = `${(19 * s * k).toFixed(1)}px`
    if (crit) {
      this.floats.show('dmg crit', text, [
        { transform: `${at} translate(-50%, -50%) scale(.3)`, opacity: 0 },
        { transform: `${at} translate(calc(-50% + ${(dx * 0.2).toFixed(1)}px), -70%) scale(1.5)`, opacity: 1, offset: 0.1 },
        { transform: `${at} translate(calc(-50% + ${(dx * 0.3).toFixed(1)}px), -85%) scale(1)`, opacity: 1, offset: 0.24 },
        { transform: `${at} translate(calc(-50% + ${(dx * 0.6).toFixed(1)}px), -120%) scale(1)`, opacity: 1, offset: 0.72 },
        { transform: `${at} translate(calc(-50% + ${dx.toFixed(1)}px), -175%) scale(.9)`, opacity: 0 },
      ], { duration: 1150, easing: 'cubic-bezier(.2,.7,.3,1)' }, { color: '', fontSize: size })
      return
    }
    this.floats.show(kill ? 'dmg kill' : 'dmg', text, [
      { transform: `${at} translate(-50%, -50%) scale(.4)`, opacity: 0 },
      { transform: `${at} translate(calc(-50% + ${(dx * 0.3).toFixed(1)}px), -78%) scale(${kill ? 1.3 : 1.12})`, opacity: 1, offset: 0.2 },
      { transform: `${at} translate(calc(-50% + ${dx.toFixed(1)}px), -180%) scale(.86)`, opacity: 0 },
    ], { duration: kill ? 900 : 760, easing: 'cubic-bezier(.15,.8,.3,1)' }, { color: '', fontSize: size })
  }

  useSkill(key) {
    if (this.state !== 'battle' || !this.hero || this.hero.dead || this.heroLocked()) return false
    if (this.cooldowns[key] > 0) return false
    const s = this.activeDef().skills[SKILL_SLOT[key]]
    if (!s) return false
    this.cooldowns[key] = s.cd
    this.castSkill(s)
    return true
  }

  castReady(key) {
    if (key === 'ult') return this.ultReady
    return this.cooldowns[key] <= 0 && !!this.activeDef().skills[SKILL_SLOT[key]]
  }

  castNow(key) {
    return key === 'ult' ? this.castUltimate() : this.useSkill(key)
  }

  castQueued() {
    const key = this.queuedCast
    if (!key || this.heroWindup()) return
    this.queuedCast = null
    if (!this.heroLocked()) this.castNow(key)
  }

  heroWindup() {
    const rig = this.hero.rig
    return WINDUP_STATES.has(rig.state) && rig.stateT < rig.impactAt
  }

  steering() {
    const axis = this.input.axis()
    return axis[0] !== 0 || axis[1] !== 0
  }

  autoCombat() {
    const hero = this.hero
    if (!hero || hero.dead || this.heroLocked() || this.heroBusy() || this.heroWindup()) return
    if (this.titanMode && this.titanT <= 0) return
    const near = this.nearestEnemy()
    if (!near) return
    const def = this.activeDef()
    const slack = this.steering() ? 0 : AUTO_ATTACK_SLACK
    const gap = near.d - near.e.radius
    const worth = this.titanMode || near.e.def.boss || near.e.size >= ELITE_SIZE
    const ultReach = this.heroDef.ult.reach * AUTO_ULT_SHARE
    const ultNow = worth || hero.hp < hero.maxHp * AUTO_ULT_LOW || this.t - this.ultReadyAt >= AUTO_ULT_WAIT
    if (this.ultReady && gap < ultReach && (ultNow || this.countNear(ultReach) >= AUTO_ULT_PACK) && this.castUltimate()) return
    for (const key of AUTO_SKILLS) {
      const skill = def.skills[SKILL_SLOT[key]]
      if (!skill || this.cooldowns[key] > 0) continue
      const reach = this.skillReach(skill, def)
      const now = worth || this.t - this.readyAt[key] >= AUTO_SKILL_WAIT
      if (gap < reach && (now || this.countNear(reach) >= AUTO_SKILL_PACK) && this.useSkill(key)) return
    }
    if (this.cooldowns.attack <= 0 && near.d < def.atkRange + Math.max(slack, near.e.radius)) this.attack()
  }

  countNear(r) {
    const h = this.hero
    let n = 0
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (!e.dead && Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) - e.radius < r) n++
    }
    return n
  }

  skillReach(skill, def) {
    if (skill.type === 'volley' || skill.at === 'target') return def.atkRange + AUTO_ATTACK_SLACK
    return (skill.radius || def.atkRange) + (skill.ahead || 0) + AUTO_SKILL_SLACK
  }

  activeDef() {
    return this.titanMode ? this.titanDef : this.heroDef
  }

  heroVfx() {
    const def = this.activeDef()
    return def && def.vfx && this.vfx.library(def.vfx) ? def.vfx : null
  }

  comboIndexOf(rig) {
    const m = rig.action && rig.action.getClip().name.match(/ComboAttack_(\d+)/)
    return m ? Number(m[1]) : 0
  }

  attack() {
    const h = this.activeDef()
    this.cooldowns.attack = h.atkRate
    const near = this.nearestEnemy()
    const yaw = near && near.d - near.e.radius < h.atkRange + 1.5 ? this.aimHero(near.e.pos.x, near.e.pos.z) : this.hero.facing
    this.combo = ((this.combo || 0) + 1) % 2
    this.layerLegs(yaw)
    this.hero.rig.play(this.combo ? 'attack' : 'attack2', { force: true })
    if (h.combo && h.combo.next) this.cooldowns.attack = this.hero.rig.release
    this.hero.attackT = 0
    const hitAt = this.hero.rig.impactAt
    const vfxId = this.heroVfx()
    const combo = vfxId ? this.comboIndexOf(this.hero.rig) : 0
    const ranged = vfxId && this.heroFx.scriptRanged(vfxId)
    const aim = near && (!ranged || near.d - near.e.radius <= h.atkRange + 2) ? near.e : null
    const fxRes = vfxId ? this.heroFx.attack(vfxId, combo, this.hero, aim, {
      impact: hitAt,
      fallback: ranged ? this.aheadOf(this.hero, h.atkRange).setY(this.hero.height * 0.55) : null,
      onHit: e => {
        if (!e || e.dead || this.state !== 'battle') return
        const crit = this.damage(e, h.atkDmg, h.color, `${h.model}_hit_combo`)
        if (this.stun(e, 0.2)) this.shove(e, KNOCK.shot * (crit ? CRIT_KNOCK : 1))
        this.hitFreeze(e, this.titanMode ? HIT_STOP.titan : HIT_STOP.ranged)
      },
    }) : null
    if (!(fxRes && fxRes.ranged)) this.hero.pendingHit = { dmg: h.atkDmg, range: h.atkRange, arc: this.titanMode ? 2.6 : 1.9, delay: fxRes && fxRes.scripted ? fxRes.hitAt : hitAt, fx: fxRes ? combo : null, vfx: vfxId, aim: this.hero.aimYaw }
    audio.play(this.attackSound(h, this.hero.rig), this.titanMode ? TITAN_SWING : NO_OPTS)
  }

  layerLegs(yaw = this.hero.facing) {
    const h = this.hero
    h.aimYaw = yaw
    if (this.steering()) h.rig.setLegs(true, this.runRate(h, this.activeDef()))
  }

  aimHero(x, z) {
    const h = this.hero
    const yaw = Math.atan2(x - h.pos.x, z - h.pos.z)
    if (!this.steering()) h.targetFacing = yaw
    return yaw
  }

  aheadOf(actor, dist) {
    const yaw = yawOf(actor)
    return actor.pos.clone().setY(0).add(_v.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(dist))
  }

  attackSound(def, rig) {
    const n = this.comboIndexOf(rig)
    const code = soundCode(def)
    const key = `${code}_attack_${n}`
    return audio.has(key) || !def.boss ? key : `${code}_attack_${1 + (n % 2)}`
  }

  heroBusy() {
    const rig = this.hero.rig
    return rig.state === 'cast' && !rig.oneShotDone
  }

  startHints() {
    const epoch = this.epoch
    this.steered = false
    this.hintTimers = [
      setTimeout(() => {
        if (epoch !== this.epoch || this.steered || this.state !== 'battle') return
        this.ui.showGestureHint(true, 'move')
        this.hintTimers.push(setTimeout(() => epoch === this.epoch && this.finishMoveHint(), MOVE_HINT_TIME * 1000))
      }, GESTURE_HINT_DELAY * 1000),
    ]
  }

  finishMoveHint() {
    if (this.steered) return
    this.steered = true
    this.ui.showGestureHint(false, 'move')
  }

  clearHints() {
    for (const t of this.hintTimers || []) clearTimeout(t)
    this.hintTimers = []
    this.ui.showGestureHint(false, 'move')
    this.cueHero(false)
  }

  cueHero(on, secs = 0) {
    clearTimeout(this.heroCueTimer)
    this.heroCueOn = on
    if (on) {
      this.steered = true
      this.ui.showGestureHint(false, 'move')
    }
    this.ui.cueHero(on)
    if (on && secs) this.heroCueTimer = setTimeout(() => this.cueHero(false), secs * 1000)
  }

  castSkillFx(vfxId, s) {
    const hero = this.hero
    const reach = s.reach || 10
    const near = this.nearestEnemy()
    const target = near && near.d <= reach ? near.e : null
    this.layerLegs(target ? this.aimHero(target.pos.x, target.pos.z) : hero.facing)
    hero.rig.play('cast', { force: true, skill: skillAnim(s) })
    audio.play(`${this.activeDef().model}_skill_${skillAnim(s)}`)
    const color = this.activeDef().color
    if (this.heroFx.hasScript(vfxId)) {
      this.castScriptedSkill(vfxId, s, color)
      return
    }
    const roles = new Set(this.heroFx.entries(vfxId, s.fx).map(e => prefabRole(e.fx)))
    const projectile = roles.has('projectile')
    const R = s.radius || 3.5
    const center = (roles.has('aoe') || s.at === 'target') && target
      ? target.pos.clone().setY(0)
      : this.aheadOf(hero, roles.has('aoe') ? 3 : R * 0.45)
    const inArea = () => this.enemies.filter(e => !e.dead && Math.hypot(e.pos.x - center.x, e.pos.z - center.z) <= R + e.radius)
    const targets = projectile
      ? this.enemies.filter(e => !e.dead && e.pos.distanceTo(hero.pos) <= reach + 4).sort((a, b) => a.pos.distanceTo(hero.pos) - b.pos.distanceTo(hero.pos)).slice(0, s.count || 3)
      : inArea()
    this.heroFx.castSkill(vfxId, s.fx, hero, targets, {
      impact: hero.rig.impactAt,
      timing: s.timing,
      center,
      onHit: projectile ? e => {
        if (!e || e.dead || this.state !== 'battle') return
        this.damage(e, s.dmg, color, null, true)
        if (this.stun(e, 0.25)) this.shove(e, KNOCK.bolt)
        this.hitFreeze(e, HIT_STOP.ranged)
      } : null,
      onImpact: (share = 1) => {
        if (this.state !== 'battle') return
        this.shake(projectile ? 0.25 : 0.45, 0.3)
        if (projectile) return
        this.lights.flash(center, color, 4.5, R * 2.4, 0.65, 1.2)
        const hit = inArea()
        for (const e of hit) {
          this.damage(e, s.dmg * share, color, null, true)
          this.stun(e, 0.3)
        }
        for (const e of hit) this.hitFreeze(e, HIT_STOP.skill)
      },
    })
  }

  castScriptedSkill(vfxId, s, color) {
    const hero = this.hero
    const R = s.radius || 3.5
    const reach = s.reach || 10
    const shape = this.heroFx.scriptShape(vfxId, s.fx)
    const near = this.nearestEnemy()
    const focus = near && near.d <= reach ? near.e : null
    const byDistance = from => this.enemies
      .filter(e => !e.dead && e.pos.distanceTo(from) <= (from === hero.pos ? reach : R) + e.radius)
      .sort((a, b) => a.pos.distanceTo(from) - b.pos.distanceTo(from))
    if (shape.projectile) {
      this.heroFx.castSkill(vfxId, s.fx, hero, byDistance(hero.pos).slice(0, s.count || 2), {
        fallback: this.aheadOf(hero, reach * 0.7).setY(hero.height * 0.55),
        onHit: e => {
          if (!e || e.dead || this.state !== 'battle') return
          this.damage(e, s.dmg, color, null, true)
          if (this.stun(e, 0.25)) this.shove(e, KNOCK.bolt)
          this.hitFreeze(e, HIT_STOP.ranged)
        },
        onImpact: () => this.state === 'battle' && this.shake(0.25, 0.3),
      })
      return
    }
    if (shape.chaining) {
      const targets = focus ? [focus, ...byDistance(focus.pos).filter(e => e !== focus)].slice(0, s.count || 4) : []
      this.heroFx.castSkill(vfxId, s.fx, hero, targets, {
        center: focus ? null : this.aheadOf(hero, R),
        onHit: (e, i, share = 1) => {
          if (!e || e.dead || this.state !== 'battle') return
          this.damage(e, s.dmg * share, color, null, true)
          this.stun(e, 0.3)
        },
        onImpact: () => {
          if (this.state !== 'battle') return
          this.shake(0.4, 0.3)
          if (focus) {
            this.lights.flash(focus.pos, color, 4, R * 2, 0.5, 1.2)
            this.hitFreeze(focus, HIT_STOP.skill)
          }
        },
      })
      return
    }
    const ahead = s.ahead ?? R * 0.45
    const center = s.at === 'target' && focus ? focus.pos.clone().setY(0) : this.aheadOf(hero, ahead)
    const inArea = () => this.enemies.filter(e => !e.dead && Math.hypot(e.pos.x - center.x, e.pos.z - center.z) <= R + e.radius)
    this.heroFx.castSkill(vfxId, s.fx, hero, s.at === 'target' && focus ? [focus] : [], {
      center,
      targetsAt: s.at === 'target' && focus ? () => (focus.dead ? [] : [focus]) : inArea,
      onImpact: () => {
        if (this.state !== 'battle') return
        this.shake(0.45, 0.3)
        this.lights.flash(center, color, 4.5, R * 2.4, 0.65, 1.2)
        const hit = inArea()
        for (const e of hit) {
          this.damage(e, s.dmg, color, null, true)
          this.stun(e, 0.3)
        }
        for (const e of hit) this.hitFreeze(e, HIT_STOP.skill)
      },
    })
  }

  castSkill(s) {
    const hero = this.hero
    const vfxId = this.heroVfx()
    if (vfxId && s.fx && this.heroFx.hasSkill(vfxId, s.fx)) {
      this.castSkillFx(vfxId, s)
      return
    }
    this.layerLegs()
    hero.rig.play('cast', { force: true, skill: skillAnim(s) })
    audio.play(`${this.activeDef().model}_skill_${skillAnim(s)}`)
    const color = this.activeDef().color

    setTimeout(() => {
      if (!this.hero || this.state !== 'battle') return
      if (s.type === 'nova') {
        const R = s.radius
        audio.play('explosion')
        this.shake(0.45, 0.3)
        for (const e of this.enemies) {
          if (e.dead) continue
          if (e.pos.distanceTo(hero.pos) <= R + e.radius) this.damage(e, s.dmg, color)
        }
      } else if (s.type === 'volley') {
        const targets = this.enemies.filter(e => !e.dead).slice(0, s.count)
        targets.forEach((e, i) => {
          setTimeout(() => {
            if (e.dead || this.state !== 'battle') return
            this.damage(e, s.dmg, color)
          }, i * 70)
        })
      } else if (s.type === 'beam') {
        const f = hero.facing
        audio.play('explosion')
        this.shake(0.5, 0.35)
        for (const e of this.enemies) {
          if (e.dead) continue
          const dx = e.pos.x - hero.pos.x
          const dz = e.pos.z - hero.pos.z
          const along = dx * Math.sin(f) + dz * Math.cos(f)
          const side = Math.abs(dx * Math.cos(f) - dz * Math.sin(f))
          if (along > 0 && along < s.length && side < 2.2) this.damage(e, s.dmg, color)
        }
      }
    }, hero.rig.impactAt * 1000)
  }

  damage(e, amount, color, hit, heavy = false) {
    let shatter = false
    if (this.shieldUp && e.def && e.def.boss && !e.dead) {
      if (!this.shieldFragile) {
        this.blockHit(e)
        return false
      }
      this.breakShield()
      shatter = true
    }
    const mods = this.gearMods
    const smash = this.titanMode && !(e.def && e.def.boss)
    let crit = (!!mods && random() < mods.crit) || shatter
    if (!crit && this.forceCrits > 0 && !this.titanMode) {
      crit = true
      this.forceCrits--
    }
    if (mods) amount *= mods.atk * (crit || smash ? mods.critMult : 1)
    amount *= this.titanMode ? (smash ? TITAN_DMG * TITAN_SMASH : TITAN_BOSS_DMG) : 1 - WEAK_DEAL * this.painNow()
    amount *= (e.armor || 1) * (1 + (rollRandom() * 2 - 1) * HIT_ROLL)
    const dealt = e.hit(amount)
    if (!dealt) return false
    this.woundTitan(e, dealt)
    if (this.setLive && !this.titanMode && this.gear.build.leech) this.leechHit()
    const code = e.def && soundCode(e.def)
    const boss = !!(e.def && e.def.boss)
    this.lights.flash(e.pos, color || 0xffd070, crit ? 2.6 : 1.8, crit ? 4.2 : 3.4, crit ? 0.3 : 0.22, e.height * 0.5)
    this.damageNumber(e.pos.x, e.height * 0.75 + e.pos.y, e.pos.z, amount, crit, e.dead)
    if (hit) audio.play(hit, { slot: 'hit', max: 3, gap: 0.04 })
    if (!e.dead) audio.play(audio.has(`${code}_take_damage`) ? `${code}_take_damage` : `${code}_damage`, { at: e.pos, slot: boss ? 'boss_hurt' : 'enemy_hurt', max: 3, gap: 0.05 })
    if (!this.titanMode) this.addUlt(dealt / (mods ? mods.atk : 1) * ULT_CHARGE * this.heroDef.ultGain)
    if (crit) {
      this.hitFreeze(e, CRIT_STOP)
      this.shake(CRIT_SHAKE, 0.18)
    }
    if (e.dead) {
      this.kills++
      this.cancelBossCast(e)
      this.heroFx.detachSkin(e)
      this.loot.dropFrom(e, e.def && e.def.loot, boss)
      audio.play(`${code}_death`, { at: e.pos, slot: 'enemy_death', max: 3 })
      if (boss) {
        this.shake(1.1, 0.9)
        this.hitStop(180)
        this.showPower()
      } else {
        this.hitFreeze(e, KILL_STOP)
        this.launch(e, (heavy || this.titanMode ? KILL_KNOCK.heavy : KILL_KNOCK.basic) * (1 + clamp((amount - dealt) / e.maxHp, 0, KILL_OVERKILL_MAX)))
      }
    }
    return crit
  }

  shove(e, dist) {
    const h = this.hero
    if (!h) return
    const dx = e.pos.x - h.pos.x
    const dz = e.pos.z - h.pos.z
    const d = Math.hypot(dx, dz) || 1
    this.knock(e, dx / d, dz / d, dist)
  }

  launch(e, dist) {
    const h = this.hero
    if (!h) return
    const dx = e.pos.x - h.pos.x
    const dz = e.pos.z - h.pos.z
    const d = Math.hypot(dx, dz) || 1
    e.knockX = (e.knockX || 0) + (dx / d) * dist
    e.knockZ = (e.knockZ || 0) + (dz / d) * dist
  }

  blockHit(e) {
    if (this.t - (this.immuneT || 0) < IMMUNE_TEXT_GAP) return
    this.immuneT = this.t
    this.lights.flash(e.pos, 0x8a6cff, 2.2, 4.5, 0.3, e.height * 0.5)
    this.floatText(e.pos.x, e.height * 0.85 + e.pos.y, e.pos.z, 'IMMUNE')
    audio.play('ui_button_locked', { slot: 'immune', gap: 0.4 })
  }

  flushHeroNumbers(dt) {
    this.numberT += dt
    if (this.numberT < HERO_NUMBER_GAP || !this.hero) return
    this.numberT = 0
    const min = this.hero.maxHp * HERO_NUMBER_MIN
    if (this.takenSum >= min) {
      this.heroNumber('-', this.takenSum, 'dmg taken')
      this.takenSum = 0
    }
    if (this.healSum >= min) {
      this.heroNumber('+', this.healSum, 'dmg heal')
      this.healSum = 0
    }
  }

  heroNumber(sign, value, cls) {
    const h = this.hero
    _v.set(h.pos.x, h.pos.y + h.height * HERO_NUMBER_LIFT, h.pos.z).project(this.camera)
    const at = `translate(${((_v.x * 0.5 + 0.5) * view.w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * view.h).toFixed(1)}px)`
    const rise = sign === '+'
    this.floats.show(cls, `${sign}${Math.round(value * HERO_NUMBER_SCALE).toLocaleString('en-US')}`, [
      { transform: `${at} translate(-50%, -50%) scale(1.1)`, opacity: 0 },
      { transform: `${at} translate(-50%, ${rise ? '-90%' : '-40%'}) scale(1)`, opacity: 1, offset: 0.2 },
      { transform: `${at} translate(-50%, ${rise ? '-170%' : '10%'}) scale(.9)`, opacity: 0 },
    ], { duration: 760, easing: 'cubic-bezier(.15,.8,.3,1)' }, HERO_NUMBER_STYLE)
  }

  floatText(x, y, z, text, cls = 'dmg immune') {
    _v.set(x, y, z).project(this.camera)
    const at = `translate(${((_v.x * 0.5 + 0.5) * view.w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * view.h).toFixed(1)}px)`
    this.floats.show(cls, text, [
      { transform: `${at} translate(-50%, -50%) scale(.5)`, opacity: 0 },
      { transform: `${at} translate(-50%, -80%) scale(1.15)`, opacity: 1, offset: 0.25 },
      { transform: `${at} translate(-50%, -170%) scale(1)`, opacity: 0 },
    ], { duration: 900, easing: 'cubic-bezier(.15,.8,.3,1)' }, { color: '', fontSize: '' })
  }

  addTitan(v) {
    if (this.titanReady || this.titanMode || this.state === 'morph') return
    this.titan = clamp(this.titan + v, 0, 1)
    if (this.titan >= 1) {
      this.titanReady = true
      this.titanWait = TITAN_AUTO_DELAY
      audio.play('vo_titan_charge')
      if (this.titanMayCome()) this.ui.showBanner('TITAN READY', '', 1.4)
      else this.titanCall = true
      if (this.heroCueOn) this.cueHero(false)
      this.showPower()
    }
    this.ui.setTitan(this.titan, this.titanReady, this.titanSecondsLeft())
  }

  titanSecondsLeft() {
    return this.titan < TITAN_WAVE_CAP ? (TITAN_WAVE_CAP - this.titan) * TITAN_CHARGE_TIME : null
  }

  bossWave() {
    return !!(WAVES[this.waveIndex] && WAVES[this.waveIndex].boss)
  }

  chargeTitan(dt) {
    if (this.titan < TITAN_WAVE_CAP) this.addTitan(Math.min(dt / TITAN_CHARGE_TIME, TITAN_WAVE_CAP - this.titan))
    else if (this.bossWave() && this.boss && !this.boss.dead) this.addTitan(dt * (1 - TITAN_WAVE_CAP) / TITAN_BOSS_TRICKLE)
  }

  woundTitan(e, dealt) {
    if (e.dead || this.titanMode || this.titanReady || !e.def.boss || this.state !== 'battle') return
    this.addTitan(dealt / e.maxHp / TITAN_BOSS_WOUND * (1 - TITAN_WAVE_CAP))
  }

  bossWinding() {
    const c = this.boss && !this.boss.dead && this.boss.cast
    return !!c && !c.dash && c.t < c.impact
  }

  titanMayCome() {
    if (this.bossDown()) return false
    if (this.rescueGuard || !this.bossWave() || !this.boss) return true
    return this.t - this.bossSeenAt >= BOSS_TITAN_HOLD && !this.bossWinding()
  }

  canRescue() {
    const h = this.hero
    return !this.titanRescued && !this.titanMode && this.state === 'battle' && !(this.shieldUp && !this.shieldFragile) && !!h && !h.dead && this.bossWave() && !!this.boss && !this.boss.dead
  }

  rescueTitan() {
    const h = this.hero
    if (!this.canRescue() || h.hp <= 0 || h.hp >= h.maxHp * TITAN_RESCUE) return
    this.titanRescued = true
    this.rescueGuard = true
    this.titanCall = false
    this.clearDots()
    if (this.gearOpen) this.closeGear()
    this.titan = 1
    this.titanReady = true
    this.titanWait = TITAN_RESCUE_DELAY
    audio.play('vo_titan_charge')
    this.ui.showBanner('TITAN', 'to the rescue', 1.4)
    this.ui.setTitan(1, true, null)
    this.showPower()
  }

  addUlt(v) {
    if (this.ultReady || this.titanMode || this.state === 'morph') return
    this.ult = clamp(this.ult + v, 0, 1)
    if (this.ult < 1) return
    this.ultReady = true
    this.ultReadyAt = this.t
  }


  castUltimate() {
    if (!this.ultReady || this.titanMode || this.state !== 'battle' || !this.hero || this.hero.dead || this.heroLocked()) return false
    const h = this.hero
    const def = this.heroDef
    const u = def.ult
    this.ultReady = false
    this.ult = 0
    const foes = this.enemies
      .filter(e => !e.dead && e.pos.distanceTo(h.pos) <= u.reach)
      .sort((a, b) => a.pos.distanceTo(h.pos) - b.pos.distanceTo(h.pos))
      .slice(0, u.count)
    this.layerLegs(foes[0] ? this.aimHero(foes[0].pos.x, foes[0].pos.z) : h.facing)
    h.rig.play('cast', { force: true, skill: 4 })
    audio.play(`${def.model}_ult`)
    const hit = (e, i, share = 1) => {
      if (!e || e.dead || this.state !== 'battle') return
      this.damage(e, u.dmg * share, def.color, null, true)
      this.stun(e, 0.4)
    }
    const landed = () => {
      if (this.state !== 'battle') return
      this.lights.flash(h.pos, def.color, 6, 12, 0.9, 1.5)
      this.shake(0.7, 0.45)
      this.hitStop(HIT_STOP.ult)
    }
    const impact = h.rig.impactAt || 0.6
    const vfxId = this.heroVfx()
    if (vfxId && this.heroFx.hasSkill(vfxId, u.fx)) {
      this.heroFx.castSkill(vfxId, u.fx, h, foes, { impact, timing: u.timing, anchored: !!u.anchored, onHit: hit, onImpact: landed })
    } else {
      this.heroFx.later(impact, () => {
        foes.forEach(hit)
        landed()
      })
    }
    return true
  }

  transform() {
    if (!this.titanReady || this.titanMode || this.state !== 'battle') return
    this.titanReady = false
    this.rescueGuard = false
    this.finishMoveHint()
    if (this.gearOpen) this.closeGear()
    this.state = 'morph'
    this.ui.setTitan(1, false, 0)
    this.ui.pressAnima()
    audio.play(`${this.titanDef.model}_morph`)
    audio.duck(0.25, 300)
    audio.track('music_titan', 400)
    this.hero.rig.play('morph', { force: true })
    this.input.enabled = false
    this.input.release()

    const h = this.hero
    this.lights.flash(h.pos, 0x6fd8ff, 7, 15, 1.2, 1.6)
    this.shake(0.5, 0.5)

    gsap.to(this.bloom, { intensity: BLOOM_BASE * 2, duration: 0.3, yoyo: true, repeat: 1 })
    const titanView = this.battleOffset(TITAN_ZOOM_OUT)
    gsap.to(this.camOffset, { x: titanView.x, y: titanView.y, z: titanView.z, duration: MORPH_CAMERA, ease: 'power2.inOut', overwrite: true })
    gsap.to(this.camLook, { y: 2.4, duration: MORPH_CAMERA, ease: 'power2.inOut', overwrite: true })

    const epoch = this.epoch
    setTimeout(() => { if (epoch === this.epoch) this.finishMorph() }, MORPH_SWAP * 1000)
  }

  async loadTitan(def) {
    const [data] = await Promise.all([loadModelData(def.model), this.vfx.preload([def.vfx])])
    return { data, land: landingTime(data, 'Morph') }
  }

  heroLocked() {
    const rig = this.hero.rig
    return (rig.state === 'morph' || rig.state === 'unmorph') && !rig.oneShotDone
  }

  resetSkillCooldowns() {
    this.cooldowns.s1 = this.cooldowns.s2 = 0
  }

  async finishMorph() {
    if (this.titanMode || this.state !== 'morph' || this.summoning) return
    this.summoning = true

    const h = this.hero
    const def = this.titanDef

    const epoch = this.epoch
    const { data, land } = await this.titanLoad
    if (epoch !== this.epoch) return
    this.summoning = false
    const model = this.takeModel(data)
    const titan = new Actor(model, { targetHeight: model.height * h.scale * (def.size || 1), radius: def.radius })
    titan.setPos(h.pos.x, h.pos.z)
    titan.targetFacing = titan.facing = h.facing
    titan.hp = Math.max(h.hp, h.maxHp * TITAN_BORN_MIN) * 2.2
    titan.maxHp = h.maxHp * 2.2
    titan.rig.minFade = HERO_MIN_FADE
    titan.rig.retimeCombo(def.combo)
    titan.rig.play('morph', { force: true })
    this.heroFx.detachSkin(h)
    this.scene.remove(h.root)
    this.scene.add(titan.root)
    this.heroFx.attachSkin(def.vfx, titan)
    this.heroBase = h
    this.hero = titan
    this.titanMode = true
    this.titanT = def.duration
    this.state = 'battle'
    this.input.enabled = true
    this.resetSkillCooldowns()

    this.heroLight.color.set(def.color)
    this.heroLight.intensity = 40
    this.key.intensity = 3.4
    this.bloom.intensity = BLOOM_BASE * 1.4
    this.ui.setHp(titan.hp, titan.maxHp)
    this.ui.showBanner(def.name.toUpperCase(), def.title, 1.5)

    const landed = () => {
      if (this.hero !== titan) return
      this.lights.flash(titan.pos, def.color, 8, 18, 1.1, 1.5)
      this.shake(1.1, 0.7)
      this.hitStop(HIT_STOP.morph)
      audio.play('explosion')
      audio.play(`${def.model}_summon_vo`)
      for (const e of this.enemies) {
        if (!e.dead) e.stagger = 1.1
      }
    }
    const foes = this.enemies.filter(e => !e.dead && e.pos.distanceTo(titan.pos) <= 9)
    const summoned = this.heroFx.morph(def.vfx, 11, titan, h, foes, {
      impact: land,
      onHit: e => {
        if (!e.dead && this.hero === titan) this.damage(e, def.landDmg || 160, def.color, null, true)
      },
      onImpact: landed,
    })
    if (!summoned) this.heroFx.later(land, landed)
  }

  endTitan() {
    if (!this.titanMode || this.unmorphing) return
    this.unmorphing = true
    const t = this.hero
    t.pendingHit = null
    this.input.enabled = false
    t.rig.play('unmorph', { force: true })
    audio.play(`${this.titanDef.model}_demorph`)
    this.heroFx.morph(this.titanDef.vfx, 12, t, null, [])
    this.heroFx.later(t.rig.impactAt || 0.4, () => this.restoreHero())
  }

  restoreHero() {
    this.unmorphing = false
    this.titanMode = false
    this.titanT = 0
    this.titan = 0
    this.ui.setTitan(0, false, this.titanSecondsLeft())
    this.ui.setTitanTimer(0, false)
    const t = this.hero
    const h = this.heroBase
    this.heroFx.detachSkin(t)
    h.setPos(t.pos.x, t.pos.z)
    h.facing = h.targetFacing = t.facing
    const before = h.hp
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * TITAN_HEAL)
    this.healSum += h.hp - before
    h.rig.play('unmorph', { force: true })
    this.scene.remove(t.root)
    this.retireActor(t)
    this.scene.add(h.root)
    this.hero = h
    this.input.enabled = true
    this.resetSkillCooldowns()
    for (const e of this.enemies) if (!e.dead && e.def.skills) e.castGap = Math.max(e.castGap || 0, TITAN_END_GAP)
    if (this.heroDef.vfx) this.heroFx.attachSkin(this.heroDef.vfx, h)
    this.heroLight.color.set(this.heroDef.color)
    this.heroLight.intensity = 16
    this.key.intensity = 2.5
    this.bloom.intensity = BLOOM_BASE
    this.ui.setHp(h.hp, h.maxHp)
    this.showPower()
    this.flushSet()
    const battleView = this.battleOffset()
    gsap.to(this.camOffset, { x: battleView.x, y: battleView.y, z: battleView.z, duration: 1.0, ease: 'power2.inOut' })
    gsap.to(this.camLook, { y: BATTLE_LOOK_Y, duration: 1.0 })
    audio.track('music_battle', 700)
  }

  victory() {
    if (this.state === 'end') return
    this.state = 'end'
    sayProgress(1)
    sayOnce('solved')
    trackRunEnd('win', this.runStats())
    const epoch = this.epoch
    this.ui.show('hud', false)
    audio.duck(0.3, 400)
    this.shake(0.4, 0.5)
    if (this.hero) this.hero.rig.play('roar', { force: true })
    setTimeout(() => { if (epoch === this.epoch) this.showOutcome('victory') }, 1400)
  }

  defeat() {
    if (this.state === 'end') return
    this.state = 'end'
    sayOnce('failed')
    trackRunEnd('lose', this.runStats())
    this.lost = true
    const epoch = this.epoch
    this.ui.show('hud', false)
    const short = this.underpowered()
    if (short) this.ui.showBanner('TOO WEAK', 'equip gear to beat him', DEFEAT_REASON_DELAY)
    setTimeout(() => { if (epoch === this.epoch) this.showOutcome('defeat') }, short ? DEFEAT_REASON_DELAY * 1000 : 1200)
  }

  showOutcome(kind) {
    sayOnce('endcard')
    const defeat = kind === 'defeat'
    audio.layer('amb_battle', false, 500)
    audio.track('music_endcard', 500)
    if (this.heroDef) audio.stop(`${this.heroDef.model}_death`, 300)
    if (defeat) audio.play('outcome_defeat', { delay: 0.06 })
    audio.play(defeat ? 'outcome_defeat_vo' : 'outcome_victory_vo', { delay: defeat ? 0.46 : 0.45 })
    audio.play('outcome_card_plate', { delay: 0.06 })
    audio.play('outcome_card_shine', { delay: 0.16 })
    this.ui.outcome.show(kind)
  }

  runStats() {
    return {
      hero: this.heroIndex,
      wave: this.waveIndex + 1,
      kills: this.kills,
      power: this.gear ? this.gear.power() : 0,
      titan: this.titanMode ? 1 : 0,
    }
  }

  retry() {
    if (this.retrying) return
    this.retrying = true
    trackRetry()
    setTimeout(() => {
      this.retrying = false
      this.restartBattle()
    }, RETRY_DELAY)
  }

  async restartBattle() {
    if (this.state === 'boot' || this.state === 'intro') return
    if (this.lost) sayOnce('retry')
    bootMark('restart')
    if (this.state === 'select') {
      await this.startBattle()
      return
    }
    this.clearBattle()
    await this.startBattle()
  }

  clearBattle() {
    this.shieldPending = this.setPending = false
    if (this.gearOpen) this.closeGear()
    this.epoch++
    gsap.killTweensOf(this.camOffset)
    gsap.killTweensOf(this.camLook)
    gsap.killTweensOf(this.bloom)
    this.ui.outcome.hide()
    this.ui.show('end', false)
    this.clearHints()
    if (this.gearOpen) this.closeGear()
    for (const e of this.enemies) {
      e.dead = true
      this.heroFx.detachSkin(e)
      this.scene.remove(e.root)
      this.retireActor(e)
    }
    this.enemies = []
    this.ui.pruneEnemyBars([])
    this.floats.clear()
    for (const a of [this.hero, this.heroBase]) {
      if (!a) continue
      this.heroFx.detachSkin(a)
      this.scene.remove(a.root)
      this.retireActor(a)
    }
    this.hero = this.heroBase = this.boss = null
    this.bossPull = 1
    this.bossView = 0
    this.gateView = 0
    this.gateLookT = 0
    this.gateIndex = -1
    this.waveGates = []
    this.rerouteK = 0
    this.camSafe = 1
    this.camSafeWant = 1
    this.gateSafe = 1
    this.gateSafeWant = 1
    this.pending = []
    this.spawning = 0
    this.loot.clear()
    this.guide.clear()
    this.heroFx.clear()
    this.vfx.clear()
    this.lights.clear()
    this.titan = this.titanT = this.ult = 0
    this.titanReady = this.titanMode = this.ultReady = this.titanRescued = false
    this.titanWait = 0
    this.unmorphing = this.summoning = false
    this.kills = this.lootWait = 0
    this.timeScale = 1
    this.shieldUp = this.shieldFragile = false
    this.ui.setShield(false)
    this.immuneT = 0
    for (const k in this.cooldowns) this.cooldowns[k] = 0
    this.queuedCast = null
    this.ui.setTitanTimer(0, false)
    this.heroLight.intensity = 22
    this.key.intensity = 2.5
    this.bloom.intensity = BLOOM_BASE
  }

  stateKey(kind) {
    if (this.state === 'boot' || this.state === 'intro') return
    if (kind === 'restart') {
      this.restartBattle()
      return
    }
    if (this.state === 'end') return
    if (this.state !== 'battle') {
      this.ui.show('select', false)
    }
    if (kind === 'victory') this.victory()
    else this.defeat()
  }

  updateHero(dt) {
    const h = this.hero
    if (!h || h.dead) return
    const def = this.activeDef()
    const steer = this.moveAxis()
    const hold = this.gearOpen && !steer[0] && !steer[1]
    const axis = hold ? _still : steer
    const ax = axis[0]
    const az = axis[1]
    if (hold) h.targetFacing = this.camYaw
    const moving = (ax || az) && !this.heroLocked()

    if (moving) {
      const sp = def.speed * (this.titanMode ? 1 : 1)
      h.pos.x += ax * sp * dt
      h.pos.z += az * sp * dt
      h.targetFacing = Math.atan2(ax, az)
    }
    if (h.knockX || h.knockZ) this.slide(h, dt)

    const r = Math.hypot(h.pos.x, h.pos.z)
    const lim = ARENA_RADIUS - 1.2
    if (r > lim) {
      h.pos.x *= lim / r
      h.pos.z *= lim / r
    }

    const busy = BUSY_STATES.has(h.rig.state) && !h.rig.oneShotDone
    if (!busy) h.aimYaw = undefined
    const layered = !!moving && busy && LAYERED_STATES.has(h.rig.state)
    h.rig.setLegs(layered, this.runRate(h, def))
    h.rig.aim(layered ? clamp(wrapAngle((h.aimYaw ?? h.facing) - h.facing), -TWIST_MAX, TWIST_MAX) : 0)
    if (!busy && (moving || h.rig.finished) && h.rig.state !== (moving ? 'run' : 'idle')) h.rig.play(moving ? 'run' : 'idle', moving ? { speed: this.runRate(h, def) } : NO_OPTS)

    if (h.pendingHit) {
      h.attackT += dt
      if (h.attackT >= h.pendingHit.delay) {
        const p = h.pendingHit
        h.pendingHit = null
        let hits = 0
        for (const e of this.enemies) {
          if (e.dead) continue
          const dx = e.pos.x - h.pos.x
          const dz = e.pos.z - h.pos.z
          const d = Math.hypot(dx, dz)
          if (d > p.range + e.radius) continue
          const ang = Math.atan2(dx, dz)
          let da = ang - (p.aim ?? h.facing)
          while (da > Math.PI) da -= Math.PI * 2
          while (da < -Math.PI) da += Math.PI * 2
          if (Math.abs(da) > p.arc + Math.asin(Math.min(1, e.radius / (d || 1)))) continue
          const crit = this.damage(e, p.dmg, def.color, `${def.model}_hit_combo`)
          if (p.fx !== null && p.fx !== undefined && p.vfx) this.heroFx.hitFx(p.vfx, p.fx, h, e)
          if (this.stun(e, 0.2)) this.knock(e, dx / (d || 1), dz / (d || 1), (this.titanMode ? KNOCK.titan : KNOCK.hero) * (crit ? CRIT_KNOCK : 1))
          this.hitFreeze(e, this.titanMode ? HIT_STOP.titan : HIT_STOP.basic)
          hits++
        }
        if (hits) this.shake(this.titanMode ? HIT_SHAKE.titan : HIT_SHAKE.hero, 0.16)
      }
    }

    this.heroLight.position.set(h.pos.x, 2.6, h.pos.z)
  }

  runRate(actor, def) {
    if (actor.runRate === undefined) {
      const rate = (actor.moveSpeed || def.speed) / (strideSpeed(actor.model, 'Run') * actor.scale)
      actor.runRate = rate >= RUN_RATE[0] && rate <= RUN_RATE[1] ? rate : actor.moveSpeed && Number.isFinite(rate) && rate > 0 ? clamp(rate, RUN_RATE[0], RUN_RATE[1]) : 1
    }
    return actor.runRate
  }

  thinCrowdAnimation(h) {
    let alive = 0
    for (let i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) alive++
    const crowd = alive > ANIM_LOD_CROWD && h
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      const far = crowd && !e.dead && !e.def.boss && (e.onScreen === false || Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) > ANIM_LOD_NEAR)
      e.rig.lod = far ? 2 : 1
    }
  }

  updateEnemies(dt, fadeDt = dt) {
    const h = this.hero
    this.thinCrowdAnimation(h)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (e.dead) {
        if (e.def.boss) {
          if (this.sinkCorpse(e, fadeDt)) {
            this.scene.remove(e.root)
            this.retireActor(e)
            this.enemies.splice(i, 1)
          }
          continue
        }
        if (e.dying > 1.5) {
          this.scene.remove(e.root)
          this.retireActor(e)
          this.enemies.splice(i, 1)
        } else {
          if (e.knockX || e.knockZ) {
            this.slide(e, fadeDt)
            const r = Math.hypot(e.pos.x, e.pos.z)
            const lim = ARENA_RADIUS - 0.4
            if (r > lim && !e.entering) {
              e.pos.x *= lim / r
              e.pos.z *= lim / r
            }
          }
          const melt = clamp((e.dying - CORPSE_MELT_START) / CORPSE_MELT_TIME, 0, 1)
          useOwnLook(e.model)
          for (const s of e.model.skins) {
            if (dissolveLook(s.material, melt)) continue
            s.material.transparent = true
            s.material.opacity = 1 - melt
          }
          if (melt > CORPSE_SHADOW_OFF && e.model.body) e.model.body.castShadow = false
          e.update(fadeDt)
        }
        continue
      }
      if (this.state === 'end' || !h || h.dead) {
        const rest = e.def.fly ? 'fly' : 'idle'
        if (e.rig.state !== rest && (e.def.boss ? e.rig.finished : e.rig.oneShotDone)) e.rig.play(rest, { fade: 0.25 })
        e.update(dt)
        continue
      }
      if (e.knockX || e.knockZ) this.slide(e, dt)
      if (e.entering && this.enterArena(e, h, dt)) continue
      if (e.rushT > 0) this.easeRush(e, h, dt)
      if (e.poise > 0) e.poise -= dt
      if (e.def.boss || e.def.steady || e.cast || this.committed(e)) e.stagger = 0
      if (e.stagger > 0) {
        e.stagger -= dt
        if (e.rig.state !== 'hit') e.rig.play('hit', { force: true, fade: ENEMY_HIT_FADE })
        e.update(dt)
        continue
      }
      if (e.def.boss && !e.cast && e.rig.finished && e.rig.comboOpen) {
        this.enemyAttack(e, e.def.range)
        this.settleEnemy(e, h, dt)
        continue
      }
      if (e.def.skills && this.updateBossCast(e, dt)) {
        if (e.airborne) {
          if (e.def.boss && !(e.cast && e.cast.native)) this.blockHero(e, h, dt)
          e.update(dt)
        } else this.settleEnemy(e, h, dt)
        continue
      }
      if (this.committed(e)) {
        e.cd -= dt
        this.settleEnemy(e, h, dt)
        continue
      }

      if (e.def.boss) this.bossStride(e, dt)
      const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z) || 1
      e.faceTo(h.pos.x, h.pos.z)
      const range = e.range + (this.titanMode ? 2.2 : 0)
      const reach = range + (e.chasing ? 0 : CHASE_SLACK)
      const keep = d > reach && d < (e.def.keep || 0)
      const turning = Math.abs(wrapAngle(e.targetFacing - e.facing)) > TURN_IN_PLACE
      const rested = e.chasing || e.restT >= ENEMY_REST_MIN || d > range + CHASE_FAR
      e.chasing = e.def.boss ? this.bossChasing(e, d, range) : d > reach && !keep && !turning && rested
      e.restT = e.chasing ? 0 : (e.restT || 0) + dt
      if (e.def.boss) e.turnRate = e.chasing ? BOSS_RUN_TURN : BOSS_TURN

      if (e.chasing) {
        const slow = (this.titanMode && !e.def.boss ? 0.7 : 1) * (e.rushT > 0 && !e.def.boss ? ENTRY_RUSH : 1)
        const sp = e.moveSpeed * slow
        if (!e.def.boss) {
          e.pos.x += Math.sin(e.facing) * sp * dt
          e.pos.z += Math.cos(e.facing) * sp * dt
        }
        if (!e.def.fly && e.rig.state !== 'run') e.rig.play('run', { fade: e.def.boss ? BOSS_RUN_FADE : 0.18, speed: e.def.boss ? 1 : this.runRate(e, e.def) * slow })
        else if (e.def.fly && e.rig.state !== 'fly' && e.rig.finished) e.rig.play('fly', { fade: 0.18 })
      } else {
        const rest = e.def.fly ? 'fly' : 'idle'
        if (e.rig.state !== rest && e.rig.finished) e.rig.play(rest, { fade: e.def.boss ? BOSS_REST_FADE : ENEMY_REST_FADE })
        if (d <= reach) {
          e.cd -= dt
          if (e.cd <= 0 && (!e.def.boss || this.bossStill(e)) && this.aimedAt(e, h)) this.enemyAttack(e, range)
        }
      }

      this.settleEnemy(e, h, dt)
    }
  }

  committed(e) {
    return e.def.boss ? !e.rig.finished : e.rig.state === 'attack' && !e.rig.oneShotDone
  }

  mobility(e) {
    return e.def.boss || e.def.steady || e.cast || e.airborne || this.committed(e) ? 0 : 1 / (e.radius * e.radius)
  }

  blockHero(e, h, dt) {
    const hx = e.pos.x - h.pos.x
    const hz = e.pos.z - h.pos.z
    const hd = Math.hypot(hx, hz)
    const hmin = e.radius + (this.titanMode ? 1.6 : h.radius)
    if (hd >= hmin) return
    const nx = hd > 0.001 ? hx / hd : Math.sin(e.facing + Math.PI)
    const nz = hd > 0.001 ? hz / hd : Math.cos(e.facing + Math.PI)
    if (this.mobility(e) > 0 || (this.titanMode && !e.def.boss && !e.cast)) {
      e.pos.x = h.pos.x + nx * hmin
      e.pos.z = h.pos.z + nz * hmin
      return
    }
    const gap = hmin - hd
    const k = gap > SHOVE_SNAP ? Math.min(1, dt * SHOVE_RATE) : 1
    h.pos.x -= nx * gap * k
    h.pos.z -= nz * gap * k
    const r = Math.hypot(h.pos.x, h.pos.z)
    const lim = ARENA_RADIUS - 1.2
    if (r > lim) {
      h.pos.x *= lim / r
      h.pos.z *= lim / r
    }
  }

  clearAroundHero(dt) {
    const h = this.hero
    const k = 1 - Math.exp(-dt * GEAR_CLEAR_RATE)
    const vx = this.camera.position.x - h.pos.x
    const vz = this.camera.position.z - h.pos.z
    const vl = Math.hypot(vx, vz) || 1
    const cx = vx / vl
    const cz = vz / vl
    const zone = this.ui.gearRing.zone
    for (const e of this.enemies) {
      if (e.dead || e.def.boss || e.entering) continue
      const dx = e.pos.x - h.pos.x
      const dz = e.pos.z - h.pos.z
      const reach = GEAR_CLEAR + e.radius
      const along = dx * cx + dz * cz
      const side = dx * cz - dz * cx
      let px = 0
      let pz = 0
      if (along > 0 && along < GEAR_CLEAR_FRONT && Math.abs(side) < reach) {
        const need = (side >= 0 ? reach : -reach) - side
        px = cz * need
        pz = -cx * need
      } else {
        const d = Math.hypot(dx, dz)
        if (d < reach && d >= 1e-3) {
          px = (dx / d) * (reach - d)
          pz = (dz / d) * (reach - d)
        }
      }
      e.pos.x += px * k
      e.pos.z += pz * k
      if (zone && this.insideGearZone(e, zone)) {
        const d = Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z)
        const nx = d > 1e-3 ? (e.pos.x - h.pos.x) / d : cz
        const nz = d > 1e-3 ? (e.pos.z - h.pos.z) / d : -cx
        e.pos.x += nx * GEAR_ZONE_PUSH * dt
        e.pos.z += nz * GEAR_ZONE_PUSH * dt
      }
      const r = Math.hypot(e.pos.x, e.pos.z)
      const lim = ARENA_RADIUS - 0.8
      if (r > lim) {
        e.pos.x *= lim / r
        e.pos.z *= lim / r
      }
    }
  }

  insideGearZone(e, zone) {
    _v.set(e.pos.x, e.pos.y, e.pos.z).project(this.camera)
    const footX = (_v.x * 0.5 + 0.5) * view.w
    const footY = (-_v.y * 0.5 + 0.5) * view.h
    _v.set(e.pos.x, e.pos.y + e.height, e.pos.z).project(this.camera)
    const headY = (-_v.y * 0.5 + 0.5) * view.h
    const half = (footY - headY) * e.radius / e.height
    return footX + half > zone.l - GEAR_ZONE_PAD && footX - half < zone.r + GEAR_ZONE_PAD && footY > zone.t - GEAR_ZONE_PAD && headY < zone.b + GEAR_ZONE_PAD
  }

  stun(e, time) {
    if (e.poise > 0 && !this.titanMode) return false
    e.stagger = Math.max(e.stagger, time)
    e.poise = time + MOB_POISE
    return true
  }

  knock(e, nx, nz, dist) {
    if (e.def && (e.def.boss || e.def.steady || e.cast || this.committed(e))) return
    e.knockX = (e.knockX || 0) + nx * dist
    e.knockZ = (e.knockZ || 0) + nz * dist
  }

  slide(e, dt) {
    const f = 1 - Math.exp(-dt * KNOCK_RATE)
    e.pos.x += e.knockX * f
    e.pos.z += e.knockZ * f
    e.knockX *= 1 - f
    e.knockZ *= 1 - f
    if (Math.abs(e.knockX) + Math.abs(e.knockZ) < 0.01) e.knockX = e.knockZ = 0
  }

  enemyAttack(e, range) {
    e.cd = e.rate
    if (this.state !== 'battle' || !this.hero || this.hero.dead) return
    const elite = !e.def.boss && e.size >= ELITE_SIZE
    e.rig.play('attack', { force: true, fade: 0.08, speed: elite ? ELITE_SWING_SPEED : 1 })
    audio.play(this.attackSound(e.def, e.rig), { at: e.pos, slot: 'enemy_attack', max: 3 })
    if (elite && audio.has(`${soundCode(e.def)}_skill_1`)) audio.play(`${soundCode(e.def)}_skill_1`, { at: e.pos, slot: 'enemy_skill', max: 2 })
    const combo = this.comboIndexOf(e.rig)
    const weight = e.def.boss ? BOSS_STRIKE[clamp(combo, 1, BOSS_STRIKE.length) - 1] : 0
    const pattern = e.def.boss ? BOSS_SWINGS[clamp(combo, 1, BOSS_SWINGS.length) - 1] : elite ? ELITE_SWING : null
    const swing = (e.def.boss && this.takePreSwing(e, combo)) || (pattern ? this.aimSwing(e, pattern, range + ENEMY_HIT_SLACK) : null)
    const land = () => {
      if (!this.hero || this.hero.dead) return false
      this.hurtHero(e.def.dmg * e.might * (swing ? swing.dmg : 1), ENEMY_HITS[e.type], e.pos)
      audio.play(`${soundCode(e.def)}_hit_combo`, { at: e.pos, slot: 'enemy_hit', max: 2, gap: 0.08 })
      return true
    }
    const vfxId = this.enemyVfx(e.def)
    const fxRes = vfxId ? this.heroFx.attack(vfxId, combo, e, e.def.boss ? null : this.hero, {
      impact: e.rig.impactAt,
      exact: true,
      reach: e.def.boss ? BOSS_AOE_REACH : range + ENEMY_HIT_SLACK,
      onHit: t => {
        if (!e.dead && t === this.hero && this.state === 'battle') land()
      },
    }) : null
    if (fxRes && fxRes.ranged) return
    this.heroFx.later(e.rig.impactAt, () => {
      if (e.dead || !this.hero || this.state !== 'battle') return
      const dd = Math.hypot(this.hero.pos.x - e.pos.x, this.hero.pos.z - e.pos.z)
      const inside = swing ? this.insideCast(swing, this.hero) : dd <= range + ENEMY_HIT_SLACK
      const hit = inside && land()
      if (swing && !hit && dd < range + DODGE_REACH) this.sayDodged()
      if (e.def.boss && combo === BOSS_SWINGS.length - 1) this.preAimSwing(e)
      if (weight) this.bossStrike(e, weight, range, hit)
      if (hit && fxRes) fxRes.onTarget(this.hero)
    })
  }

  preAimSwing(e) {
    const p = BOSS_SWINGS[BOSS_SWINGS.length - 1]
    const s = e.preSwing || (e.preSwing = swingShape())
    const yaw = e.facing
    s.center.set(e.pos.x + Math.sin(yaw) * p.ahead, 0, e.pos.z + Math.cos(yaw) * p.ahead)
    s.yaw = yaw
    s.radius = p.radius
    s.arc = p.arc
    s.dmg = p.dmg
    const windup = Math.max(0.3, e.rig.total - e.rig.stateT + (e.def.impacts.ComboAttack_3 || 0.6))
    s.warn = this.fx.warn({ x: s.center.x, z: s.center.z, yaw, radius: p.radius, arc: p.arc, windup })
  }

  takePreSwing(e, combo) {
    const pre = e.preSwing
    if (!pre || !pre.warn) return null
    if (combo !== BOSS_SWINGS.length) {
      this.fx.dropWarn(pre.warn)
      pre.warn = null
      return null
    }
    const s = e.swing || (e.swing = swingShape())
    s.center.copy(pre.center)
    s.yaw = pre.yaw
    s.radius = pre.radius
    s.arc = pre.arc
    s.dmg = pre.dmg
    s.warn = pre.warn
    pre.warn = null
    return s
  }

  aimSwing(e, p, reach) {
    const s = e.swing || (e.swing = swingShape())
    const yaw = e.facing
    s.center.set(e.pos.x + Math.sin(yaw) * p.ahead, 0, e.pos.z + Math.cos(yaw) * p.ahead)
    s.yaw = yaw
    s.radius = p.radius || reach
    s.arc = p.arc
    s.dmg = p.dmg
    s.warn = this.fx.warn({ x: s.center.x, z: s.center.z, yaw, radius: s.radius, arc: p.arc, windup: e.rig.impactAt })
    return s
  }

  sayDodged() {
    if (this.titanMode || this.t - (this.statusAt.dodge ?? -STATUS_GAP) < STATUS_GAP) return
    this.statusAt.dodge = this.t
    const h = this.hero
    this.floatText(h.pos.x, h.height * STATUS_LIFT + h.pos.y, h.pos.z, 'DODGED', 'dmg status')
    audio.play('dash', { slot: 'dodge', gap: 0.4 })
  }

  bossStrike(e, weight, range, hit) {
    const h = this.hero
    const dx = h.pos.x - e.pos.x
    const dz = h.pos.z - e.pos.z
    const d = Math.hypot(dx, dz)
    const reach = Math.min(d, range)
    if (hit) _v.set(h.pos.x, 0, h.pos.z)
    else _v.set(e.pos.x + Math.sin(e.facing) * reach, 0, e.pos.z + Math.cos(e.facing) * reach)
    this.lights.flash(_v, BOSS_STRIKE_FLASH, 5 * weight, 10 * weight, 0.45, 0.9)
    audio.play('step_big_anima_bosses', { at: _v, slot: 'boss_strike', max: 1, gap: 0.2 })
    const near = clamp(1 - d / BOSS_STRIKE_REACH, 0, 1)
    this.shake((hit ? BOSS_LAND_SHAKE : BOSS_STRIKE_SHAKE * near) * weight, 0.3 + 0.12 * weight)
    if (!hit) return
    this.hitStop(BOSS_LAND_STOP * weight)
    audio.play('explosion_vfx_3', { slot: 'boss_land', max: 1, gap: 0.2 })
    if (weight <= 1 || d < 0.01 || this.heroLocked()) return
    const push = Math.min(HERO_PUSH_MAX, BOSS_FINISH_PUSH * (weight - 1) * this.heroPoise())
    h.knockX = (h.knockX || 0) + (dx / d) * push
    h.knockZ = (h.knockZ || 0) + (dz / d) * push
  }

  settleEnemy(e, h, dt) {
    const me = this.mobility(e)
    for (let k = 0; me > 0 && k < this.enemies.length; k++) {
      const o = this.enemies[k]
      if (o === e || o.dead || o.airborne) continue
      const ox = e.pos.x - o.pos.x
      const oz = e.pos.z - o.pos.z
      const od = Math.hypot(ox, oz)
      const min = e.radius + o.radius
      if (od < min && od > 0.001) {
        const push = ((min - od) * me) / (me + this.mobility(o))
        e.pos.x += (ox / od) * push
        e.pos.z += (oz / od) * push
      }
    }

    this.blockHero(e, h, dt)

    const er = Math.hypot(e.pos.x, e.pos.z)
    const elim = ARENA_RADIUS - 0.4
    if (er > elim && !e.entering) {
      const k = e.easeIn ? 1 + (elim / er - 1) * Math.min(1, dt * ENTRY_EASE) : elim / er
      e.pos.x *= k
      e.pos.z *= k
    }

    if (e.def.fly) e.pos.y = e.def.fly + Math.sin(this.t * 2.4 + e.rig.t) * 0.25
    e.update(dt)
    const stepSound = e.stepSound || (e.stepSound = { at: e.pos, slot: 'enemy_step', max: 2 })
    this.footsteps(e, soundCode(e.def), e.def.boss ? 'step_big_middle_bosses' : 'step_ground', stepSound)
  }

  hurtHero(dmg, hit = null, from = null) {
    if (!this.hero || this.hero.dead || this.state !== 'battle') return
    const share = hit && hit.dot ? hit.share ?? 1 : 1
    if (share < 1) this.addDot(hit, dmg * (1 - share))
    this.woundHero(dmg * share, hit, false)
    if (hit && this.hero && !this.hero.dead) this.strikeHero(hit, from)
  }

  woundHero(dmg, hit, tick) {
    if (this.rescueGuard && !this.titanMode) return
    const kind = HIT_KINDS[hit ? hit.kind : 'slash']
    const weak = this.titanMode ? 0 : this.painNow()
    const pain = Math.max(this.shieldUp && !this.shieldFragile ? SHIELD_HIT_MULT : 1, 1 + WEAK_HURT * weak)
    const mult = (this.titanMode ? 0.25 : 1) * (this.gearMods ? this.gearMods.taken : 1) * pain
    let lost = hit && hit.boss && !tick && !this.titanMode ? Math.min(dmg * mult, this.hero.maxHp * BOSS_HIT_CAP) : dmg * mult
    if (lost >= this.hero.hp && this.canRescue()) lost = Math.max(0, this.hero.hp - 1)
    this.hero.hp = Math.max(0, this.hero.hp - lost)
    this.takenSum += lost
    this.rescueTitan()
    this.hero.flashColor = kind.rim
    this.hero.flash = tick ? DOT_FLASH : 0.16
    this.ui.setHp(this.hero.hp, this.hero.maxHp)
    if (!tick) {
      const boss = hit && hit.boss ? BOSS_HIT_CHROMA : 1
      this.shake(0.22 * kind.shake * (1 + weak), 0.2 + 0.06 * kind.shake + 0.15 * weak)
      audio.play(`${this.activeDef().model}_damage`, { slot: 'hero_hurt', gap: 0.35 })
      this.chroma.offset.set(0.0035 * boss * (1 + weak), 0.0035 * boss * (1 + weak))
      gsap.to(this.chroma.offset, { x: 0.0004, y: 0.0004, duration: 0.45 * boss })
    }
    if (weak >= WEAK_WARN) this.warnWeak()
    if (!this.titanMode) this.addUlt(dmg * 0.0012)
    if (this.hero.hp <= 0) {
      if (this.titanMode) { this.endTitan(); return }
      this.hero.dead = true
      this.clearDots()
      this.hero.rig.play('death', { force: true })
      audio.play(`${this.heroDef.model}_death`)
      this.defeat()
    }
  }

  strikeHero(hit, from) {
    const h = this.hero
    const kind = HIT_KINDS[hit.kind]
    if (kind.label && this.t - (this.statusAt[hit.kind] ?? -STATUS_GAP) >= STATUS_GAP) {
      this.statusAt[hit.kind] = this.t
      this.floatText(h.pos.x, h.height * STATUS_LIFT + h.pos.y, h.pos.z, kind.label, 'dmg status')
    }
    if (kind.light) this.lights.flash(h.pos, kind.light, 2.4, 5, 0.35, h.height * 0.6)
    if (!hit.push || !from || this.heroLocked()) return
    const dx = h.pos.x - from.x
    const dz = h.pos.z - from.z
    const d = Math.hypot(dx, dz) || 1
    const push = Math.min(HERO_PUSH_MAX, hit.push * this.heroPoise())
    h.knockX = (h.knockX || 0) + (dx / d) * push
    h.knockZ = (h.knockZ || 0) + (dz / d) * push
  }

  heroPoise() {
    return this.titanMode ? HERO_KNOCK_TITAN : this.heroDef.poise ?? 1
  }

  addDot(hit, total) {
    const every = hit.dot.every
    const ticks = Math.max(1, Math.round(hit.dot.time / every))
    let same = 0
    let oldest = null
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i]
      if (d.hit !== hit) continue
      same++
      if (!oldest || d.left < oldest.left) oldest = d
    }
    let dot = oldest
    if (same < (hit.dot.stacks || 1)) {
      dot = this.dotPool.pop() || { hit: null, left: 0, next: 0, per: 0 }
      dot.left = 0
      dot.per = 0
      this.dots.push(dot)
    }
    dot.per = (total + dot.per * dot.left) / ticks
    dot.hit = hit
    dot.left = ticks
    dot.next = every
  }

  tickDots(dt) {
    if (this.gearOpen) return
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i]
      if (!d) continue
      d.next -= dt
      if (d.next > 0) continue
      d.next += d.hit.dot.every
      d.left--
      if (this.hero && !this.hero.dead && this.state === 'battle') this.woundHero(d.per, d.hit, true)
      if (d.left > 0 || this.dots[i] !== d) continue
      this.dots[i] = this.dots[this.dots.length - 1]
      this.dots.pop()
      this.dotPool.push(d)
    }
  }

  clearDots() {
    while (this.dots.length) this.dotPool.push(this.dots.pop())
  }

  footsteps(actor, code, key, opts = NO_OPTS) {
    const rig = actor.rig
    const clip = rig.state === 'run' && rig.action ? rig.action.getClip() : null
    const times = clip && STEPS[code] && STEPS[code][clip.name]
    if (!times) {
      actor.stepT = null
      return
    }
    const t = rig.action.time
    const prev = actor.stepT ?? t
    actor.stepT = t
    if (!stepCrossed(times, prev, t)) return
    audio.play(key, opts)
    if (actor.def && actor.def.boss && this.hero) this.bossStomp(actor)
  }

  bossStomp(boss) {
    const near = 1 - Math.hypot(boss.pos.x - this.hero.pos.x, boss.pos.z - this.hero.pos.z) / BOSS_STEP_REACH
    if (near > 0) this.shake(BOSS_STEP_SHAKE * near, 0.12)
  }

  portraitAmount() {
    return clamp((1.05 - this.camera.aspect) / 0.5, 0, 1)
  }

  phoneLandscapeAmount() {
    const small = PHONE_SHORT_SIDE[0]
    const large = PHONE_SHORT_SIDE[1]
    const short = Math.min(view.w, view.h)
    return clamp((large - short) / (large - small), 0, 1) * (1 - this.portraitAmount())
  }

  battleFraming() {
    return clamp((this.camOffset.length() - CLOSE_UP_DIST) / (BATTLE_DIST - CLOSE_UP_DIST), 0, 1)
  }

  fitBoss(dt) {
    const b = this.boss
    const live = !!(b && !b.dead)
    this.bossView += ((live ? 1 : 0) - this.bossView) * Math.min(1, dt * BOSS_FIT_RATE)
    const titan = this.titanMode && this.hero
    if (live || titan) this.camera.updateMatrixWorld()
    let want = live ? Math.max(BOSS_BACK, this.pullFor(b)) : 1
    if (titan) want = Math.max(want, this.pullFor(this.hero))
    this.bossPull += (want - this.bossPull) * Math.min(1, dt * BOSS_FIT_RATE)
  }

  pullFor(a) {
    _v.copy(a.pos)
    _v.y += a.height
    _v.project(this.camera)
    if (Math.abs(_v.x) > 1.1) return this.bossPull
    return clamp(this.bossPull * Math.max(0, _v.y) / BOSS_FIT_TOP, 1, BOSS_PULL_MAX)
  }

  battleReach(p, framing) {
    const far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1, PHONE_LAND_FAR_DIST, this.phoneLandscapeAmount()), PORTRAIT_FAR_DIST, p)
    const near = THREE.MathUtils.lerp(1, PORTRAIT_DIST, p)
    return THREE.MathUtils.lerp(near, far, framing)
  }

  fitCamera() {
    const fov = this.battleView ? this.battleFov() : this.selectFov()
    if (Math.abs(this.camera.fov - fov) > 0.01) this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }

  selectFov() {
    const p = this.portraitAmount()
    const fitWidth = 2 * Math.atan(Math.tan(PORTRAIT_HFOV / 2) / this.camera.aspect) * THREE.MathUtils.RAD2DEG
    return THREE.MathUtils.lerp(46, clamp(fitWidth, 46, 74), p * p * (3 - 2 * p))
  }

  battleFov() {
    const fitWidth = 2 * Math.atan(Math.tan(BATTLE_HFOV / 2) / this.camera.aspect) * THREE.MathUtils.RAD2DEG
    return Math.min(BATTLE_MAX_VFOV, fitWidth)
  }

  battleOffset(scale = 1) {
    const d = BATTLE_DIST * scale
    return new THREE.Vector3(0, Math.sin(BATTLE_PITCH) * d, Math.cos(BATTLE_PITCH) * d)
  }

  moveAxis() {
    const raw = this.input.axis()
    return this.screenAxis(raw[0], raw[1])
  }

  screenAxis(ax, az) {
    const c = Math.cos(this.camYaw)
    const s = Math.sin(this.camYaw)
    _axis[0] = ax * c + az * s
    _axis[1] = az * c - ax * s
    return _axis
  }

  cameraFocus() {
    if (this.hero) return this.hero.pos
    if (this.state === 'select' && this.selectActors && this.selectActors[this.heroIndex]) {
      return this.selectActors[this.heroIndex].pos
    }
    return _zero
  }

  updateCamera(dt) {
    const p = this.portraitAmount()
    const playing = this.state === 'battle' || this.state === 'intro' || this.state === 'end' || this.titanMode
    const zoom = playing ? p : 0
    const selecting = this.state === 'select'
    const centred = selecting
    if (centred) this.blendSelectPose(dt, this.camSnap)
    const follow = centred ? 1 : THREE.MathUtils.lerp(0.72 + 0.28 * p, 1, Math.max(this.gearK, this.orbitAmount()))
    const target = this.cameraFocus()
    _v.set(target.x * follow, 0, target.z * follow)
    const bossLook = playing && this.boss && this.hero ? this.bossView * (1 - this.gearK) * this.camSafe : 0
    if (bossLook > 0) {
      const dx = this.boss.pos.x - target.x
      const dz = this.boss.pos.z - target.z
      const k = Math.min(BOSS_FOCUS, BOSS_FOCUS_MAX / (Math.hypot(dx, dz) || 1)) * bossLook
      _v.x += dx * k
      _v.z += dz * k
    }
    if (this.gateLookT > 0) this.gateLookT -= dt
    this.gateView += ((playing && this.gateLookT > 0 && this.hero ? 1 : 0) - this.gateView) * Math.min(1, dt * GATE_LOOK_RATE)
    const gateLook = this.gateView * (1 - this.gearK) * (1 - bossLook) * this.gateSafe
    if (gateLook > 0.001) {
      const dx = this.gateAt.x - target.x
      const dz = this.gateAt.z - target.z
      const k = Math.min(GATE_FOCUS, THREE.MathUtils.lerp(GATE_FOCUS_MAX[0], GATE_FOCUS_MAX[1], p) / (Math.hypot(dx, dz) || 1)) * gateLook
      _v.x += dx * k
      _v.z += dz * k
    }
    if (this.gearBack > 0) this.gearBack = Math.max(0, this.gearBack - dt / GEAR_BACK)
    const chase = GEAR_CHASE * Math.max(this.gearK, this.gearBack)
    if (this.camSnap) this.camTarget.copy(_v)
    else if (selecting && dt > 0) smoothDamp(this.camTarget, _v, _camVel, SELECT_CAM_SMOOTH, dt)
    else this.camTarget.lerp(_v, Math.min(1, dt * (3.2 + chase)))
    const push = selecting && this.confirming ? Math.min(1, this.confirmT / CONFIRM_TIME) : 0
    const framing = playing ? this.battleFraming() : 0
    const near = playing ? THREE.MathUtils.lerp(1, BATTLE_ZOOM * this.bossPull, framing) : 1
    const reach = playing ? this.battleReach(p, framing) * near : 1
    const dist = this.camOffset.length() * reach * (1 + GATE_PULL * gateLook) * THREE.MathUtils.lerp(1, CONFIRM_PUSH, push * push * push) * THREE.MathUtils.lerp(1, this.gearDist, this.gearK)
    const flat = Math.hypot(this.camOffset.x, this.camOffset.z) || 1
    const portraitPitch = THREE.MathUtils.lerp(PORTRAIT_PITCH, PORTRAIT_FAR_PITCH, framing)
    const pitch = THREE.MathUtils.lerp(Math.atan2(this.camOffset.y, flat), Math.max(Math.atan2(this.camOffset.y, flat), portraitPitch), zoom)
    _off.set(this.camOffset.x / flat, 0, this.camOffset.z / flat).multiplyScalar(Math.cos(pitch) * dist)
    _off.y = Math.sin(pitch) * dist
    _off.applyAxisAngle(_up, selecting ? this.camYaw + this.selectOrbit : this.camYaw)
    _v.copy(this.camTarget).add(_off)
    if (this.camSnap || selecting) this.camera.position.copy(_v)
    else this.camera.position.lerp(_v, Math.min(1, dt * (5.5 + chase)))
    this.camSnap = false
    _v2.copy(this.camTarget).add(this.camLook)
    _v2.y += GEAR_LOOK * this.gearK
    if (bossLook > 0) _v2.y += this.boss.height * BOSS_LOOK * bossLook
    _v2.x += Math.sin(this.camYaw) * 2.1 * near * zoom * (1 - this.gearK)
    _v2.z += Math.cos(this.camYaw) * 2.1 * near * zoom * (1 - this.gearK)
    this.camera.lookAt(_v2)
    if (playing) this.fitBoss(dt)
    if (playing) this.keepHeroInFrame(dt)

    if (this.shakeT > 0) {
      this.shakeT -= dt
      const k = this.shakeAmp * Math.max(0, this.shakeT)
      this.camera.position.x += (random() - 0.5) * k
      this.camera.position.y += (random() - 0.5) * k
      this.camera.position.z += (random() - 0.5) * k * 0.6
      if (this.shakeT <= 0) this.shakeAmp = 0
    }
  }

  render() {
    if (!this.renderHold && !this.contextLost) this.composer.render()
  }

  skipShadowWalk() {
    const map = this.renderer.shadowMap
    const render = map.render.bind(map)
    const hidden = []
    map.render = (lights, scene, camera) => {
      hidden.length = 0
      for (let i = 0; i < SHADOWLESS.length; i++) {
        const owner = this[SHADOWLESS[i]]
        const group = owner && owner.group
        if (group && group.visible) {
          group.visible = false
          hidden.push(group)
        }
      }
      render(lights, scene, camera)
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true
    }
  }

  govern(elapsed, work) {
    if (this.renderHold || this.contextLost || (this.state !== 'select' && this.state !== 'battle')) {
      this.governor.hold()
      return
    }
    const ratio = this.governor.sample(elapsed, work)
    if (ratio === null) return
    this.renderer.setPixelRatio(ratio)
    this.resize(true)
    this.render()
  }

  loop() {
    let last = performance.now()
    bootMark('loop')
    const frame = now => {
      const begin = performance.now()
      requestAnimationFrame(frame)
      const elapsed = this.lifecycle.elapsed(now - last)
      let dt = stepDoor(Math.min(0.05, elapsed))
      last = now
      if (this.benched) return
      if (dt == null || this.paused || this.lifecycle.frozen) { this.render(); return }
      this.realDt = dt
      this.easeGear(dt)
      dt *= this.timeScale * THREE.MathUtils.lerp(1, this.gearSlow, this.gearK)
      this.t += dt
      this.step(dt)
      this.render()
      this.govern(elapsed, performance.now() - begin)
    }
    requestAnimationFrame(frame)
  }

  easeGear(dt) {
    if (this.gearT === this.gearTo) return
    const span = this.gearTo ? GEAR_IN : GEAR_OUT
    this.gearT = this.gearTo ? Math.min(1, this.gearT + dt / span) : Math.max(0, this.gearT - dt / span)
    const t = this.gearT
    this.gearK = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2
  }

  step(dt) {
    if (this.gearOpen && (this.state !== 'battle' || !this.hero || this.hero.dead)) this.closeGear()
    const heroDt = this.gearK > 0 ? THREE.MathUtils.lerp(dt, this.realDt, this.gearK) : dt
    this.ui.tick(dt)
    if (this.arena) this.arena.update(dt, this.t)
    if (this.fx) this.fx.update(dt)
    tickCharacters(heroDt)
    if (this.lights) this.updateLights(heroDt)

    if (this.state === 'select') {
      setLobbyView(this.camera)
      this.selectShadow()
      if (this.confirming) this.confirmT += dt
      this.updateSelectActors(dt)
      if (this.showcase) this.showcase.update(dt, this.heroIndex, this.portraitAmount())
      this.focusLobby(this.selectActors[this.heroIndex])
    }

    if (this.state === 'battle' || this.state === 'morph' || this.state === 'end') {
      if (this.hero) {
        if (this.state === 'battle') {
          this.tickDots(dt)
          this.updateHero(dt)
        }
        this.hero.update(heroDt)
        audio.listen(this.hero.pos.x, this.hero.pos.z, this.camYaw)
        this.footsteps(this.hero, this.activeDef().model, this.titanMode ? 'step_big_anima_bosses' : 'step_ground')
      }
      this.updateEnemies(dt, heroDt)
      if (this.gearK > 0 && this.hero && this.state === 'battle') this.clearAroundHero(this.realDt * this.gearK)
    }

    if (this.state === 'battle') {
      for (const k in this.cooldowns) {
        if (this.cooldowns[k] <= 0) continue
        this.cooldowns[k] -= dt
        if (this.cooldowns[k] <= 0 && k in this.readyAt) this.readyAt[k] = this.t
      }
      this.ui.updateSkillbar(this.activeDef(), this.titanMode, this.cooldowns, this.ult, this.ultReady)

      this.tallyWaveKills()
      if (this.pending.length) {
        this.waveTimer += dt
        while (this.pending.length && this.pending[0].t <= this.waveTimer) {
          const next = this.pending.shift()
          this.spawnEnemy(next.type, next)
        }
      } else if (!this.spawning && !anyAlive(this.enemies)) {
        if (this.waveIndex < WAVES.length - 1) {
          this.clearT = (this.clearT || 0) + dt
          if (this.clearT >= (WAVES[this.waveIndex + 1].boss ? BOSS_ENTRANCE_PAUSE : 0)) this.nextWave()
        }
        else if (!this.loot.busy || this.lootWait >= LOOT_VICTORY_WAIT) this.victory()
        else {
          this.lootWait += dt
          if (this.lootWait >= LOOT_SHOWCASE) this.loot.collectAll()
        }
      }

      if (this.setLive && !this.titanMode && this.gear.build.leech) this.leechPool = Math.min(LEECH_RATE * this.hero.maxHp, this.leechPool + dt * LEECH_RATE * this.hero.maxHp)
      this.flushHeroNumbers(dt)
      if (this.titanMode) {
        this.titanT -= dt
        this.ui.setTitanTimer(Math.max(0, this.titanT) / this.titanDef.duration, true)
        if (this.titanT <= 0 && (!this.heroWindup() || this.titanT < -TITAN_OVERTIME)) this.endTitan()
      } else if (!this.titanReady) {
        this.chargeTitan(dt)
      } else if (!this.gearOpen && this.titanMayCome()) {
        if (this.titanCall) {
          this.titanCall = false
          this.ui.showBanner('TITAN READY', '', 1.4)
        }
        this.titanWait -= dt
        if (this.titanWait <= 0) this.transform()
      }

      if (!this.gearOpen) {
        this.castQueued()
        this.autoCombat()
      }
      if (!this.titanMode && this.painNow() >= WEAK_WARN) this.warnWeak()
    }

    this.updateCamera(this.gearK > 0 ? this.realDt : dt)
    if (this.arena) aimArenaCut(this.camera, this.arena.shadowCatcher.position.y)
    if (this.state !== 'select') this.fitBattleShadow()
    if (this.loot && this.hero) this.loot.update(dt, this.hero, this.lootAnchor())
    if (this.guide) this.updateGuide()
    if (this.moments) this.moments.update(this, dt)
    if (this.heroFx) this.heroFx.update(heroDt)
    if (this.vfx) this.vfx.update(heroDt, this.camera)
    this.updateEnemyBars()
    this.updateHeroBar()
    if (this.gearOpen) this.placeGear()
  }

  updateHeroBar() {
    const h = this.hero
    if (!h) {
      this.ui.placeHeroCue(0, 0, false)
      return this.ui.placeHeroBar(0, 0, false)
    }
    _v.set(h.pos.x, h.pos.y + h.height * 1.08 + 0.55, h.pos.z).project(this.camera)
    const visible = !h.dead && !this.gearOpen && _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2
    const barX = (_v.x * 0.5 + 0.5) * view.w
    const barY = (-_v.y * 0.5 + 0.5) * view.h
    _v.set(h.pos.x, h.pos.y, h.pos.z).project(this.camera)
    this.ui.placeHeroBar(barX, barY, visible, (-_v.y * 0.5 + 0.5) * view.h)
    if (!this.heroCueOn) return
    _v.set(h.pos.x, h.pos.y + h.height * 0.5, h.pos.z).project(this.camera)
    this.ui.placeHeroCue((_v.x * 0.5 + 0.5) * view.w, (-_v.y * 0.5 + 0.5) * view.h, visible)
  }

  updateEnemyBars() {
    this.ui.pruneEnemyBars(this.enemies)
    this.camera.updateMatrixWorld()
    for (const e of this.enemies) {
      _v.set(e.pos.x, e.pos.y + e.height * 1.08 + 0.3, e.pos.z).project(this.camera)
      const visible = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2
      e.onScreen = visible
      this.ui.placeEnemyBar(e, (_v.x * 0.5 + 0.5) * view.w, (-_v.y * 0.5 + 0.5) * view.h, visible)
    }
    this.ui.drawEnemyBars()
  }

  updateGuide() {
    const gap = this.guideTarget()
    this.guide.update(this.realDt || 0, this.hero ? this.hero.pos : null, gap >= 0 ? _guideAt : null, gap)
  }

  guideTarget() {
    const h = this.hero
    if (this.state !== 'battle' || !h || h.dead || !this.input.enabled) return -1
    if (this.gearOpen || this.gearK > 0.01 || (this.shieldUp && !this.shieldFragile) || this.heroCueOn) return -1
    const loot = this.restingLoot(h)
    if (loot) {
      _guideAt.set(loot.mesh.position.x, 0, loot.mesh.position.z)
      return GUIDE_LOOT_GAP
    }
    let best = null
    let bd = Infinity
    for (const e of this.enemies) {
      if (e.dead) continue
      const d = Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) - e.radius
      if (d < bd) { bd = d; best = e }
    }
    if (!best) return -1
    const reach = this.activeDef().atkRange + (this.guide.alpha > 0 ? GUIDE_ENGAGE : GUIDE_RELEASE)
    if (bd < reach) return -1
    _guideAt.set(best.pos.x, 0, best.pos.z)
    return best.radius
  }

  restingLoot(h) {
    let best = null
    let bd = Infinity
    for (const d of this.loot.drops) {
      if (d.phase !== 'rest' || d.claimed) continue
      const dist = Math.hypot(d.mesh.position.x - h.pos.x, d.mesh.position.z - h.pos.z)
      if (dist < bd) { bd = dist; best = d }
    }
    return best
  }

  nearestEnemy() {
    let best = null
    let bd = Infinity
    for (const e of this.enemies) {
      if (e.dead) continue
      const d = Math.hypot(e.pos.x - this.hero.pos.x, e.pos.z - this.hero.pos.z)
      if (d < bd) { bd = d; best = e }
    }
    if (!best) return null
    _near.e = best
    _near.d = bd
    return _near
  }
}
