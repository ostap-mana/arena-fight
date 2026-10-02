import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ChromaticAberrationEffect, SMAAEffect, SMAAPreset, DepthOfFieldEffect, HueSaturationEffect, BrightnessContrastEffect, BlendFunction } from 'postprocessing'
import gsap from 'gsap'

import { HEROES, TITANS, ENEMIES, WAVES } from '../data/heroes.js'
import { loadModelData, loadWingedModel, buildModel, texturesReady, landingTime, strideSpeed } from './model.js'
import { Actor } from '../entities/actor.js'
import { buildArena, ARENA_RADIUS } from '../world/arena.js'
import { FX } from '../world/fx.js'
import { Showcase } from '../world/showcase.js'
import { LobbyGradeEffect, FocusSharpenEffect } from '../world/lobby-post.js'
import { Vfx } from '../world/vfx.js'
import { HeroFx, prefabRole } from '../world/hero-fx.js'
import { loadCharacterLighting, tickCharacters, setLobbyView, CHARACTER_LIGHT, LOBBY_LIGHT, SHADOW_MODE } from '../world/character-shader.js'
import { DynamicLights } from '../world/lights.js'
import { Loot } from '../world/loot.js'
import { audio, STEPS } from './audio.js'
import { Input } from './input.js'
import { Gear } from './gear.js'
import { BUILDS, POWER_GOAL } from '../data/builds.js'
import { UI, ELEMENT_ART } from '../ui/ui.js'

const SKILL_SLOT = { s1: 0, s2: 1, s3: 2 }
const SKILL_PRIORITY = ['s3', 's2', 's1']
const AUTO_CAST_GAP = 1.1
const TAP_QUEUE_TIME = 0.9
const GESTURE_HINT_DELAY = 1.9
const GESTURE_HINT_TIME = 7
const BLOOM_BASE = 0.55
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
const TITAN_ZOOM_OUT = 1.2
const TITAN_CHARGE_TIME = 15
const BOSS_SPAWN_DIST = 9
const BOSS_CAST_GAP = 1.4
const BOSS_RECOVER = 0.35
const BOSS_CAST_OVERRUN = 1.5
const BOSS_MIN_CAST_SPEED = 0.45
const BOSS_CHARGE_OVERSHOOT = 3
const BOSS_DASH_TIME = 0.32
const LOOT_SHOWCASE = 1.4
const LOOT_VICTORY_WAIT = 4.5
const LOOT_DETOUR = 6
const RUN_RATE = [0.6, 1.8]
const KNOCK = { hero: 0.5, titan: 1.2 }
const KNOCK_RATE = 14
const HIT_SHAKE = { hero: 0.16, titan: 0.35 }
const LOOT_WARM_AT = new THREE.Vector3(0, -0.4, 0)
const LOOT_WARM_SCALE = 0.001
const GEAR_SLOWMO = 0.3
const GEAR_HERO_SHARE = 0.36
const GEAR_NEAREST = 0.3
const GEAR_TOP = 1.08
const GEAR_SMOOTH = 0.25
const GEAR_CHASE = 7
const GEAR_LOOK = 0.55
const GEAR_IN = 0.45
const GEAR_OUT = 0.32
const HERO_TAP_PAD = 12
const HERO_TAP_WIDTH = 0.38
const _up = new THREE.Vector3(0, 1, 0)
const _zero = new THREE.Vector3()
const ARENA_SHADOW_SPAN = 24
const ARENA_SHADOW = { near: 1, far: 90, bias: -0.0006, normalBias: 0.035, radius: { high: 4, low: 2 } }
const SELECT_SHADOW = { bias: -0.0005, normalBias: 0.012, depthPad: 2, radius: { high: 5, low: 3 } }
const SELECT_SHADOW_CENTER = new THREE.Vector3(0, 1, -0.4)
const SELECT_SHADOW_MIN = new THREE.Vector3(-4.5, -0.1, -1.9)
const SELECT_SHADOW_MAX = new THREE.Vector3(4.5, 2.9, 1.1)
const KEY_DISTANCE = 40
const _lightBasis = new THREE.Matrix4()
const _corner = new THREE.Vector3()
const SELECT_VIEW_DIR = new THREE.Vector3(0, 3.1, 8.0).normalize()
const SELECT_HERO_Z = -0.4
const SELECT_HERO_TOP = 2.6
const SELECT_ROW_HALF = 4.3
const SELECT_CARD_LIFT = 14
const SELECT_ROW_ASPECT = 0.64
const INTRO_IN = 0.2
const INTRO_EXIT = 0.85
const INTRO_BLEND = 0.8
const INTRO_OUT = 0.3
const IDLE_BREAK_IN = 0.2
const IDLE_BREAK_GAP = [7, 11]
const SELECT_CAM_SMOOTH = 0.45
const CONFIRM_TIME = 0.55
const CONFIRM_PUSH = 0.8
const SETTLE_FRAME_MS = 26
const SETTLE_CALM_FRAMES = 6
const SETTLE_MAX_MS = 1400
const LOBBY_SOUND_FADE = 350
const SHIELD_HIT_MULT = 2.2
const IMMUNE_TEXT_GAP = 0.45
const GATE_WARN_DELAY = 2.1
const DEFEAT_REASON_DELAY = 2.4
const _camVel = new THREE.Vector3()
const _dampA = new THREE.Vector3()
const _dampB = new THREE.Vector3()

function smoothDamp(current, target, velocity, smoothTime, dt) {
  const omega = 2 / smoothTime
  const x = omega * dt
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  _dampA.copy(current).sub(target)
  _dampB.copy(_dampA).multiplyScalar(omega).add(velocity).multiplyScalar(dt)
  velocity.addScaledVector(_dampB, -omega).multiplyScalar(k)
  current.copy(target).add(_dampA.add(_dampB).multiplyScalar(k))
}
const _fitCam = new THREE.PerspectiveCamera()
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const HAPTIC_MS = 12

function haptic(ms = HAPTIC_MS) {
  if (!navigator.vibrate) return
  try { navigator.vibrate(ms) } catch {}
}

