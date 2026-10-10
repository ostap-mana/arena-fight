import * as THREE from 'three'
import { stream } from './rng.js'

const random = stream('sim')

const LOOPS = {
  idle: ['Idle'],
  pose: ['IdleLOB', 'IdleHomeLOB', 'IdleTeamLOB', 'Idle'],
  run: ['Run', 'Walk'],
  walk: ['Walk', 'Run'],
  fly: ['Run', 'Idle'],
}

const MOVES = {
  cast: { options: [['Skill_1_PreCast', 'Skill_1_EndCast'], ['Skill_2_PreCast', 'Skill_2_EndCast'], ['Skill_1_EndCast']], hold: 0.45 },
  cast2: { options: [['Skill_2_PreCast', 'Skill_2_EndCast'], ['Skill_1_PreCast', 'Skill_1_EndCast'], ['Skill_1_EndCast']], hold: 0.45 },
  cast3: { options: [['Skill_3_PreCast', 'Skill_3_EndCast'], ['Skill_3'], ['Skill_2_PreCast', 'Skill_2_EndCast'], ['Skill_1_EndCast']], hold: 0.45 },
  castUlt: { options: [['SkillUlt_PreCast', 'SkillUlt_EndCast'], ['Skill_3_PreCast', 'Skill_3_EndCast'], ['Skill_1_EndCast']], hold: 0.6 },
  leap: { options: [['Skill_1_PreCast', 'Skill_1_Cast', 'Skill_1_EndCast'], ['Skill_1_PreCast', 'Skill_1_EndCast']] },
  dash: { options: [['Dash'], ['Run']] },
  hit: { options: [['Flinch'], ['Shock'], ['Freeze']] },
  death: { options: [['Death']], variants: /^Death(_\d+)?$/ },
  morph: { options: [['Morph', 'Morph_EndCast'], ['SkillUlt_PreCast', 'SkillUlt_EndCast'], ['Skill_3_PreCast', 'Skill_3_EndCast']] },
  unmorph: { options: [['UnMorph', 'UnMorph_EndCast'], ['UnMorph'], ['Idle']] },
  roar: { options: [['IdleBreak'], ['Skill_2_EndCast'], ['Skill_1_EndCast']] },
  intro: { options: [['IntroLOB']] },
  idlebreak: { options: [['IdleBreakLOB_1'], ['IdleBreakLOB_2']] },
}

const COMBO = /^ComboAttack_(\d+)$/
export const CHAIN_FADE = 0
const COMBO_RESET = 2.4
const ATTACK_RECOVERY = 0.32
const BLEND = { idle: 0.15, run: 0.1, walk: 0.1, cast: 0, dash: 0, morph: 0, unmorph: 0, death: 0.25 }
const FIRST_COMBO_BLEND = 0
const COMBO_BLEND = 0.1
const DEFAULT_BLEND = 0.14
const LEGS_FADE = 0.12
const TWIST_RATE = 12
const UP = new THREE.Vector3(0, 1, 0)
const _parentQuat = new THREE.Quaternion()
const _twistQuat = new THREE.Quaternion()
const parts = new WeakMap()

function upperBones(model) {
  const spine = model.bones && model.bones.find(b => /spine/i.test(b.name))
  if (!spine) return null
  const names = new Set()
  spine.traverse(o => names.add(o.name))
  return { spine, names }
}

function partOf(clip, upper, top) {
  let entry = parts.get(clip)
  if (!entry) parts.set(clip, (entry = {}))
  const key = top ? 'top' : 'legs'
  if (!entry[key]) entry[key] = new THREE.AnimationClip(`${clip.name}:${key}`, clip.duration, clip.tracks.filter(t => upper.names.has(t.name.split('.')[0]) === top))
  return entry[key]
}

