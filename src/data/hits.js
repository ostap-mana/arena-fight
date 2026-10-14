export const HIT_KINDS = {
  slash: { rim: [1, 0.92, 0.85], shake: 1, light: null },
  venom: { label: 'POISON', rim: [0.4, 1, 0.22], shake: 0.7, light: 0x5cff3a },
  bleed: { label: 'BLEED', rim: [1, 0.1, 0.06], shake: 1.15, light: null },
  crush: { label: 'CRUSH', rim: [1, 0.86, 0.6], shake: 2.4, light: 0xffc890 },
  quake: { label: 'QUAKE', rim: [1, 0.62, 0.3], shake: 3.2, light: 0xff8a3a },
  fire: { label: 'BURN', rim: [1, 0.42, 0.04], shake: 1.8, light: 0xff6a1a },
  trample: { label: 'TRAMPLED', rim: [1, 0.5, 0.14], shake: 3.6, light: 0xff6a1a },
}

export const ENEMY_HITS = {
  grunt: { kind: 'slash' },
  flyer: { kind: 'venom', share: 0.45, dot: { time: 3.5, every: 0.5, stacks: 3 } },
  stalker: { kind: 'bleed', share: 0.6, dot: { time: 2, every: 0.4, stacks: 2 } },
  warden: { kind: 'crush', push: 2.6 },
  golem: { kind: 'crush', push: 0.6 },
  knight: { kind: 'fire', push: 2.4, share: 0.75, dot: { time: 3, every: 0.5, stacks: 1 }, boss: true },
}

export const SKILL_HITS = {
  rockLeap: { kind: 'quake', push: 1.4 },
  hellfire: { kind: 'fire', push: 5, share: 0.7, dot: { time: 4, every: 0.5, stacks: 1 }, boss: true },
  infernalCharge: { kind: 'trample', push: 8, boss: true },
}