function enemyModel(def) {
  return def.wings ? loadWingedModel(def.model, def.wings) : loadModelData(def.model)
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
    this.gearDist = 1
    this.dmgNodes = []
    this.shakeT = 0
    this.shakeAmp = 0
    this.rescued = false
    this.variant = new URLSearchParams(location.search).get('v') || 'default'
    this.heroIndex = 0
    this.cooldowns = { s1: 0, s2: 0, s3: 0, dash: 0, attack: 0 }
    this.setupRenderer()
    this.input = new Input()
    this.input.attachStick(this.ui.stick)
    this.input.onTap = (x, y) => {
      if (this.tapOnHero(x, y)) this.toggleGear()
      else if (this.gearOpen) this.closeGear()
      else this.oneHandTap()
    }
    this.input.onFlick = (x, y) => this.flickDash(x, y)
    this.input.onSteer = () => {
      if (this.gearOpen) this.closeGear()
      this.steered = true
      this.ui.showGestureHint(false)
    }
    this.bindUI()
  }

  setupRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    r.setSize(innerWidth, innerHeight)
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    this.renderer = r

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x070c1a, 0.018)

    this.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.4, 220)
    this.camera.position.set(0, 13, 13)
    this.camera.lookAt(0, 1.2, 0)
    this.camOffset = new THREE.Vector3(0, 7.8, 7.4)
    this.camLook = new THREE.Vector3(0, 1.3, 0)
    this.camTarget = new THREE.Vector3()
    this.camYaw = 0
    this.battleView = false
    this.fitCamera()

    const gl = r.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''
    const soft = /swiftshader|llvmpipe|software|basic render/i.test(gpu)
    this.softGPU = soft
    this.gpuName = gpu
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const q = new URLSearchParams(location.search).get('q')
    this.quality = q === 'low' || q === 'high' ? q : soft || coarse ? 'low' : 'high'
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
      radius: 0.7,
    })
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0004, 0.0004) })
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: BATTLE_POST.vignette })
    this.battleGrade = new HueSaturationEffect({ saturation: BATTLE_POST.saturation })
    this.battleContrast = new BrightnessContrastEffect({ contrast: BATTLE_POST.contrast })
    this.battlePasses = []
    if (this.quality === 'high') this.battlePasses.push(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })))
    this.battlePass = new EffectPass(this.camera, this.bloom, this.battleGrade, this.battleContrast, this.vignette)
    this.battlePasses.push(this.battlePass)
    for (const p of this.battlePasses) this.composer.addPass(p)
    this.buildLobbyPost()

    addEventListener('resize', () => this.resize())
  }

  buildLobbyPost() {
    const cam = this.camera
    this.lobbyBloom = new BloomEffect({
      intensity: LOBBY_POST.bloom,
      luminanceThreshold: LOBBY_POST.threshold,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.82,
    })
    this.lobbySat = new HueSaturationEffect({ saturation: LOBBY_POST.saturation })
    this.lobbyContrast = new BrightnessContrastEffect({ contrast: LOBBY_POST.contrast })
    this.lobbyVignette = new VignetteEffect({ offset: 0.3, darkness: LOBBY_POST.vignette })
    this.lobbyGrade = new LobbyGradeEffect()
    this.lobbySharpen = new FocusSharpenEffect()
    const effects = [this.lobbySharpen, this.lobbyGrade, this.lobbyBloom, this.lobbySat, this.lobbyContrast, this.lobbyVignette]
    this.lobbyPasses = []
    if (!this.softGPU) {
      this.lobbyDof = new DepthOfFieldEffect(cam, { focusDistance: 8, focusRange: LOBBY_POST.focusRange, bokehScale: LOBBY_POST.bokeh, resolutionScale: 0.5 })
      this.lobbyDof.target = new THREE.Vector3()
      effects.unshift(this.lobbyDof)
      this.lobbyPasses.push(new EffectPass(cam, new SMAAEffect({ preset: SMAAPreset.MEDIUM })))
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

  resize() {
    this.camera.aspect = innerWidth / innerHeight
    this.fitCamera()
    this.renderer.setSize(innerWidth, innerHeight)
    this.composer.setSize(innerWidth, innerHeight)
    if (this.ui.cardEls) this.ui.selectCard(this.heroIndex)
    if (this.state === 'select') this.fitSelectCamera()
  }

  bindUI() {
    this.ui.root.querySelector('#pause').addEventListener('click', () => {
      this.paused = !this.paused
      audio.mute(this.paused)
    })
    for (const s of this.ui.skills) {
      const k = s.dataset.k
      s.addEventListener('pointerdown', e => {
        e.stopPropagation()
        haptic()
        if (this.state === 'battle' && this.cooldowns[k] > 0) audio.play('ui_button_locked')
        this.useSkill(k)
      })
    }
    this.ui.ultBtn.addEventListener('pointerdown', e => {
      e.stopPropagation()
      haptic()
      if (!this.castUltimate() && this.state === 'battle') audio.play('ui_button_locked')
    })
    this.ui.animaCard.addEventListener('pointerdown', e => {
      e.stopPropagation()
      haptic()
      this.transform()
    })
    this.ui.titanMeter.addEventListener('pointerdown', e => {
      e.stopPropagation()
      this.transform()
    })
    this.ui.autoBtn.addEventListener('pointerdown', e => {
      e.stopPropagation()
      this.setAuto(this.autoCast === false)
      audio.play('ui_click_tab')
    })
    this.ui.skip.addEventListener('click', () => {
      audio.play('ui_click_main')
      this.skipCinematic()
    })
    this.ui.end.querySelector('#cta').addEventListener('click', () => {
      audio.play('ui_click_main')
      window.open('https://invokers.game', '_blank')
    })
    this.ui.end.querySelector('.replay').addEventListener('click', () => location.reload())
    this.ui.powerGoal.addEventListener('click', () => {
      if (this.state !== 'battle' || !this.hero || this.hero.dead || !this.gear) return
      haptic()
      this.toggleGear()
    })
    this.ui.gearRing.onClose = () => this.closeGear()
    this.ui.gearRing.onChange = kind => {
      audio.play(kind === 'filter' ? 'ui_click_tab' : kind === 'unequip' ? 'ui_click_back' : 'ui_click_add')
      if (kind !== 'filter') this.applyGear()
    }
    addEventListener('keydown', e => {
      if (e.code === 'Escape' && this.gearOpen) this.closeGear()
    })
    this.ui.outcome.onCta = () => {
      audio.play('outcome_cta')
      window.open('https://invokers.game', '_blank')
    }
    this.ui.outcome.onRetry = () => {
      audio.play('outcome_select')
      setTimeout(() => location.reload(), 160)
    }
    this.ui.fail.querySelector('#rescue').addEventListener('click', () => {
      audio.play('ui_click_main')
      this.ui.show('fail', false)
      this.rescueActive = false
      this.titan = 1
      this.titanReady = true
      this.transform()
    })
  }

  async boot() {
    const fonts = ['400 20px Hitzone', '500 20px Hitzone', '20px "Hitzone Med"', '20px "Montserrat It"']
    const fontsReady = Promise.all(fonts.map(f => document.fonts?.load(f).catch(() => {})))
    const lobbyIds = [...new Set(HEROES.map(h => h.lobby || h.model))]
    const total = lobbyIds.length + 1
    let done = 0
    const advance = () => {
      done++
      this.ui.progress(0.05 + (done / total) * 0.85)
    }
    this.ui.progress(0.04)
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
    this.loot = new Loot(this.scene, this.vfx, this.camera)
    this.loot.onCollect = item => this.collectLoot(item)
    for (const h of HEROES) {
      if (h.skinMute) this.heroFx.muteSkin(h.vfx, h.skinMute)
      if (h.lobbyFocus) this.heroFx.focusLobby(h.vfx, h.lobbyFocus)
    }
    await Promise.all([arenaReady, ...lobbyReady])
    this.setupLights()
    await Promise.all([audio.init(), Promise.race([fontsReady, new Promise(r => setTimeout(r, 3000))]), new Promise(r => setTimeout(r, 320))])
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => this.renderer.compile(this.scene, this.camera))
    this.ui.progress(1)
    this.ui.bootDone()
    this.backgroundLoad = this.loadInBackground()

    const start = () => {
      removeEventListener('pointerdown', start)
      removeEventListener('keydown', start)
      audio.play('ui_braam')
      audio.track('music_lobby')
      this.ui.hideBoot()
      this.enterSelect()
    }
    addEventListener('pointerdown', start)
    addEventListener('keydown', start)
    this.loop()
  }

  async loadInBackground() {
    const vfxIds = [...new Set(HEROES.map(h => h.vfx).filter(Boolean))]
    await this.vfx.preload(vfxIds)
    for (const id of vfxIds) this.heroFx.preloadModels(id)
    this.attachSelectSkins()
    await this.vfx.warm(this.renderer, this.camera, this.lobbyFxNames())
    audio.fetch(['music_battle', 'amb_battle', 'common', 'enemies'])
    for (const id of [...new Set(HEROES.map(h => h.model))]) await loadModelData(id).catch(() => null)
    for (const def of [...new Set(WAVES.flatMap(w => w.spawns.map(([type]) => ENEMIES[type])))]) await enemyModel(def).catch(() => null)
    await this.loot.load().catch(e => console.warn('loot', e))
    if (this.state === 'battle') this.warmBattleFx([], true)
    const enemyVfx = [...new Set(WAVES.flatMap(w => w.spawns.map(([type]) => ENEMIES[type].vfx)).filter(Boolean))]
    if (enemyVfx.length) await this.vfx.preload(enemyVfx)
    this.vfx.warm(this.renderer, this.camera, this.loot.fxNames())
    audio.fetch(['music_titan', 'music_victory', 'music_endcard'])
  }

  tapOnHero(x, y) {
    const h = this.hero
    if (this.state !== 'battle' || !h || h.dead || !this.gear) return false
    _v.set(h.pos.x, h.pos.y, h.pos.z).project(this.camera)
    const footX = (_v.x * 0.5 + 0.5) * innerWidth
    const footY = (-_v.y * 0.5 + 0.5) * innerHeight
    _v.set(h.pos.x, h.pos.y + h.height, h.pos.z).project(this.camera)
    const headX = (_v.x * 0.5 + 0.5) * innerWidth
    const headY = (-_v.y * 0.5 + 0.5) * innerHeight
    const half = Math.max(30, (footY - headY) * HERO_TAP_WIDTH)
    return Math.abs(x - (footX + headX) / 2) <= half && y >= headY - HERO_TAP_PAD && y <= footY + HERO_TAP_PAD
  }

  toggleGear() {
    if (this.gearOpen) this.closeGear()
    else this.openGear()
  }

  openGear() {
    if (this.gearOpen) return
    this.gearOpen = true
    this.gearHinted = true
    this.gearPower = this.gear.power()
    this.ui.setGearBadge(false)
    audio.play('ui_expand_in')
    this.gearSpan = null
    if (!this.heroLocked()) this.hero.rig.play('idle', { force: true, fade: 0.2 })
    const span = this.placeGear()
    if (this.gearK < 0.01) this.gearDist = clamp(span / (innerHeight * GEAR_HERO_SHARE), GEAR_NEAREST, 1)
    this.ui.openGear(this.gear, this.heroDef)
    gsap.to(this, { gearK: 1, duration: GEAR_IN, ease: 'power2.out', overwrite: true })
  }

  placeGear() {
    const h = this.hero
    if (!h) return 0
    this.camera.updateMatrixWorld()
    _v.set(h.pos.x, h.pos.y, h.pos.z).project(this.camera)
    const footX = (_v.x * 0.5 + 0.5) * innerWidth
    const bottom = (-_v.y * 0.5 + 0.5) * innerHeight
    _v2.set(h.pos.x, h.pos.y + h.height * GEAR_TOP, h.pos.z).project(this.camera)
    const span = { x: (footX + (_v2.x * 0.5 + 0.5) * innerWidth) / 2, top: (-_v2.y * 0.5 + 0.5) * innerHeight, bottom }
    const s = this.gearSpan || span
    for (const k of ['x', 'top', 'bottom']) s[k] += (span[k] - s[k]) * (this.gearSpan ? GEAR_SMOOTH : 1)
    this.gearSpan = s
    this.ui.gearRing.place(s.x, s.top, s.bottom)
    return s.bottom - s.top
  }

  closeGear() {
    if (!this.gearOpen) return
    this.gearOpen = false
    audio.play('ui_expand_out')
    this.ui.closeGear()
    gsap.to(this, { gearK: 0, duration: GEAR_OUT, ease: 'power2.inOut', overwrite: true })
    this.applyGear()
    const power = this.gear.power()
    if (power > this.gearPower && this.state === 'battle') this.ui.showPowerGain(this.gearPower, power)
  }

  applyGear() {
    if (!this.gear) return
    this.gearMods = this.gear.modifiers()
    const h = this.titanMode ? this.heroBase : this.hero
    if (!h) return
    const k = h.maxHp ? h.hp / h.maxHp : 1
    h.maxHp = this.heroDef.hp * (this.fuseBonus || 1) * this.gearMods.hp
    h.hp = Math.max(1, h.maxHp * k)
    if (!this.titanMode) this.ui.setHp(h.hp, h.maxHp)
    this.showPower()
    if (this.shieldUp && !this.underpowered()) this.breakShield()
  }

  underpowered() {
    return !!this.gear && this.gear.power() < POWER_GOAL
  }

  showPower() {
    if (!this.gear) return
    this.ui.setPower(this.gear.power(), POWER_GOAL, this.gear.bestPower() >= POWER_GOAL && this.underpowered())
  }

  raiseShield() {
    if (!this.underpowered()) return
    this.shieldUp = true
    this.immuneT = 0
    this.ui.setShield(true)
    setTimeout(() => {
      if (!this.shieldUp || this.state !== 'battle') return
      this.ui.showBanner('TOO WEAK', `need ${POWER_GOAL.toLocaleString('en-US')} power · tap hero`, 2.6)
      audio.play('ui_button_locked')
    }, GATE_WARN_DELAY * 1000)
  }

  breakShield() {
    this.shieldUp = false
    this.ui.setShield(false)
    if (this.state !== 'battle') return
    this.ui.showBanner('SHIELD BROKEN', 'strike now', 1.6)
    audio.play('ui_braam')
    this.shake(0.6, 0.45)
    if (this.boss && !this.boss.dead) this.lights.flash(this.boss.pos, 0xffd070, 3.2, 6, 0.6, this.boss.height * 0.5)
  }

  lootAnchor() {
    const id = this.heroVfx()
    return id ? this.vfx.socket(id, this.hero, 'FX_Center') : this.hero.root
  }

  collectLoot(item) {
    this.ui.lootRelic(item)
    if (this.gear) {
      const added = this.gear.add(item)
      if (this.gearOpen) this.ui.gearRing.refresh(added)
      else this.ui.setGearBadge(true)
      this.showPower()
      if (!this.gearHinted && !this.gearOpen && this.state === 'battle') {
        this.gearHinted = true
        this.ui.showBanner('NEW GEAR', 'tap your hero to equip', 1.8)
      }
    }
    audio.play('loot_notification', { slot: 'loot_note', max: 1, gap: 0.35 })
  }

  lobbyFxNames() {
    return HEROES.flatMap(h => [...(h.intro || []).map(([, name]) => name), ...this.heroFx.skinNames(h.vfx, true)])
  }

  attachSelectSkins() {
    if (this.state !== 'select' || !this.selectActors) return
    this.selectActors.forEach((a, i) => {
      const h = HEROES[i]
      if (h.vfx && !(a.skinFx && a.skinFx.length)) this.heroFx.attachSkin(h.vfx, a, { lobby: true })
    })
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0x7fa8ff, 0x241a14, 0.85)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xffe3b8, 2.5)
    key.castShadow = true
    const map = this.quality === 'high' ? 2048 : 1024
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
    this.setShadowSpan(ARENA_SHADOW_SPAN)
  }

  selectShadow() {
    const s = this.key.shadow
    this.aimKey(LOBBY_LIGHT.uLobbyLightDir.value, SELECT_SHADOW_CENTER)
    s.bias = SELECT_SHADOW.bias
    s.normalBias = SELECT_SHADOW.normalBias
    s.radius = SELECT_SHADOW.radius[this.quality]
    this.fitShadowBox(SELECT_SHADOW_MIN, SELECT_SHADOW_MAX, SELECT_SHADOW.depthPad)
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

  setShadowSpan(d) {
    const c = this.key.shadow.camera
    c.left = c.bottom = -d
    c.right = c.top = d
    c.updateProjectionMatrix()
  }

  async enterSelect() {
    this.state = 'select'
    this.ui.veilHold()
    this.setLobbyPost(true)
    this.ui.buildCards(i => this.pickHero(i))
    this.ui.show('select', true)
    this.selectActors = []
    for (let i = 0; i < HEROES.length; i++) {
      const h = HEROES[i]
      const data = await loadModelData(h.lobby || h.model)
      const a = new Actor(buildModel(data, { castShadow: true }), { targetHeight: 1.9 })
      a.setPos((i - 1) * 2.9, SELECT_HERO_Z)
      a.targetFacing = a.facing = (h.turn || 0) - (i - 1) * 0.16
      a.rig.play('pose', { force: true })
      a.rig.t = i * 1.7
      await texturesReady()
      this.scene.add(a.root)
      this.selectActors.push(a)
      if (h.vfx && this.heroFx) this.heroFx.attachSkin(h.vfx, a, { lobby: true })
    }
    this.fitSelectCamera()
    this.heroIndex = 0
    this.camTarget.set(0, 0, 0)
    _camVel.set(0, 0, 0)
    this.camera.position.copy(this.camTarget).add(this.camOffset)
    this.camSnap = true
    this.ui.selectCard(0)
    this.highlightSelected()
    this.showcase = new Showcase(this.scene, this.selectActors, HEROES, this.arena)
    setLobbyView(this.camera)
    this.selectShadow()
    const warm = this.warmIntroFx()
    await new Promise(r => requestAnimationFrame(r))
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera).catch(() => {})
    await this.settleFrames()
    for (const inst of warm) inst.stop()
    this.ui.playSelectIntro()
    this.ui.veilOut()
    this.playIntro(0)
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

  async warmBattleFx(ids, withLoot = false) {
    const hidden = new THREE.Vector3(0, -40, 0)
    const warm = ids.filter(Boolean).flatMap(id => this.heroFx.warmSkills(id, hidden))
    const probe = withLoot && this.loot.ready ? this.loot.warmProbe(LOOT_WARM_AT, LOOT_WARM_SCALE) : null
    await new Promise(r => requestAnimationFrame(r))
    if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera).catch(() => {})
    await new Promise(r => requestAnimationFrame(r))
    for (const inst of warm) inst.stop()
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
    audio.play(`${HEROES[i].model}_intro`)
  }

  stopLobbySounds(fade = LOBBY_SOUND_FADE) {
    for (const h of HEROES) {
      audio.stop(`${h.model}_intro`, fade)
      audio.stop(`${h.model}_break_1`, fade)
    }
  }

  stopIntroFx(a) {
    for (const inst of a.introFx || []) inst.stop()
    a.introFx = []
    a.introQueue = []
  }

  settleHero(a) {
    this.stopIntroFx(a)
    if (a.rig.state !== 'pose') a.rig.play('pose', { fade: INTRO_OUT })
    a.breakAt = Infinity
  }

  nextIdleBreak(a) {
    a.breakAt = this.t + IDLE_BREAK_GAP[0] + Math.random() * (IDLE_BREAK_GAP[1] - IDLE_BREAK_GAP[0])
  }

  updateSelectActors(dt) {
    this.selectActors.forEach((a, i) => {
      const rig = a.rig
      if (rig.state === 'intro') {
        a.introT += dt
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
      a.update(dt, {})
    })
  }

  confirmSelect() {
    this.fetchBattleSounds()
    this.confirming = true
    this.confirmT = 0
    this.ui.leaveSelect(CONFIRM_TIME)
    setTimeout(() => {
      if (this.variant === 'fuse' && !this.fusedDone) this.enterFuse()
      else this.startBattle()
    }, CONFIRM_TIME * 1000)
  }

  fitSelectCamera() {
    const h = innerHeight
    const titleBottom = this.ui.select.querySelector('.head').getBoundingClientRect().bottom
    const feetPx = this.ui.cards.getBoundingClientRect().top - SELECT_CARD_LIFT - h * 0.035
    const headPx = Math.max(titleBottom + h * 0.1, feetPx - h * 0.42)
    const toNdc = px => 1 - (2 * px) / h
    const p = this.portraitAmount()
    const wholeRow = this.selectShowsRow()
    const heroZ = wholeRow ? SELECT_HERO_Z : SELECT_HERO_Z * (0.28 - 0.28 * p)
    _fitCam.fov = this.camera.fov
    _fitCam.aspect = this.camera.aspect
    _fitCam.updateProjectionMatrix()
    const project = (x, y, dist, look) => {
      _fitCam.position.copy(SELECT_VIEW_DIR).multiplyScalar(dist)
      _fitCam.lookAt(0, look, 0)
      _fitCam.updateMatrixWorld()
      return _v.set(x, y, heroZ).project(_fitCam)
    }
    const lookFor = dist => bisect(-4, 4, look => project(0, 0, dist, look).y > toNdc(feetPx))
    const tooClose = dist => {
      const look = lookFor(dist)
      if (project(0, SELECT_HERO_TOP, dist, look).y > toNdc(headPx)) return true
      return wholeRow && project(SELECT_ROW_HALF, 1, dist, look).x > 0.96
    }
    const dist = bisect(4.5, 14, tooClose)
    this.camOffset.copy(SELECT_VIEW_DIR).multiplyScalar(dist)
    this.camLook.set(0, lookFor(dist), 0)
  }

  highlightSelected() {
    const h = HEROES[this.heroIndex]
    const picked = this.selectActors[this.heroIndex]
    this.heroLight.color.set(h.color)
    this.heroLight.position.set(picked.pos.x, 2.6, picked.pos.z - 1.7)
    this.heroLight.intensity = 22
  }

  pickHero(i) {
    if (this.state !== 'select' || this.confirming || !this.selectActors[i]) return
    if (i !== this.heroIndex) {
      const prev = this.selectActors[this.heroIndex]
      this.heroIndex = i
      this.ui.selectCard(i)
      this.highlightSelected()
      audio.play('ui_click_main')
      if (prev) this.settleHero(prev)
      this.playIntro(i)
      return
    }
    audio.play('ui_click_battle')
    this.confirmSelect()
  }

  fetchBattleSounds() {
    const hero = HEROES[this.heroIndex]
    audio.fetch([hero.model, TITANS[hero.titan].model, 'common', 'enemies'])
  }

  enterFuse() {
    this.state = 'fuse'
    this.confirming = false
    this.ui.show('select', false)
    this.ui.show('fuse', true)
    this.ui.veilOut()
    const src = this.ui.fuse.querySelector('.fuse-src')
    const slots = [...this.ui.fuse.querySelectorAll('.fuse-slots .s')]
    const target = this.ui.fuse.querySelector('.fuse-target')
    src.innerHTML = ''
    const anima = ['wind', 'fire', 'dark', 'light']
    let filled = 0
    anima.forEach((g, i) => {
      const chip = document.createElement('div')
      chip.className = 'chip'
      chip.innerHTML = `<img src="${ELEMENT_ART[g]}" alt="" draggable="false">`
      src.appendChild(chip)
      let drag = null
      chip.addEventListener('pointerdown', e => {
        e.preventDefault()
        const r = chip.getBoundingClientRect()
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
        chip.classList.add('dragging')
        chip.style.width = `${r.width}px`
        chip.style.height = `${r.height}px`
        chip.setPointerCapture(e.pointerId)
        move(e)
      })
      const move = e => {
        if (!drag) return
        chip.style.left = `${e.clientX - drag.dx}px`
        chip.style.top = `${e.clientY - drag.dy}px`
        const tr = target.getBoundingClientRect()
        const hot = e.clientX > tr.left && e.clientX < tr.right && e.clientY > tr.top && e.clientY < tr.bottom
        target.classList.toggle('hot', hot)
      }
      chip.addEventListener('pointermove', move)
      chip.addEventListener('pointerup', e => {
        if (!drag) return
        const tr = target.getBoundingClientRect()
        const hot = e.clientX > tr.left && e.clientX < tr.right && e.clientY > tr.top && e.clientY < tr.bottom
        chip.classList.remove('dragging')
        chip.style.cssText = ''
        target.classList.remove('hot')
        drag = null
        if (hot && filled < 4) {
          slots[filled].innerHTML = `<img src="${ELEMENT_ART[g]}" alt="" draggable="false">`
          filled++
          chip.classList.add('used')
          audio.play('ui_click_add')
          if (filled >= 3) target.classList.add('full')
        }
      })
    })
    this.ui.fuse.querySelector('#fusego').onclick = () => {
      audio.play('ui_click_battle')
      this.fusedDone = true
      this.fuseBonus = filled >= 3 ? 1.25 : 1
      this.ui.show('fuse', false)
      this.startBattle()
    }
  }

  async startBattle() {
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
    const [battleModel] = await Promise.all([loadModelData(hero.model), hero.vfx ? this.vfx.preload([hero.vfx]).then(() => this.heroFx.preloadModels(hero.vfx)) : null])
    this.hero = new Actor(buildModel(battleModel, { castShadow: true }), { targetHeight: 1.9 })
    this.hero.rig.retimeCombo(hero.combo)
    this.scene.add(this.hero.root)
    if (hero.vfx) this.heroFx.attachSkin(hero.vfx, this.hero)
    this.hero.hp = this.hero.maxHp = hero.hp * (this.fuseBonus || 1)
    this.hero.setPos(0, -4)
    this.hero.targetFacing = this.hero.facing = 0
    this.hero.root.scale.setScalar(this.hero.scale)
    this.heroDef = hero
    const build = BUILDS[hero.id]
    this.gear = new Gear(hero, build)
    if (build) {
      const kills = WAVES.filter(w => !w.boss).reduce((n, w) => n + w.spawns.reduce((m, [, c]) => m + c, 0), 0)
      this.loot.setPlan(build.plan.map(p => ({ ...p, roll: build.scale })), kills)
    }
    this.applyGear()
    this.titanDef = TITANS[hero.titan]
    this.titanLoad = this.loadTitan(this.titanDef)
    this.ui.setHud(hero)
    this.ui.setAnima(this.titanDef, hero)
    this.ui.setTitan(this.titan, this.titanReady, this.titanSecondsLeft())
    this.ui.setUlt(this.ult, this.ultReady)
    this.setAuto(this.autoCast !== false)
    this.ui.setHp(this.hero.hp, this.hero.maxHp)
    this.heroLight.color.set(hero.color)

    this.battleView = true
    this.camYaw = BATTLE_YAW
    this.camOffset.copy(this.battleOffset())
    this.camLook.set(0, BATTLE_LOOK_Y, 0)
    this.fitCamera()
    this.camSnap = true
    await this.warmBattleFx([hero.vfx], true)

    audio.track('music_battle')
    audio.layer('amb_battle', true)
    this.ui.show('hud', true)
    this.confirming = false
    this.ui.veilOut()
    this.input.enabled = true
    this.ui.showBanner(hero.name.toUpperCase(), 'defend the arena', 1.7)
    this.steered = false
    setTimeout(() => {
      if (this.steered || this.state !== 'battle') return
      this.ui.showGestureHint(true)
      setTimeout(() => this.ui.showGestureHint(false), GESTURE_HINT_TIME * 1000)
    }, GESTURE_HINT_DELAY * 1000)

    this.waveIndex = -1
    this.state = 'battle'
    this.nextWave()
  }

  nextWave() {
    this.waveIndex++
    if (this.waveIndex >= WAVES.length) { this.victory(); return }
    const w = WAVES[this.waveIndex]
    const boss = w.boss && ENEMIES[w.boss]
    this.ui.setWave(w.label, `${this.waveIndex + 1} / ${WAVES.length}`)
    if (boss) {
      this.ui.showBanner(boss.name.toUpperCase(), boss.title, 1.8)
      if (this.hero) this.loot.flushPlan(this.hero.pos)
      this.loot.collectAll()
      this.raiseShield()
    } else if (this.waveIndex === 0) this.ui.showBanner(w.label.toUpperCase(), `reach ${POWER_GOAL.toLocaleString('en-US')} power to win`, 2.6)
    else if (this.underpowered()) this.ui.showBanner(w.label.toUpperCase(), `power ${this.gear.power().toLocaleString('en-US')} / ${POWER_GOAL.toLocaleString('en-US')}`, 2.2)
    else this.ui.showBanner(w.label.toUpperCase(), this.waveIndex === WAVES.length - 1 ? 'the warlord arrives' : 'incoming', 1.3)
    audio.play(boss || this.waveIndex === WAVES.length - 1 ? 'boss_laugh' : 'ui_braam')
    this.pending = []
    let delay = 0.35
    for (const [type, n] of w.spawns) {
      for (let i = 0; i < n; i++) {
        this.pending.push({ type, t: delay })
        delay += 0.14 + Math.random() * 0.2
      }
    }
    this.waveTimer = 0
    this.waveTotal = this.pending.length
    this.waveKills = 0
    this.ui.setWaveProgress(0, true)
  }

  tallyWaveKills() {
    for (const e of this.enemies) {
      if (!e.dead || e.tallied) continue
      e.tallied = true
      if (e.wave === this.waveIndex) this.waveKills++
    }
    const boss = WAVES[this.waveIndex] && WAVES[this.waveIndex].boss && this.boss
    if (boss && boss.wave === this.waveIndex && !boss.dead) this.ui.setWaveProgress(1 - boss.hp / boss.maxHp)
    else this.ui.setWaveProgress(this.waveTotal ? this.waveKills / this.waveTotal : 0)
  }

  async spawnEnemy(type) {
    const def = ENEMIES[type]
    this.spawning++
    const loaded = await Promise.all([enemyModel(def), def.vfx ? this.vfx.preload([def.vfx]) : null]).catch(() => null)
    this.spawning--
    if (!loaded || this.state === 'end') return
    const [data] = loaded
    const a = new Actor(buildModel(data, { castShadow: true }), {
      targetHeight: 1.78 * def.scale,
      hp: def.hp * (1 + this.waveIndex * 0.12),
      radius: 0.72 * def.scale,
    })
    a.def = def
    a.type = type
    a.wave = this.waveIndex
    a.cd = Math.random() * def.rate
    if (def.skills) {
      a.cd = def.rate
      a.skillCd = Object.fromEntries(def.skills.map(s => [s.key, s.first ?? s.cd]))
      a.castGap = 0
      this.placeBoss(a)
    } else {
      const ang = Math.random() * Math.PI * 2
      const r = ARENA_RADIUS - 1.5
      a.setPos(Math.cos(ang) * r, Math.sin(ang) * r)
    }
    a.pos.y = def.fly || 0
    a.rig.play(def.fly ? 'fly' : 'idle', { force: true })
    a.rig.t = Math.random() * 3
    this.scene.add(a.root)
    this.enemies.push(a)
    if (this.enemyVfx(def)) this.heroFx.attachSkin(def.vfx, a)
    this.ui.trackEnemy(a, def.boss ? 'boss' : def.hp >= 90 ? 'elite' : 'regular')

    this.fx.enemySpawn(a.pos.x, a.pos.z, !!def.boss)
    this.lights.flash(a.pos, 0x9a3bff, 2.2, 4.5, 0.7, 0.6)
    audio.play('mob_spawn', { at: a.pos, slot: 'spawn', max: 2, gap: 0.1 })
    if (def.boss) {
      this.boss = a
      this.shake(0.5, 0.5)
    }
  }

  placeBoss(a) {
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
      if (c.t >= c.done && (e.rig.oneShotDone || c.t >= c.done + BOSS_CAST_OVERRUN)) {
        e.cast = null
        e.castGap = BOSS_CAST_GAP
      }
      return true
    }
    e.castGap = Math.max(0, e.castGap - dt)
    const h = this.hero
    if (e.castGap > 0 || !h || h.dead || e.rig.state === 'attack' && !e.rig.oneShotDone) return false
    const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z)
    const s = e.def.skills.find(k => e.skillCd[k.key] <= 0 && d <= k.reach && d >= (k.min || 0))
    if (!s) return false
    this.bossCast(e, s, d)
    return true
  }

  bossCast(e, s, dist) {
    const h = this.hero
    e.skillCd[s.key] = s.cd
    e.faceTo(h.pos.x, h.pos.z)
    e.facing = e.targetFacing
    e.rig.play('cast', { force: true, fade: 0.1, skill: s.fx })
    if (e.rig.impactAt > 0 && e.rig.impactAt < s.windup) {
      e.rig.play('cast', { force: true, fade: 0.1, skill: s.fx, speed: Math.max(BOSS_MIN_CAST_SPEED, e.rig.impactAt / s.windup) })
    }
    const impact = Math.max(e.rig.impactAt, s.windup)
    const yaw = e.facing
    const fwd = _v.set(Math.sin(yaw), 0, Math.cos(yaw))
    const c = { s, t: 0, impact, done: impact + BOSS_RECOVER, yaw, radius: s.radius || 0, arc: s.arc || Math.PI, width: s.width || 0, length: s.length || 0 }
    if (s.kind === 'circle') c.center = h.pos.clone().setY(0)
    else if (s.kind === 'line') {
      c.center = h.pos.clone().setY(0)
      if (Math.random() < 0.5) c.yaw += Math.PI / 2
    } else if (s.kind === 'charge') {
      c.length = clamp(dist + BOSS_CHARGE_OVERSHOOT, 6, s.length)
      c.from = e.pos.clone().setY(0)
      c.to = c.from.clone().addScaledVector(fwd, c.length - e.radius)
      c.center = c.from.clone().addScaledVector(fwd, c.length / 2)
    } else c.center = e.pos.clone().setY(0)
    c.warn = this.fx.warn({ x: c.center.x, z: c.center.z, yaw: c.yaw, radius: c.radius, arc: c.arc, width: c.width, length: c.length, windup: impact })
    e.cast = c
    const vfxId = this.enemyVfx(e.def)
    const onImpact = () => this.bossImpact(e, c)
    if (vfxId && this.heroFx.hasSkill(vfxId, s.fx)) this.heroFx.castSkill(vfxId, s.fx, e, [], { impact, center: c.center, onImpact })
    else this.heroFx.later(impact, onImpact)
    const skillSound = `${soundCode(e.def)}_skill_${s.fx}`
    audio.play(audio.has(skillSound) ? skillSound : `${soundCode(e.def)}_ult`, { at: e.pos, slot: 'boss_skill', max: 1 })
    if (s.name) this.ui.showBanner(s.name, 'get out of the circle', 1.4)
  }

  bossImpact(e, c) {
    if (e.dead || e.cast !== c || this.state === 'end') return
    const color = e.def.color || 0xff4a3a
    this.shake(c.s.kind === 'nova' ? 0.9 : 0.45, c.s.kind === 'nova' ? 0.6 : 0.3)
    this.lights.flash(c.center, color, c.s.kind === 'nova' ? 6 : 4, Math.max(c.radius, c.width) * 2.4 + 4, 0.6, 1.2)
    if (c.s.kind === 'charge') c.dash = { t0: c.t }
    else if (!this.enemyVfx(e.def)) {
      this.fx.shock(c.center.x, c.center.z, Math.max(c.radius, c.width) * 2.2, color, 0.6)
      this.fx.spark(c.center.x, 0.6, c.center.z, 50, color, 10)
    }
    const h = this.hero
    if (!h || h.dead || this.invuln > 0 || this.state !== 'battle' || !this.insideCast(c, h)) return
    this.hurtHero(c.s.dmg)
    const vfxId = this.enemyVfx(e.def)
    if (vfxId) this.heroFx.skillHitFx(vfxId, c.s.fx, e, h)
    else this.fx.slash(h.pos.x, 1.1, h.pos.z, e.facing, 2.4, color, 0.24)
  }

  bossDash(e, c) {
    const k = clamp((c.t - c.dash.t0) / BOSS_DASH_TIME, 0, 1)
    const eased = 1 - Math.pow(1 - k, 3)
    e.pos.x = THREE.MathUtils.lerp(c.from.x, c.to.x, eased)
    e.pos.z = THREE.MathUtils.lerp(c.from.z, c.to.z, eased)
    if (k >= 1) c.dash = null
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

  cancelBossCast(e) {
    if (!e.cast) return
    this.fx.endWarn(e.cast.warn)
    e.cast = null
  }

  shake(amp, dur) {
    this.shakeAmp = Math.max(this.shakeAmp, amp)
    this.shakeT = Math.max(this.shakeT, dur)
  }

  hitStop(ms) {
    this.timeScale = 0.06
    clearTimeout(this._hs)
    this._hs = setTimeout(() => { this.timeScale = 1 }, ms)
  }

  damageNumber(x, y, z, value, color, big) {
    _v.set(x, y, z).project(this.camera)
    const sx = (_v.x * 0.5 + 0.5) * innerWidth
    const sy = (-_v.y * 0.5 + 0.5) * innerHeight
    const d = document.createElement('div')
    d.className = 'dmg'
    d.textContent = Math.round(value)
    d.style.left = `${sx}px`
    d.style.top = `${sy}px`
    d.style.color = color
    d.style.fontSize = big ? '34px' : '19px'
    this.ui.root.appendChild(d)
    const dx = (Math.random() - 0.5) * 70
    d.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.3}px), -78%) scale(${big ? 1.5 : 1.12})`, opacity: 1, offset: 0.2 },
        { transform: `translate(calc(-50% + ${dx}px), -180%) scale(${big ? 1.1 : 0.86})`, opacity: 0 },
      ],
      { duration: big ? 1000 : 760, easing: 'cubic-bezier(.15,.8,.3,1)' }
    ).onfinish = () => d.remove()
  }

  useSkill(key) {
    if (this.state !== 'battle' || !this.hero || this.hero.dead || this.heroLocked()) return
    if (this.cooldowns[key] > 0) return
    const h = this.activeDef()
    if (key === 'attack') { this.attack(); return }
    if (key === 'dash') { this.dash(); return }
    const s = h.skills[SKILL_SLOT[key]]
    if (!s) return
    this.cooldowns[key] = s.cd
    this.castSkill(s)
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
    if (near && near.d < h.atkRange + 1.5) {
      this.hero.faceTo(near.e.pos.x, near.e.pos.z)
      this.hero.facing = this.hero.targetFacing
    }
    this.combo = ((this.combo || 0) + 1) % 2
    this.hero.rig.play(this.combo ? 'attack' : 'attack2', { force: true })
    if (h.combo && h.combo.next) this.cooldowns.attack = this.hero.rig.release
    this.hero.attackT = 0
    const hitAt = this.hero.rig.impactAt
    const vfxId = this.heroVfx()
    const combo = vfxId ? this.comboIndexOf(this.hero.rig) : 0
    const ranged = vfxId && this.heroFx.scriptRanged(vfxId)
    const aim = near && (!ranged || near.d <= h.atkRange + 2) ? near.e : null
    const fxRes = vfxId ? this.heroFx.attack(vfxId, combo, this.hero, aim, {
      impact: hitAt,
      fallback: ranged ? this.aheadOf(this.hero, h.atkRange).setY(this.hero.height * 0.55) : null,
      onHit: e => {
        if (!e || e.dead || this.state !== 'battle') return
        this.damage(e, h.atkDmg, h.color, `${h.model}_hit_combo`)
        e.stagger = 0.2
      },
    }) : null
    if (!(fxRes && fxRes.ranged)) this.hero.pendingHit = { dmg: h.atkDmg, range: h.atkRange, arc: this.titanMode ? 2.6 : 1.9, delay: fxRes && fxRes.scripted ? fxRes.hitAt : hitAt, fx: fxRes ? combo : null, vfx: vfxId }
    audio.play(this.attackSound(h, this.hero.rig))
    if (fxRes) return

    const f = this.hero.facing
    const px = this.hero.pos.x + Math.sin(f) * 1.2
    const pz = this.hero.pos.z + Math.cos(f) * 1.2
    setTimeout(() => {
      if (!this.hero) return
      this.fx.slash(px, this.hero.height * 0.55, pz, f, this.titanMode ? 6.5 : 2.6, h.color, 0.2)
    }, Math.max(0, hitAt - 0.04) * 1000)
  }

  aheadOf(actor, dist) {
    return actor.pos.clone().setY(0).add(_v.set(Math.sin(actor.facing), 0, Math.cos(actor.facing)).multiplyScalar(dist))
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

  setAuto(on) {
    this.autoCast = on
    this.ui.setAuto(on)
  }

  autoMoveAxis(def) {
    const rig = this.hero.rig
    if (['attack', 'attack2'].includes(rig.state) && !rig.oneShotDone) return [0, 0]
    const near = this.nearestEnemy()
    const drop = this.loot.nearest(this.hero.pos)
    if (drop && drop.d < LOOT_DETOUR && (!near || drop.d < near.d)) return this.lootAxis(drop)
    if (!near) return this.lootAxis(drop)
    if (near.d <= def.atkRange * 0.85) return [0, 0]
    const dx = near.e.pos.x - this.hero.pos.x
    const dz = near.e.pos.z - this.hero.pos.z
    return [dx / near.d, dz / near.d]
  }

  lootAxis(near) {
    if (!near || near.d < 0.2) return [0, 0]
    const p = near.drop.mesh.position
    return [(p.x - this.hero.pos.x) / near.d, (p.z - this.hero.pos.z) / near.d]
  }

  autoRange(s) {
    const targeted = s.at === 'target' || s.type === 'volley' || s.type === 'beam'
    return targeted ? (s.reach || 10) * 0.8 : (s.radius || 3.5) + 1
  }

  readySkill(needTarget) {
    const skills = this.activeDef().skills || []
    const near = needTarget ? this.nearestEnemy() : null
    for (const key of SKILL_PRIORITY) {
      const s = skills[SKILL_SLOT[key]]
      if (!s || this.cooldowns[key] > 0) continue
      if (needTarget && !(near && near.d <= this.autoRange(s))) continue
      return key
    }
    return null
  }

  oneHandTap() {
    if (this.state !== 'battle' || !this.hero || this.hero.dead || this.heroLocked()) return
    if (this.titanReady && !this.titanMode) {
      haptic(HAPTIC_MS * 2)
      this.transform()
      return
    }
    if (this.heroBusy()) {
      this.tapQueuedT = TAP_QUEUE_TIME
      return
    }
    this.tapQueuedT = 0
    if (this.castUltimate()) return
    const key = this.readySkill(false)
    if (key) this.useSkill(key)
    else if (this.cooldowns.attack <= 0) this.attack()
  }

  flickDash(x, y) {
    if (this.state !== 'battle' || !this.hero || this.hero.dead || this.heroLocked()) return
    if (this.cooldowns.dash > 0) return
    haptic()
    this.dash(this.screenAxis(x, y))
  }

  dash(axis = this.moveAxis()) {
    this.cooldowns.dash = 2.4
    const [ax, az] = axis
    let dx = ax, dz = az
    if (!dx && !dz) { dx = Math.sin(this.hero.facing); dz = Math.cos(this.hero.facing) }
    const l = Math.hypot(dx, dz) || 1
    this.dashVec = new THREE.Vector3(dx / l, 0, dz / l)
    this.dashT = 0.28
    this.hero.rig.play('dash', { force: true })
    audio.play('dash')
    this.fx.dashDust(this.hero.pos.x, this.hero.pos.z, this.dashVec.x, this.dashVec.z)
    this.invuln = 0.34
  }

  castSkillFx(vfxId, s) {
    const hero = this.hero
    const reach = s.reach || 10
    const near = this.nearestEnemy()
    const target = near && near.d <= reach ? near.e : null
    if (target) {
      hero.faceTo(target.pos.x, target.pos.z)
      hero.facing = hero.targetFacing
    }
    hero.rig.play('cast', { force: true, skill: SKILL_SLOT[s.key] + 1 })
    audio.play(`${this.activeDef().model}_skill_${SKILL_SLOT[s.key] + 1}`)
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
      : hero.pos.clone().setY(0).add(_v.set(Math.sin(hero.facing), 0, Math.cos(hero.facing)).multiplyScalar(roles.has('aoe') ? 3 : R * 0.45))
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
        this.damage(e, s.dmg, color)
        e.stagger = 0.25
      } : null,
      onImpact: (share = 1) => {
        if (this.state !== 'battle') return
        this.shake(projectile ? 0.25 : 0.45, 0.3)
        if (projectile) return
        this.lights.flash(center, color, 4.5, R * 2.4, 0.65, 1.2)
        for (const e of inArea()) {
          this.damage(e, s.dmg * share, color)
          e.stagger = 0.3
        }
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
          this.damage(e, s.dmg, color)
          e.stagger = 0.25
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
          this.damage(e, s.dmg * share, color)
          e.stagger = 0.3
        },
        onImpact: () => {
          if (this.state !== 'battle') return
          this.shake(0.4, 0.3)
          if (focus) this.lights.flash(focus.pos, color, 4, R * 2, 0.5, 1.2)
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
        for (const e of inArea()) {
          this.damage(e, s.dmg, color)
          e.stagger = 0.3
        }
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
    hero.rig.play('cast', { force: true, skill: SKILL_SLOT[s.key] + 1 })
    audio.play(`${this.activeDef().model}_skill_${SKILL_SLOT[s.key] + 1}`)
    const color = this.activeDef().color

    setTimeout(() => {
      if (!this.hero || this.state !== 'battle') return
      if (s.type === 'nova') {
        const R = s.radius
        this.fx.shock(hero.pos.x, hero.pos.z, R * 2.4, color, 0.6)
        this.fx.decal(hero.pos.x, hero.pos.z, R * 2, color, 0.8, this.fx.crack, 0.6)
        this.fx.spark(hero.pos.x, 0.7, hero.pos.z, 70, color, 12)
        this.fx.flash(hero.pos.x, 1.2, hero.pos.z, R * 2.2, color, 0.35)
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
            _v.copy(hero.pos).setY(1.3)
            _v2.copy(e.pos).setY(e.height * 0.5)
            this.fx.beam(_v, _v2, 0.34, color, 0.22)
            this.fx.flash(e.pos.x, e.height * 0.5, e.pos.z, 2.1, color, 0.28)
            this.damage(e, s.dmg, color)
          }, i * 70)
        })
      } else if (s.type === 'beam') {
        const f = hero.facing
        _v.copy(hero.pos).setY(1.4)
        _v2.set(hero.pos.x + Math.sin(f) * s.length, 1.4, hero.pos.z + Math.cos(f) * s.length)
        this.fx.beam(_v, _v2, 1.5, color, 0.4)
        this.fx.spark(_v2.x, 1.2, _v2.z, 50, color, 10)
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

  damage(e, amount, color, hit) {
    if (this.shieldUp && e.def && e.def.boss && !e.dead) {
      this.blockHit(e)
      return
    }
    const mods = this.gearMods
    const crit = !!mods && Math.random() < mods.crit
    if (mods) amount *= mods.atk * (crit ? mods.critMult : 1)
    const dealt = e.hit(amount)
    if (!dealt) return
    const code = e.def && soundCode(e.def)
    this.lights.flash(e.pos, color || 0xffd070, 1.8, 3.4, 0.22, e.height * 0.5)
    this.damageNumber(e.pos.x, e.height * 0.75 + e.pos.y, e.pos.z, dealt, '#fff', amount > 120 || crit)
    this.fx.spark(e.pos.x, e.height * 0.5 + e.pos.y, e.pos.z, 12, color || 0xffd070, 5, 1, 0.22)
    if (hit) audio.play(hit, { slot: 'hit', max: 3, gap: 0.04 })
    if (!e.dead) audio.play(audio.has(`${code}_take_damage`) ? `${code}_take_damage` : `${code}_damage`, { at: e.pos, slot: e.def.boss ? 'boss_hurt' : 'enemy_hurt', max: 3, gap: 0.05 })
    if (!this.titanMode) this.addUlt(dealt * 0.0022 * this.heroDef.ultGain)
    if (e.dead) {
      this.kills++
      this.cancelBossCast(e)
      this.heroFx.detachSkin(e)
      this.lights.flash(e.pos, 0xa050ff, 2.6, 4.5, 0.55, 0.8)
      this.fx.enemyDeath(e.pos.x, e.pos.z, !!(e.def && e.def.boss))
      this.loot.dropFrom(e, e.def && e.def.loot, !!(e.def && e.def.boss))
      audio.play(`${code}_death`, { at: e.pos, slot: 'enemy_death', max: 3 })
      if (e.def && e.def.boss) {
        this.shake(1.1, 0.9)
        this.hitStop(180)
      }
    }
  }

  blockHit(e) {
    this.fx.spark(e.pos.x, e.height * 0.55 + e.pos.y, e.pos.z, 8, 0x9a7cff, 4, 1, 0.2)
    if (this.t - (this.immuneT || 0) < IMMUNE_TEXT_GAP) return
    this.immuneT = this.t
    this.lights.flash(e.pos, 0x8a6cff, 2.2, 4.5, 0.3, e.height * 0.5)
    this.floatText(e.pos.x, e.height * 0.85 + e.pos.y, e.pos.z, 'IMMUNE')
    audio.play('ui_button_locked', { slot: 'immune', gap: 0.4 })
  }

  floatText(x, y, z, text) {
    _v.set(x, y, z).project(this.camera)
    const d = document.createElement('div')
    d.className = 'dmg immune'
    d.textContent = text
    d.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`
    d.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`
    this.ui.root.appendChild(d)
    d.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
        { transform: 'translate(-50%,-80%) scale(1.15)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%,-170%) scale(1)', opacity: 0 },
      ],
      { duration: 900, easing: 'cubic-bezier(.15,.8,.3,1)' }
    ).onfinish = () => d.remove()
  }

  addTitan(v) {
    if (this.titanReady || this.titanMode || this.state === 'morph') return
    this.titan = clamp(this.titan + v, 0, 1)
    if (this.titan >= 1) {
      this.titanReady = true
      audio.play('vo_titan_charge')
      this.ui.showBanner('TITAN READY', 'tap anywhere', 1.4)
      this.ui.showGestureHint(true, 'titan')
    }
    this.ui.setTitan(this.titan, this.titanReady, this.titanSecondsLeft())
  }

  titanSecondsLeft() {
    return (1 - this.titan) * TITAN_CHARGE_TIME
  }

  addUlt(v) {
    if (this.ultReady || this.titanMode || this.state === 'morph') return
    this.ult = clamp(this.ult + v, 0, 1)
    if (this.ult >= 1) this.ultReady = true
    this.ui.setUlt(this.ult, this.ultReady)
  }

  ultInReach() {
    if (!this.ultReady || this.titanMode) return false
    const near = this.nearestEnemy()
    return !!near && near.d <= this.heroDef.ult.reach * 0.8
  }

  castUltimate() {
    if (!this.ultReady || this.titanMode || this.state !== 'battle' || !this.hero || this.hero.dead || this.heroLocked()) return false
    const h = this.hero
    const def = this.heroDef
    const u = def.ult
    this.ultReady = false
    this.ult = 0
    this.ui.setUlt(0, false)
    this.ui.fireUlt()
    const foes = this.enemies
      .filter(e => !e.dead && e.pos.distanceTo(h.pos) <= u.reach)
      .sort((a, b) => a.pos.distanceTo(h.pos) - b.pos.distanceTo(h.pos))
      .slice(0, u.count)
    if (foes[0]) {
      h.faceTo(foes[0].pos.x, foes[0].pos.z)
      h.facing = h.targetFacing
    }
    h.rig.play('cast', { force: true, skill: 4 })
    audio.play(`${def.model}_ult`)
    const hit = (e, i, share = 1) => {
      if (!e || e.dead || this.state !== 'battle') return
      this.damage(e, u.dmg * share, def.color)
      e.stagger = 0.4
    }
    const landed = () => {
      if (this.state !== 'battle') return
      this.lights.flash(h.pos, def.color, 6, 12, 0.9, 1.5)
      this.shake(0.7, 0.45)
    }
    const impact = h.rig.impactAt || 0.6
    const vfxId = this.heroVfx()
    if (vfxId && this.heroFx.hasSkill(vfxId, u.fx)) {
      this.heroFx.castSkill(vfxId, u.fx, h, foes, { impact, timing: u.timing, onHit: hit, onImpact: landed })
    } else {
      this.heroFx.later(impact, () => {
        foes.forEach(hit)
        this.fx.shock(h.pos.x, h.pos.z, u.reach, def.color, 0.8)
        landed()
      })
    }
    return true
  }

  transform() {
    if (!this.titanReady || this.titanMode || this.state !== 'battle') return
    this.titanReady = false
    this.ui.showGestureHint(false, 'titan')
    this.state = 'morph'
    this.morphT = 0
    this.ui.setTitan(1, false, 0)
    this.ui.pressAnima()
    this.ui.showSkip(true)
    audio.play(`${this.titanDef.model}_morph`)
    audio.duck(0.25, 300)
    audio.track('music_titan', 400)
    this.hero.rig.play('morph', { force: true })
    this.input.enabled = false

    const h = this.hero
    this.fx.morphBurst(h.pos.x, h.pos.z, 0x6fd8ff)
    this.lights.flash(h.pos, 0x6fd8ff, 7, 15, 1.8, 1.6)
    this.fx.decal(h.pos.x, h.pos.z, 14, 0x6fd8ff, 2.2, this.fx.crack, 0.4)
    this.shake(0.9, 1.3)

    gsap.to(this.bloom, { intensity: BLOOM_BASE * 3, duration: 0.9, yoyo: true, repeat: 1 })
    gsap.to(this.camOffset, { x: 3.2, y: 3.4, z: 5.4, duration: 1.1, ease: 'power2.inOut' })
    gsap.to(this.camLook, { y: 2.2, duration: 1.1 })

    this.crystals = []
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2
      const r = 5.5 + Math.random() * 3
      const g = new THREE.ConeGeometry(0.16 + Math.random() * 0.16, 0.9 + Math.random() * 1.0, 4)
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color: 0x9fe4ff, emissive: 0x2e8fd8, emissiveIntensity: 2.4,
        roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.95,
      }))
      m.position.set(h.pos.x + Math.cos(a) * r, 0.4 + Math.random() * 4.5, h.pos.z + Math.sin(a) * r)
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
      this.scene.add(m)
      this.crystals.push(m)
      gsap.to(m.position, { x: h.pos.x, y: 2.2, z: h.pos.z, duration: 1.5, delay: 0.15 + Math.random() * 0.5, ease: 'power3.in' })
      gsap.to(m.scale, { x: 0.1, y: 0.1, z: 0.1, duration: 0.4, delay: 1.5 + Math.random() * 0.2 })
    }

    setTimeout(() => this.finishMorph(), 2100)
  }

  skipCinematic() {
    if (this.state !== 'morph') return
    this.finishMorph()
  }

  async loadTitan(def) {
    const [data] = await Promise.all([loadModelData(def.model), this.vfx.preload([def.vfx])])
    this.vfx.warm(this.renderer, this.camera)
    await this.warmBattleFx([def.vfx])
    return { data, land: landingTime(data, 'Morph') }
  }

  heroLocked() {
    const rig = this.hero.rig
    return (rig.state === 'morph' || rig.state === 'unmorph') && !rig.oneShotDone
  }

  resetSkillCooldowns() {
    this.cooldowns.s1 = this.cooldowns.s2 = this.cooldowns.s3 = 0
  }

  async finishMorph() {
    if (this.titanMode || this.state !== 'morph' || this.summoning) return
    this.summoning = true
    this.ui.showSkip(false)
    for (const c of this.crystals || []) this.scene.remove(c)
    this.crystals = []

    const h = this.hero
    const def = this.titanDef
    this.fx.flash(h.pos.x, 2.4, h.pos.z, 26, 0xffffff, 0.55)

    const { data, land } = await this.titanLoad
    this.summoning = false
    const model = buildModel(data, { castShadow: true })
    const titan = new Actor(model, { targetHeight: model.height * h.scale, radius: def.radius })
    titan.setPos(h.pos.x, h.pos.z)
    titan.targetFacing = titan.facing = h.facing
    titan.hp = h.hp * 2.2
    titan.maxHp = h.maxHp * 2.2
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
    this.ui.setTitanHud(def)

    this.heroLight.color.set(def.color)
    this.heroLight.intensity = 40
    this.key.intensity = 3.4
    this.bloom.intensity = BLOOM_BASE * 1.4
    this.ui.setHp(titan.hp, titan.maxHp)
    this.ui.showBanner(def.name.toUpperCase(), def.title, 1.5)

    const titanView = this.battleOffset(TITAN_ZOOM_OUT)
    gsap.to(this.camOffset, { x: titanView.x, y: titanView.y, z: titanView.z, duration: 1.2, ease: 'power2.out' })
    gsap.to(this.camLook, { y: 2.4, duration: 1.2 })

    const landed = () => {
      if (this.hero !== titan) return
      this.fx.titanLanding(titan.pos.x, titan.pos.z, def.color)
      this.lights.flash(titan.pos, def.color, 8, 18, 1.1, 1.5)
      this.shake(1.4, 0.9)
      this.hitStop(160)
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
        if (!e.dead && this.hero === titan) this.damage(e, 160, def.color)
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
    this.ui.setHud(this.heroDef)
    this.ui.setUlt(this.ult, this.ultReady)
    const t = this.hero
    const h = this.heroBase
    this.heroFx.detachSkin(t)
    h.setPos(t.pos.x, t.pos.z)
    h.facing = h.targetFacing = t.facing
    h.hp = Math.max(h.maxHp * 0.55, h.hp)
    h.rig.play('unmorph', { force: true })
    this.scene.remove(t.root)
    this.scene.add(h.root)
    this.hero = h
    this.input.enabled = true
    this.resetSkillCooldowns()
    if (this.heroDef.vfx) this.heroFx.attachSkin(this.heroDef.vfx, h)
    this.heroLight.color.set(this.heroDef.color)
    this.heroLight.intensity = 16
    this.key.intensity = 2.5
    this.bloom.intensity = BLOOM_BASE
    this.fx.unmorph(h.pos.x, h.pos.z, 0x6fd8ff)
    this.ui.setHp(h.hp, h.maxHp)
    const battleView = this.battleOffset()
    gsap.to(this.camOffset, { x: battleView.x, y: battleView.y, z: battleView.z, duration: 1.0, ease: 'power2.inOut' })
    gsap.to(this.camLook, { y: BATTLE_LOOK_Y, duration: 1.0 })
    audio.track('music_battle', 700)
  }

  victory() {
    if (this.state === 'end') return
    this.state = 'end'
    this.ui.show('hud', false)
    this.shake(0.4, 0.5)
    gsap.to(this.camOffset, { x: 0.6, y: 2.6, z: 5.2, duration: 2.2, ease: 'power2.inOut' })
    gsap.to(this.camLook, { y: 1.5, duration: 2.2 })
    if (this.hero) this.hero.rig.play('roar', { force: true })
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const a = Math.random() * 6.28
        this.fx.celebrate(Math.cos(a) * 4, 1 + Math.random() * 3, Math.sin(a) * 4)
      }, 400 + i * 260)
    }
    setTimeout(() => this.showOutcome('victory'), 1400)
  }

  defeat() {
    if (this.variant === 'rescue' && !this.rescued && !this.titanMode) {
      this.rescued = true
      this.rescueActive = true
      this.rescueT = 3
      this.hero.hp = 1
      this.ui.show('fail', true)
      this.timeScale = 0.25
      audio.play('freeze')
      return
    }
    this.state = 'end'
    this.ui.show('hud', false)
    const short = this.underpowered()
    const score = short ? `${this.gear.power().toLocaleString('en-US')} / ${POWER_GOAL.toLocaleString('en-US')} power` : ''
    if (short) this.ui.showBanner('TOO WEAK', score, DEFEAT_REASON_DELAY)
    setTimeout(() => this.showOutcome('defeat'), short ? DEFEAT_REASON_DELAY * 1000 : 1200)
  }

  showOutcome(kind) {
    const defeat = kind === 'defeat'
    audio.layer('amb_battle', false, 500)
    audio.track('music_endcard', 500)
    audio.play(defeat ? 'outcome_defeat' : 'outcome_victory', { delay: defeat ? 0.06 : 0 })
    audio.play(defeat ? 'outcome_defeat_vo' : 'outcome_victory_vo', { delay: defeat ? 0.46 : 0.45 })
    audio.play('outcome_card_plate', { delay: 0.06 })
    audio.play('outcome_card_shine', { delay: 0.16 })
    this.ui.outcome.show(kind)
  }

  updateHero(dt) {
    const h = this.hero
    if (!h || h.dead) return
    const def = this.activeDef()
    const steer = this.moveAxis()
    const hold = this.gearOpen && !steer[0] && !steer[1]
    const [ax, az] = hold ? [0, 0] : steer[0] || steer[1] ? steer : this.autoMoveAxis(def)
    if (hold) h.targetFacing = this.camYaw
    const dashing = this.dashT > 0
    const rooted = ['cast', 'morph', 'unmorph'].includes(h.rig.state) && !h.rig.oneShotDone
    const moving = (ax || az) && !dashing && !rooted

    if (dashing) {
      this.dashT = Math.max(0, this.dashT - dt)
      const s = 26 * Math.max(0.25, this.dashT / 0.28)
      h.pos.addScaledVector(this.dashVec, s * dt)
      h.targetFacing = Math.atan2(this.dashVec.x, this.dashVec.z)
      this.fx.spark(h.pos.x, 0.5, h.pos.z, 2, this.heroDef.color, 1.5, 0.2, 0.2)
    } else if (moving) {
      const sp = def.speed * (this.titanMode ? 1 : 1)
      h.pos.x += ax * sp * dt
      h.pos.z += az * sp * dt
      h.targetFacing = Math.atan2(ax, az)
    }

    const r = Math.hypot(h.pos.x, h.pos.z)
    const lim = ARENA_RADIUS - 1.2
    if (r > lim) {
      h.pos.x *= lim / r
      h.pos.z *= lim / r
    }

    const swinging = ['attack', 'attack2'].includes(h.rig.state) && !h.rig.oneShotDone
    if (moving && swinging) h.pendingHit = null
    const busy = ['attack', 'attack2', 'cast', 'morph', 'unmorph', 'roar'].includes(h.rig.state) && !h.rig.oneShotDone && !(moving && swinging)
    if (this.dashT > 0) { /* dash pose active */ }
    else if (!busy && (moving || h.rig.finished)) h.rig.play(moving ? 'run' : 'idle', moving ? { speed: this.runRate(h, def) } : {})

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
          let da = ang - h.facing
          while (da > Math.PI) da -= Math.PI * 2
          while (da < -Math.PI) da += Math.PI * 2
          if (Math.abs(da) > p.arc) continue
          this.damage(e, p.dmg, def.color, `${def.model}_hit_combo`)
          if (p.fx !== null && p.fx !== undefined && p.vfx) this.heroFx.hitFx(p.vfx, p.fx, h, e)
          e.stagger = 0.2
          this.knock(e, dx / (d || 1), dz / (d || 1), this.titanMode ? KNOCK.titan : KNOCK.hero)
          hits++
        }
        if (hits) {
          this.shake(this.titanMode ? HIT_SHAKE.titan : HIT_SHAKE.hero, 0.16)
        }
        if (this.titanMode && (p.fx === null || p.fx === undefined)) {
          this.fx.shock(h.pos.x + Math.sin(h.facing) * 3, h.pos.z + Math.cos(h.facing) * 3, 11, 0xffd070, 0.5)
        }
      }
    }

    if (this.invuln > 0) this.invuln -= dt

    this.heroLight.position.set(h.pos.x, 2.6, h.pos.z)
  }

  runRate(actor, def) {
    if (actor.runRate === undefined) {
      const rate = def.speed / (strideSpeed(actor.model, 'Run') * actor.scale)
      actor.runRate = rate >= RUN_RATE[0] && rate <= RUN_RATE[1] ? rate : 1
    }
    return actor.runRate
  }

  updateEnemies(dt) {
    const h = this.hero
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (e.dead) {
        if (e.dying > 1.5) {
          this.scene.remove(e.root)
          this.enemies.splice(i, 1)
        } else {
          const k = clamp(1 - (e.dying - 0.8) / 0.7, 0, 1)
          for (const s of e.model.skins) {
            s.material.transparent = true
            s.material.opacity = k
          }
          e.update(dt, {})
        }
        continue
      }
      if (e.knockX || e.knockZ) this.slide(e, dt)
      if (e.def.boss) e.stagger = 0
      if (e.stagger > 0) {
        e.stagger -= dt
        if (e.rig.state !== 'hit') e.rig.play('hit', { force: true, fade: 0.06 })
        e.update(dt, {})
        continue
      }
      if (e.def.skills && this.updateBossCast(e, dt)) {
        this.settleEnemy(e, h, dt)
        continue
      }

      const dx = h.pos.x - e.pos.x
      const dz = h.pos.z - e.pos.z
      const d = Math.hypot(dx, dz) || 1
      e.faceTo(h.pos.x, h.pos.z)
      const range = e.def.range + (this.titanMode ? 2.2 : 0)

      if (d > range) {
        const sp = e.def.speed * (this.titanMode ? 0.7 : 1)
        e.pos.x += (dx / d) * sp * dt
        e.pos.z += (dz / d) * sp * dt
        if (!e.def.fly && e.rig.state !== 'run') e.rig.play('run', { fade: 0.18 })
        else if (e.def.fly && e.rig.state !== 'fly' && e.rig.oneShotDone) e.rig.play('fly', { fade: 0.18 })
      } else {
        e.cd -= dt
        const rest = e.def.fly ? 'fly' : 'idle'
        if (e.rig.state !== rest && e.rig.oneShotDone) e.rig.play(rest, { fade: 0.18 })
        if (e.cd <= 0) this.enemyAttack(e, range)
      }

      this.settleEnemy(e, h, dt)
    }
  }

  knock(e, nx, nz, dist) {
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
    e.cd = e.def.rate
    e.rig.play('attack', { force: true, fade: 0.08 })
    audio.play(this.attackSound(e.def, e.rig), { at: e.pos, slot: 'enemy_attack', max: 3 })
    const land = () => {
      if (this.invuln > 0 || !this.hero || this.hero.dead) return false
      this.hurtHero(e.def.dmg)
      audio.play(`${soundCode(e.def)}_hit_combo`, { at: e.pos, slot: 'enemy_hit', max: 2, gap: 0.08 })
      return true
    }
    const vfxId = this.enemyVfx(e.def)
    const fxRes = vfxId ? this.heroFx.attack(vfxId, this.comboIndexOf(e.rig), e, this.hero, {
      impact: e.rig.impactAt,
      onHit: t => {
        if (!e.dead && t === this.hero && this.state === 'battle') land()
      },
    }) : null
    if (fxRes && fxRes.ranged) return
    setTimeout(() => {
      if (e.dead || !this.hero || this.state !== 'battle') return
      const dd = Math.hypot(this.hero.pos.x - e.pos.x, this.hero.pos.z - e.pos.z)
      if (dd > range + 0.7 || !land()) return
      if (fxRes) fxRes.onTarget(this.hero)
      else this.fx.slash(this.hero.pos.x, 1.1, this.hero.pos.z, e.facing, 1.8, 0xff5a5a, 0.2)
    }, e.rig.impactAt * 1000)
  }

  settleEnemy(e, h, dt) {
    for (let k = 0; k < this.enemies.length; k++) {
      const o = this.enemies[k]
      if (o === e || o.dead) continue
      const ox = e.pos.x - o.pos.x
      const oz = e.pos.z - o.pos.z
      const od = Math.hypot(ox, oz)
      const min = e.radius + o.radius
      if (od < min && od > 0.001) {
        const push = (min - od) * 0.5
        e.pos.x += (ox / od) * push
        e.pos.z += (oz / od) * push
      }
    }

    const hx = e.pos.x - h.pos.x
    const hz = e.pos.z - h.pos.z
    const hd = Math.hypot(hx, hz)
    const hmin = e.radius + (this.titanMode ? 1.6 : h.radius)
    if (hd < hmin) {
      const nx = hd > 0.001 ? hx / hd : Math.sin(e.facing + Math.PI)
      const nz = hd > 0.001 ? hz / hd : Math.cos(e.facing + Math.PI)
      e.pos.x = h.pos.x + nx * hmin
      e.pos.z = h.pos.z + nz * hmin
    }

    const er = Math.hypot(e.pos.x, e.pos.z)
    const elim = ARENA_RADIUS - 0.4
    if (er > elim) {
      e.pos.x *= elim / er
      e.pos.z *= elim / er
    }

    if (e.def.fly) e.pos.y = e.def.fly + Math.sin(this.t * 2.4 + e.rig.t) * 0.25
    e.update(dt, {})
    this.footsteps(e, soundCode(e.def), e.def.boss ? 'step_big_anima_bosses' : 'step_ground', { at: e.pos, slot: 'enemy_step', max: 2 })
  }

  hurtHero(dmg) {
    if (!this.hero || this.hero.dead || this.state !== 'battle') return
    const mult = (this.titanMode ? 0.25 : 1) * (this.gearMods ? this.gearMods.taken : 1) * (this.shieldUp ? SHIELD_HIT_MULT : 1)
    this.hero.hp = Math.max(0, this.hero.hp - dmg * mult)
    this.hero.flash = 0.16
    this.ui.setHp(this.hero.hp, this.hero.maxHp)
    this.shake(0.22, 0.2)
    audio.play(`${this.activeDef().model}_damage`, { slot: 'hero_hurt', gap: 0.35 })
    this.chroma.offset.set(0.0035, 0.0035)
    gsap.to(this.chroma.offset, { x: 0.0004, y: 0.0004, duration: 0.45 })
    if (!this.titanMode) this.addUlt(dmg * 0.0012)
    if (this.hero.hp <= 0) {
      if (this.titanMode) { this.endTitan(); return }
      this.hero.dead = true
      this.hero.rig.play('death', { force: true })
      audio.play(`${this.heroDef.model}_death`)
      this.defeat()
    }
  }

  footsteps(actor, code, key, opts = {}) {
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
    const crossed = t >= prev ? times.some(s => s > prev && s <= t) : times.some(s => s > prev || s <= t)
    if (crossed) audio.play(key, opts)
  }

  portraitAmount() {
    return clamp((1.05 - this.camera.aspect) / 0.5, 0, 1)
  }

  phoneLandscapeAmount() {
    const [small, large] = PHONE_SHORT_SIDE
    const short = Math.min(innerWidth, innerHeight)
    return clamp((large - short) / (large - small), 0, 1) * (1 - this.portraitAmount())
  }

  battleFraming() {
    return clamp((this.camOffset.length() - CLOSE_UP_DIST) / (BATTLE_DIST - CLOSE_UP_DIST), 0, 1)
  }

  battleReach(p, framing) {
    const far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1, PHONE_LAND_FAR_DIST, this.phoneLandscapeAmount()), PORTRAIT_FAR_DIST, p)
    const near = THREE.MathUtils.lerp(1, PORTRAIT_DIST, p)
    return THREE.MathUtils.lerp(near, far, framing)
  }

  selectShowsRow() {
    return this.camera.aspect >= SELECT_ROW_ASPECT
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
    const [ax, az] = this.input.axis()
    return this.screenAxis(ax, az)
  }

  screenAxis(ax, az) {
    const c = Math.cos(this.camYaw)
    const s = Math.sin(this.camYaw)
    return [ax * c + az * s, az * c - ax * s]
  }

  cameraFocus() {
    if (this.hero) return this.hero.pos
    if (this.state === 'select' && this.selectActors && this.selectActors[this.heroIndex] && (this.confirming || !this.selectShowsRow())) {
      return this.selectActors[this.heroIndex].pos
    }
    return _zero
  }

  updateCamera(dt) {
    const p = this.portraitAmount()
    const playing = this.state === 'battle' || this.state === 'intro' || this.titanMode
    const zoom = playing ? p : 0
    const follow = THREE.MathUtils.lerp(0.72 + 0.28 * p, 1, this.gearK)
    const target = this.cameraFocus()
    _v.set(target.x * follow, 0, target.z * follow)
    const selecting = this.state === 'select'
    if (this.camSnap) this.camTarget.copy(_v)
    else if (selecting && dt > 0) smoothDamp(this.camTarget, _v, _camVel, SELECT_CAM_SMOOTH, dt)
    else this.camTarget.lerp(_v, Math.min(1, dt * (3.2 + GEAR_CHASE * this.gearK)))
    const push = selecting && this.confirming ? Math.min(1, this.confirmT / CONFIRM_TIME) : 0
    const framing = playing ? this.battleFraming() : 0
    const reach = playing ? this.battleReach(p, framing) : 1
    const dist = this.camOffset.length() * reach * THREE.MathUtils.lerp(1, CONFIRM_PUSH, push * push * push) * THREE.MathUtils.lerp(1, this.gearDist, this.gearK)
    const flat = Math.hypot(this.camOffset.x, this.camOffset.z) || 1
    const portraitPitch = THREE.MathUtils.lerp(PORTRAIT_PITCH, PORTRAIT_FAR_PITCH, framing)
    const pitch = THREE.MathUtils.lerp(Math.atan2(this.camOffset.y, flat), Math.max(Math.atan2(this.camOffset.y, flat), portraitPitch), zoom)
    _off.set(this.camOffset.x / flat, 0, this.camOffset.z / flat).multiplyScalar(Math.cos(pitch) * dist)
    _off.y = Math.sin(pitch) * dist
    _off.applyAxisAngle(_up, this.camYaw)
    _v.copy(this.camTarget).add(_off)
    if (this.camSnap || selecting) this.camera.position.copy(_v)
    else this.camera.position.lerp(_v, Math.min(1, dt * (5.5 + GEAR_CHASE * this.gearK)))
    this.camSnap = false
    _v2.copy(this.camTarget).add(this.camLook)
    _v2.y += GEAR_LOOK * this.gearK
    _v2.x += Math.sin(this.camYaw) * 2.1 * zoom * (1 - this.gearK)
    _v2.z += Math.cos(this.camYaw) * 2.1 * zoom * (1 - this.gearK)
    this.camera.lookAt(_v2)

    if (this.shakeT > 0) {
      this.shakeT -= dt
      const k = this.shakeAmp * Math.max(0, this.shakeT)
      this.camera.position.x += (Math.random() - 0.5) * k
      this.camera.position.y += (Math.random() - 0.5) * k
      this.camera.position.z += (Math.random() - 0.5) * k * 0.6
      if (this.shakeT <= 0) this.shakeAmp = 0
    }
  }

  loop() {
    let last = performance.now()
    const frame = now => {
      requestAnimationFrame(frame)
      let dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (this.paused) { this.composer.render(); return }
      this.realDt = dt
      dt *= this.timeScale * THREE.MathUtils.lerp(1, GEAR_SLOWMO, this.gearK)
      this.t += dt
      this.step(dt)
      this.composer.render()
    }
    requestAnimationFrame(frame)
  }

  step(dt) {
    if (this.gearOpen && (this.state !== 'battle' || !this.hero || this.hero.dead)) this.closeGear()
    this.ui.tick(dt)
    if (this.arena) this.arena.update(dt, this.t)
    if (this.fx) this.fx.update(dt, this.camera)
    tickCharacters(dt)
    if (this.lights) this.updateLights(dt)

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
        if (this.state === 'battle') this.updateHero(dt)
        this.hero.update(dt, {})
        audio.listen(this.hero.pos.x, this.hero.pos.z, this.camYaw)
        this.footsteps(this.hero, this.activeDef().model, this.titanMode ? 'step_big_anima_bosses' : 'step_ground')
      }
      this.updateEnemies(dt)
    }

    if (this.state === 'battle') {
      for (const k in this.cooldowns) {
        if (this.cooldowns[k] > 0) {
          this.cooldowns[k] -= dt
          const max = k === 'attack' ? this.activeDef().atkRate
            : k === 'dash' ? 2.4 : (this.activeDef().skills[SKILL_SLOT[k]] || { cd: 1 }).cd
          this.ui.cooldown(k, clamp(this.cooldowns[k] / max, 0, 1), this.cooldowns[k])
        } else {
          this.ui.cooldown(k, 0, 0)
        }
      }

      this.tallyWaveKills()
      if (this.pending.length) {
        this.waveTimer += dt
        while (this.pending.length && this.pending[0].t <= this.waveTimer) {
          this.spawnEnemy(this.pending.shift().type)
        }
      } else if (!this.spawning && !this.enemies.some(e => !e.dead)) {
        if (this.waveIndex < WAVES.length - 1) this.nextWave()
        else if (!this.loot.busy || this.lootWait >= LOOT_VICTORY_WAIT) this.victory()
        else {
          this.lootWait += dt
          if (this.lootWait >= LOOT_SHOWCASE) this.loot.collectAll()
        }
      }

      if (this.titanMode) {
        this.titanT -= dt
        this.ui.setTitanTimer(Math.max(0, this.titanT) / this.titanDef.duration, true)
        if (this.titanT <= 0) this.endTitan()
      } else if (!this.titanReady) {
        this.addTitan(dt / TITAN_CHARGE_TIME)
      }

      const [mx, mz] = this.input.axis()
      const steering = (mx || mz) && !(this.dashT > 0)
      this.autoCastT = Math.max(0, (this.autoCastT || 0) - dt)
      if (this.tapQueuedT > 0) {
        this.tapQueuedT -= dt
        if (!this.heroBusy() && !this.heroLocked()) this.oneHandTap()
      }
      if (this.autoCast !== false && !this.gearOpen && !steering && this.autoCastT <= 0 && !this.heroLocked() && !this.heroBusy()) {
        if (this.ultInReach() && this.castUltimate()) this.autoCastT = AUTO_CAST_GAP
        else {
          const key = this.readySkill(true)
          if (key) {
            this.useSkill(key)
            this.autoCastT = AUTO_CAST_GAP
          }
        }
      }
      if (!this.gearOpen && this.cooldowns.attack <= 0 && !steering && !this.heroLocked() && !this.heroBusy()) {
        const near = this.nearestEnemy()
        const def = this.activeDef()
        if (near && near.d < def.atkRange + 0.6) this.attack()
      }
    }

    if (this.rescueActive) {
      this.rescueT -= dt / this.timeScale * 0.25
      const n = Math.max(0, Math.ceil(this.rescueT))
      this.ui.fail.querySelector('.countdown').textContent = n
      if (this.rescueT <= 0) {
        this.rescueActive = false
        this.timeScale = 1
        this.ui.show('fail', false)
        this.defeat()
      }
    }

    this.updateCamera(this.gearK > 0 ? this.realDt : dt)
    if (this.loot && this.hero) this.loot.update(dt, this.hero, this.lootAnchor())
    if (this.heroFx) this.heroFx.update(dt)
    if (this.vfx) this.vfx.update(dt, this.camera)
    this.updateEnemyBars()
    this.updateHeroBar()
    if (this.gearOpen) this.placeGear()
  }

  updateHeroBar() {
    const h = this.hero
    if (!h) return this.ui.placeHeroBar(0, 0, false)
    _v.set(h.pos.x, h.pos.y + h.height * 1.08 + 0.55, h.pos.z).project(this.camera)
    const visible = !h.dead && !this.gearOpen && _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2
    this.ui.placeHeroBar((_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight, visible)
  }

  updateEnemyBars() {
    this.ui.pruneEnemyBars(this.enemies)
    this.camera.updateMatrixWorld()
    for (const e of this.enemies) {
      _v.set(e.pos.x, e.pos.y + e.height * 1.08 + 0.3, e.pos.z).project(this.camera)
      const visible = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2
      this.ui.placeEnemyBar(e, (_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight, visible)
    }
  }

  nearestEnemy() {
    let best = null
    let bd = Infinity
    for (const e of this.enemies) {
      if (e.dead) continue
      const d = Math.hypot(e.pos.x - this.hero.pos.x, e.pos.z - this.hero.pos.z)
      if (d < bd) { bd = d; best = e }
    }
    return best ? { e: best, d: bd } : null
  }
}