export class Rig {
  constructor(model) {
    this.clips = model.clips
    this.impacts = model.impacts
    this.mixer = new THREE.AnimationMixer(model.root)
    this.combo = [...this.clips.keys()]
      .filter(n => COMBO.test(n))
      .sort((a, b) => Number(a.match(COMBO)[1]) - Number(b.match(COMBO)[1]))
    this.comboIndex = 0
    this.comboNext = new Map()
    this.lastAttackAt = -Infinity
    this.rootOffset = new THREE.Vector3()
    this.rootTilt = 0
    this.clock = 0
    this.state = ''
    this.stateT = 0
    this.oneShotDone = true
    this.impactAt = 0
    this.release = 0
    this.total = 0
    this.looping = true
    this.action = null
    this.queue = []
    this.segmentT = 0
    this.segmentLength = Infinity
    this.segment = null
    this.upper = upperBones(model)
    this.layered = false
    this.legsAction = null
    this.twist = 0
    this.twistTarget = 0
    this.play('idle', { force: true })
    this.fresh = true
  }

  get t() {
    return this.clock
  }

  set t(value) {
    this.clock = value
    if (this.looping && this.action) this.action.time = value % this.action.getClip().duration
  }

  get finished() {
    return this.looping || this.stateT >= this.total - CHAIN_FADE
  }

  has(name) {
    return this.clips.has(name)
  }

  play(state, opts = {}) {
    if (state === this.state && !opts.force) return
    const plan = this.plan(state, opts)
    this.state = state
    this.stateT = 0
    this.looping = plan.loop
    this.oneShotDone = plan.loop
    this.release = plan.release
    this.impactAt = plan.impact
    this.total = plan.total || 0
    this.queue = plan.segments.slice(1)
    this.start(plan.segments[0], this.fresh ? 0 : opts.fade ?? plan.blend ?? BLEND[state] ?? DEFAULT_BLEND)
  }

  retime(times) {
    this.impacts = new Map([...this.impacts, ...Object.entries(times)])
  }

  retimeCombo(combo) {
    if (!combo) return
    if (combo.hit) this.retime(Object.fromEntries(combo.hit.map((t, i) => [`ComboAttack_${i}`, t])))
    if (combo.next) this.comboNext = new Map(combo.next.map((t, i) => [`ComboAttack_${i}`, t]))
  }

  plan(state, opts) {
    if ((state === 'attack' || state === 'attack2') && this.combo.length) return this.planAttack(opts)
    const loop = (LOOPS[state] || []).find(n => this.clips.has(n))
    if (loop) return { loop: true, segments: [{ clip: this.clips.get(loop), speed: opts.speed || 1 }], release: 0, impact: 0 }
    const casts = { 2: MOVES.cast2, 3: MOVES.cast3, 4: MOVES.castUlt }
    const move = (state === 'cast' && casts[opts.skill]) || MOVES[state]
    const names = move && this.pickMove(move)
    if (names) return this.planMove(move, names, opts)
    const fallback = this.clips.get('Idle') || this.clips.values().next().value
    return { loop: true, segments: [{ clip: fallback, speed: 1 }], release: 0, impact: 0 }
  }

  planAttack(opts) {
    if (this.clock - this.lastAttackAt > COMBO_RESET) this.comboIndex = 0
    this.lastAttackAt = this.clock
    const name = this.combo[this.comboIndex++ % this.combo.length]
    const clip = this.clips.get(name)
    const speed = opts.speed || 1
    const impact = this.impacts.get(name) / speed
    const length = clip.duration / speed
    return {
      loop: false,
      segments: [{ clip, speed }],
      impact,
      release: Math.min(length, this.comboNext.has(name) ? this.comboNext.get(name) / speed : impact + ATTACK_RECOVERY),
      total: length,
      blend: name === this.combo[0] ? FIRST_COMBO_BLEND : COMBO_BLEND,
    }
  }

  pickMove(move) {
    if (move.variants) {
      const pool = [...this.clips.keys()].filter(n => move.variants.test(n))
      if (pool.length) return [pool[Math.floor(random() * pool.length)]]
    }
    return move.options.find(names => names.every(n => this.clips.has(n)))
  }

