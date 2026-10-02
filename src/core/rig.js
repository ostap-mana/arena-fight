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

  start(segment, fade) {
    const action = this.mixer.clipAction(segment.clip)
    const previous = this.action
    this.action = action
    this.segmentT = 0
    this.segmentLength = segment.clip.duration / segment.speed
    if (previous === action && this.looping) {
      action.setEffectiveTimeScale(segment.speed)
      return
    }
    if (fade <= 0) this.mixer.stopAllAction()
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
  }
}