  planMove(move, names, opts) {
    const speed = opts.speed || 1
    const segments = names.map(name => ({ clip: this.clips.get(name), speed }))
    const lengths = segments.map(s => s.clip.duration / s.speed)
    const total = lengths.reduce((a, b) => a + b, 0)
    const windup = segments.length > 1 ? lengths[0] : 0
    const impact = windup ? windup : this.impacts.get(names[0]) / speed
    return {
      loop: false,
      segments,
      release: move.hold ? Math.min(total, impact + move.hold) : total,
      impact,
      total,
    }
  }

  setLegs(on, speed = 1) {
    if (!this.upper) return
    if (on === this.layered) {
      if (on && this.legsAction) this.legsAction.setEffectiveTimeScale(speed)
      return
    }
    const run = on && (this.clips.get('Run') || this.clips.get('Walk'))
    if (on && !run) return
    this.layered = on
    if (on) {
      this.legsAction = this.mixer.clipAction(partOf(run, this.upper, false))
      this.legsAction.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(speed).setEffectiveWeight(1).play()
      this.legsAction.fadeIn(LEGS_FADE)
    } else if (this.legsAction) {
      this.legsAction.fadeOut(LEGS_FADE)
      this.legsAction = null
    }
    this.swapMain()
  }

  aim(angle) {
    this.twistTarget = this.upper ? angle : 0
  }

  mainClip(clip) {
    return this.layered ? partOf(clip, this.upper, true) : clip
  }

  swapMain() {
    const prev = this.action
    if (!prev || !this.segment) return
    const next = this.mixer.clipAction(this.mainClip(this.segment.clip))
    if (next === prev) return
    next.reset()
    next.setLoop(prev.loop, Infinity)
    next.clampWhenFinished = prev.clampWhenFinished
    next.time = prev.time
    next.setEffectiveTimeScale(prev.getEffectiveTimeScale())
    next.setEffectiveWeight(1)
    next.play()
    prev.stop()
    this.action = next
  }

  start(segment, fade) {
    this.segment = segment
    const action = this.mixer.clipAction(this.mainClip(segment.clip))
    const previous = this.action
    this.action = action
    this.segmentT = 0
    this.segmentLength = segment.clip.duration / segment.speed
    if (previous === action && this.looping) {
      action.setEffectiveTimeScale(segment.speed)
      return
    }
    if (fade <= 0) {
      this.mixer.stopAllAction()
      if (this.legsAction) this.legsAction.setEffectiveWeight(1).play()
    }
    action.reset()
    action.setLoop(this.looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !this.looping
    action.setEffectiveTimeScale(segment.speed)
    action.setEffectiveWeight(1)
    action.play()
    if (previous && previous !== action && fade > 0) action.crossFadeFrom(previous, fade, false)
  }

  update(dt) {
    this.fresh = false
    this.clock += dt
    this.stateT += dt
    let left = dt
    while (this.queue.length && this.segmentT + left >= this.segmentLength - CHAIN_FADE) {
      const step = Math.max(0, this.segmentLength - CHAIN_FADE - this.segmentT)
      this.mixer.update(step)
      left -= step
      this.start(this.queue.shift(), CHAIN_FADE)
    }
    this.segmentT += left
    if (!this.oneShotDone && this.stateT >= this.release) this.oneShotDone = true
    this.mixer.update(left)
    this.applyTwist(dt)
  }

  applyTwist(dt) {
    this.twist += (this.twistTarget - this.twist) * Math.min(1, dt * TWIST_RATE)
    if (Math.abs(this.twist) < 0.001) return
    const spine = this.upper.spine
    spine.parent.updateWorldMatrix(true, false)
    spine.parent.getWorldQuaternion(_parentQuat)
    _twistQuat.setFromAxisAngle(UP, this.twist).premultiply(_parentQuat.invert())
    _parentQuat.invert()
    _twistQuat.multiply(_parentQuat)
    spine.quaternion.premultiply(_twistQuat)
  }
}
