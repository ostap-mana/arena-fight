const RING = 0.76
const INNER = 0.6
const IDLE_SCALE = 0.84
const CONTACT_SIZE = 1.6
const REVEAL_TIME = 0.3
const REVEAL_START = 0.14
const REVEAL_END = 1.08
const SHOCK_TIME = 0.55
const SHOCK_FROM = 0.3
const SHOCK_TO = 0.98
const SHADE = 0.05
const BOLD_PORTRAIT = 0.45
const CURTAIN_HEIGHT = 0.42
const CURTAIN_SEGMENTS = 160
const CURTAIN_RISE_TIME = 0.42
const CURTAIN_LIFT = 0.006
const OVERSHOOT = 1.70158
const GLYPH_COUNT = 14
const GLYPH_LIFE = 2.4
const GLYPH_RISE = 0.95
const GLYPH_DRIFT = 0.3
const GLYPH_SIZE = 0.3
const GLYPH_RADIUS = 0.69
const GLYPH_ARC = 3.3
const RUNE_CUT = 0.4
const RUNE_SHARP = 0.6

const LOOK = {
  fire: {
    deep: [0.92, 0.07, 0.03],
    hot: [1.0, 0.82, 0.5],
    exposure: 0.85,
    corona: 'T_FX_Shape_3_4_Teeth_Noise',
    coronaMap: [5, 0.2, 0.74],
    coronaLen: 0.17,
    wobble: 0.1,
    ripple: 0,
    rise: 1.1,
  },
  water: {
    deep: [0.08, 0.16, 1.0],
    hot: [0.78, 0.95, 1.0],
    exposure: 1,
    corona: 'T_FX_WaterRings',
    coronaMap: [2, 0.0, 0.62],
    coronaLen: 0.19,
    wobble: 0.05,
    ripple: 1,
    rise: 0.7,
  },
}

const GLSL_CONSTANTS = `
  const float TAU = 6.2831853;
  const float PI = 3.1415927;
  const float RING = ${RING.toFixed(4)};
  const float INNER = ${INNER.toFixed(4)};
  const float RUNE_IN = 0.61;
  const float RUNE_OUT = 0.75;
  const float RUNE_TOP = 0.82;
  const float RUNE_BOTTOM = 0.16;
  const float RUNE_TILES = 4.0;
  const float SIGIL_R = 0.42;
  const float SIGIL_W = 0.0034;
  const float SIGIL_STEP = TAU / 4.0;
  const float SIGIL_GAP = 0.05;
  const float SIGIL_PIP = 0.03;
  const float BAND_SPIN = 0.14;
  const float SEAL_SPIN = 0.24;
  const float STREAK_SPEED = 1.25;
  const float SECTOR = TAU / 3.0;
  const float RIPPLE_SPEED = 0.16;
  const float PULSE_PERIOD = 2.6;
  const float PULSE_FROM = 0.1;
  const float PULSE_TO = 0.8;
`

const SHARED_GLSL = `
  float wrapPi(float x) {
    return x - TAU * floor((x + PI) / TAU);
  }
  vec3 toneMap(vec3 deep, vec3 main, vec3 hotTint, float energy, float hot) {
    vec3 tone = mix(deep, main, smoothstep(0.15, 1.8, energy));
    return 1.0 - exp(-tone * energy - hotTint * hot);
  }
`

const ARCANE_FS = `
  uniform vec3 uColor;
  uniform vec3 uDeep;
  uniform vec3 uHot;
  uniform float uExposure;
  uniform float uTime;
  uniform float uOn;
  uniform float uIdle;
  uniform float uFlash;
  uniform float uReveal;
  uniform float uEdge;
  uniform float uShockR;
  uniform float uShockA;
  uniform float uBold;
  uniform vec3 uCoronaMap;
  uniform float uCoronaLen;
  uniform float uWobble;
  uniform float uRipple;
  uniform sampler2D uRunes;
  uniform sampler2D uCorona;
  uniform sampler2D uCaustic;
  uniform sampler2D uWarp;
  uniform sampler2D uFlow;
  varying vec2 vUv;
  ${GLSL_CONSTANTS}
  ${SHARED_GLSL}
  float stroke(float d, float width) {
    float aa = max(fwidth(d), 1e-5);
    float w = max(width, aa * 0.75);
    return 1.0 - smoothstep(w - aa * 0.5, w + aa * 0.5, d);
  }
  float polar(sampler2D tex, vec2 uv, vec2 gA, vec2 gR, float su, float sv) {
    return textureGrad(tex, uv, vec2(gA.x * su, gR.x * sv), vec2(gA.y * su, gR.y * sv)).r;
  }
  float crisp(float m) {
    float aa = max(fwidth(m) * 0.6, 0.015);
    return smoothstep(${RUNE_CUT.toFixed(3)} - aa, ${RUNE_CUT.toFixed(3)} + aa, m);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x + 1e-6);
    vec2 dpx = dFdx(p);
    vec2 dpy = dFdy(p);
    float rr = max(r, 1e-3);
    vec2 gA = vec2(p.x * dpx.y - p.y * dpx.x, p.x * dpy.y - p.y * dpy.x) / (rr * rr);
    vec2 gR = vec2(dot(p, dpx), dot(p, dpy)) / rr;
    float t = uTime;
    float lit = uOn;
    float idle = (1.0 - uOn) * uIdle;
    float bandSpin = -t * BAND_SPIN;

    float behind = fract((a + t * STREAK_SPEED) / SECTOR);
    float ahead = 1.0 - behind;
    float ignite = exp(-behind * 4.5);

    float front = abs(wrapPi(a + PI * 0.5)) / PI;
    float drawn = 1.0 - smoothstep(uReveal - 0.05, uReveal, front);
    float edge = exp(-abs(front - uReveal) * 28.0) * uEdge;

    float pulseT = fract(t / PULSE_PERIOD);
    float pulseR = mix(PULSE_FROM, PULSE_TO, 1.0 - (1.0 - pulseT) * (1.0 - pulseT));
    float dPulse = r - pulseR;
    float pulse = exp(-dPulse * dPulse / 0.0035) * (1.0 - pulseT) * smoothstep(0.0, 0.1, pulseT) * lit;

    float liquid = 0.5;
    float web = 0.0;
    if (lit > 0.001 && r < RING + 0.06) {
      float warp = texture2D(uWarp, p * vec2(1.0, 0.5) + vec2(0.02, 0.09) * t).r - 0.5;
      vec2 cq = p * 0.62 + warp * 0.07 + vec2(0.01, 0.1) * t * 0.6;
      liquid = textureGrad(uCaustic, cq, dpx * 0.62, dpy * 0.62).r;
      web = smoothstep(0.52, 0.9, liquid);
    }

    float flow = 0.5;
    if (r > INNER - 0.03 && r < RING + 0.1) {
      float flowU = (a - bandSpin) / TAU * 6.0 - t * 0.22;
      flow = polar(uFlow, vec2(flowU, r * 1.5 - t * 0.05), gA, gR, 6.0 / TAU, 1.5);
    }

    float dRing = abs(r - RING);
    float ringCore = stroke(dRing, 0.0032);
    float bold2 = uBold * uBold;
    float ringTube = exp(-dRing * dRing / (0.00003 * bold2));
    float ringBody = exp(-dRing * dRing / (0.00022 * bold2));
    float ringGlow = exp(-dRing * 22.0);
    float breathe = 0.9 + 0.1 * sin(t * 2.3);
    float ringE = (ringTube * 0.8 + ringBody * 0.55) * (0.65 + 0.6 * flow + 0.9 * web) * breathe;

    float dIn = abs(r - INNER);
    float inCore = stroke(dIn, 0.0024 * uBold);
    float inGlow = exp(-dIn * 48.0);

    float runes = 0.0;
    float runeSoft = 0.0;
    if (r > RUNE_IN - 0.02 && r < RUNE_OUT + 0.02) {
      float rv = clamp((r - RUNE_IN) / (RUNE_OUT - RUNE_IN), 0.0, 1.0);
      float ru = (a - bandSpin) / TAU * RUNE_TILES;
      vec2 ruv = vec2(ru, mix(RUNE_TOP, RUNE_BOTTOM, rv));
      float su = RUNE_TILES / TAU;
      float sv = (RUNE_BOTTOM - RUNE_TOP) / (RUNE_OUT - RUNE_IN);
      float band = smoothstep(0.0, 0.1, rv) * (1.0 - smoothstep(0.9, 1.0, rv));
      float rm = polar(uRunes, ruv, gA * ${RUNE_SHARP.toFixed(3)}, gR * ${RUNE_SHARP.toFixed(3)}, su, sv);
      runes = crisp(rm) * band;
      runeSoft = smoothstep(0.18, ${RUNE_CUT.toFixed(3)}, rm) * band;
    }

    float corona = 0.0;
    float coronaHeat = 0.0;
    float coronaLen = uCoronaLen;
    if (lit > 0.001 && r > RING - 0.02 && r < RING + coronaLen) {
      float tiles = uCoronaMap.x;
      float cv = clamp((r - RING + 0.012) / coronaLen, 0.0, 1.0);
      float cu = (a - bandSpin * 0.6) / TAU * tiles;
      float fl = polar(uFlow, vec2(cu * 2.0 + 0.37, cv * 0.7 - t * 0.8), gA, gR, tiles * 2.0 / TAU, 0.7 / coronaLen);
      float wob = (fl - 0.5) * uWobble;
      if (uRipple > 0.5) {
        float wave = polar(uCorona, vec2(cu + wob, cv * uCoronaMap.z - t * RIPPLE_SPEED), gA, gR, tiles / TAU, uCoronaMap.z / coronaLen);
        corona = wave * wave * 1.6 * smoothstep(0.0, 0.12, cv) * pow(1.0 - cv, 1.3) * (0.55 + 0.9 * fl);
      } else {
        corona = polar(uCorona, vec2(cu + wob, mix(uCoronaMap.y, uCoronaMap.z, cv)), gA, gR, tiles / TAU, (uCoronaMap.z - uCoronaMap.y) / coronaLen);
        corona *= (0.45 + 1.0 * fl) * (1.0 - cv * 0.45);
      }
      coronaHeat = 1.0 - cv;
    }

    float sigil = 0.0;
    float pip = 0.0;
    float sigilGlow = 0.0;
    float pool = 0.0;
    if (r < INNER) {
      pool = (0.08 + 0.5 * web) * smoothstep(0.04, 0.3, r) * (1.0 - smoothstep(INNER - 0.1, INNER - 0.01, r));
      float dSig = abs(r - SIGIL_R);
      float along = abs(fract((a - t * SEAL_SPIN) / SIGIL_STEP + 0.5) - 0.5) * SIGIL_STEP * SIGIL_R;
      float aa = max(fwidth(r), 1e-5);
      float arc = stroke(dSig, SIGIL_W * uBold) * smoothstep(SIGIL_GAP, SIGIL_GAP + 0.015, along);
      pip = 1.0 - smoothstep(-aa, aa, along * 1.6 + dSig - SIGIL_PIP * uBold);
      sigil = max(arc, pip);
      sigilGlow = exp(-dSig * 45.0) * (1.0 - sigil);
    }
    float sealE = sigil * (1.6 + 0.6 * web) + pip * 1.4;
    float sealHalo = sigilGlow * 0.8;

    float dS = r - RING;
    float s = (behind < 0.5 ? behind : behind - 1.0) * SECTOR * RING;
    float head = max(exp(-behind * 12.0), exp(-ahead * 200.0));
    float headR = exp(-dS * dS / 0.0005);
    float tailW = 0.012 + 0.03 * behind;
    float tailR = exp(-dS * dS / (tailW * tailW));
    float streakHot = head * headR;
    float streakTail = exp(-behind * 1.9) * tailR * (0.65 + 0.6 * flow);
    float glint = stroke(abs(s), 0.0024) * exp(-abs(dS) / 0.035) + stroke(abs(dS), 0.0024) * exp(-abs(s) / 0.1);

    float dsh = r - uShockR;
    float shockCore = exp(-dsh * dsh / 0.00007);
    float shockWake = (1.0 - step(0.0, dsh)) * exp(dsh * 30.0) * 0.5;
    float shock = (shockCore + shockWake) * uShockA;

    float flash = 1.0 + 0.9 * uFlash;
    float picked = lit * drawn * flash;
    float runeLit = runes * (0.75 + 0.6 * flow) * (1.0 + 4.2 * ignite + 3.0 * pulse) + runeSoft * (1.0 - runes) * 0.04 * ignite;
    float energy = (ringE + ringGlow * 0.4 + ringBody * ignite * 1.6 + inCore * (0.8 + 2.0 * pulse) + inGlow * 0.14 + runeLit
                  + streakTail * 8.0 + streakHot * 9.0 + glint * 2.5 + corona * (0.35 + 5.5 * ignite)) * picked
                 + (sealE * (1.0 + 1.5 * pulse) + sealHalo * 0.6 + pool * (0.8 + 2.5 * pulse) + pulse * 0.16) * lit * flash
                 + shock * 3.0
                 + (ringBody * 0.45 + ringGlow * 0.15 + inCore * 0.25 + runes * 0.3) * idle;
    energy *= uExposure;
    float hot = (ringCore * 0.2 + streakHot * 3.0 + glint * 1.6 + runes * ignite * ignite * 0.8 + corona * coronaHeat * ignite * 0.6) * picked
              + edge * (ringCore + ringBody + inCore) * 2.2 * lit
              + shockCore * uShockA * 1.4
              + ringCore * uFlash * 0.4 * lit
              + pip * (0.08 + 0.3 * pulse) * lit;
    gl_FragColor = vec4(toneMap(uDeep, uColor, uHot, energy, hot), 1.0);
  }`

const CURTAIN_VS = `
  varying vec2 vUv;
  varying vec2 vXZ;
  varying float vFacing;
  void main() {
    vUv = uv;
    vXZ = position.xz;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec2 outward = normalize(world.xz - center.xz + 1e-5);
    vec2 toCam = normalize(cameraPosition.xz - center.xz + 1e-5);
    vFacing = dot(outward, toCam);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`

const CURTAIN_FS = `
  uniform vec3 uColor;
  uniform vec3 uDeep;
  uniform vec3 uHot;
  uniform float uExposure;
  uniform float uTime;
  uniform float uOn;
  uniform float uFlash;
  uniform float uReveal;
  uniform float uRiseSpeed;
  uniform sampler2D uRays;
  uniform sampler2D uFlick;
  varying vec2 vUv;
  varying vec2 vXZ;
  varying float vFacing;
  ${GLSL_CONSTANTS}
  ${SHARED_GLSL}
  const float RAY_TILES = 12.0;
  const float STRAND_TILES = 9.0;
  const float FRONT_KEEP = 0.16;
  void main() {
    float h = vUv.y;
    float t = uTime;
    float a = atan(-vXZ.y, vXZ.x);
    float behind = fract((a + t * STREAK_SPEED) / SECTOR);
    float ignite = exp(-behind * 4.5);
    float front = abs(wrapPi(a + PI * 0.5)) / PI;
    float drawn = 1.0 - smoothstep(uReveal - 0.05, uReveal, front);
    float reach = 0.58 + 0.42 * ignite;
    float hh = min(h / reach, 1.0);
    float fade = pow(1.0 - hh, 1.6);
    float rays = texture2D(uRays, vec2(vUv.x * RAY_TILES + t * 0.015, 0.975 - hh * 0.3)).r;
    float strands = texture2D(uFlick, vec2(vUv.x * STRAND_TILES, h * 0.42 - t * uRiseSpeed)).r;
    strands *= strands;
    float foot = exp(-h * 26.0);
    float side = mix(1.0, FRONT_KEEP, smoothstep(0.0, 0.85, vFacing));
    float body = (rays * 0.9 + strands * 1.5) * fade * (0.95 + 2.3 * ignite);
    float energy = (body + foot * (0.7 + 1.2 * ignite)) * side * drawn * uOn * (1.0 + 0.8 * uFlash);
    energy *= uExposure;
    float hot = (foot + strands * fade * 0.3) * ignite * 0.4 * side * uOn;
    gl_FragColor = vec4(toneMap(uDeep, uColor, uHot, energy, hot), 1.0);
  }`

const GLYPH_VS = `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRadius;
  uniform float uSize;
  uniform float uOn;
  uniform float uAge;
  varying vec2 vUv;
  varying float vLife;
  varying float vGlyph;
  const float GLYPH_LIFE = ${GLYPH_LIFE.toFixed(3)};
  const float GLYPH_RISE = ${GLYPH_RISE.toFixed(3)};
  const float GLYPH_DRIFT = ${GLYPH_DRIFT.toFixed(3)};
  void main() {
    float life = fract(uTime / GLYPH_LIFE * aSeed.w + aSeed.y);
    float born = step(life * GLYPH_LIFE / aSeed.w, uAge);
    float ang = aSeed.x + life * 0.35;
    float lift = (1.0 - (1.0 - life) * (1.0 - life)) * GLYPH_RISE * (0.75 + 0.25 * aSeed.w);
    float reach = uRadius + life * GLYPH_DRIFT;
    vec3 base = vec3(cos(ang) * reach, 0.04 + lift, -sin(ang) * reach);
    vec4 mv = modelViewMatrix * vec4(base, 1.0);
    float grow = smoothstep(0.0, 0.2, life) * (1.0 - 0.25 * life);
    mv.xy += position.xy * uSize * grow * uOn * born;
    vUv = uv;
    vLife = life;
    vGlyph = aSeed.z;
    gl_Position = projectionMatrix * mv;
  }`

const GLYPH_FS = `
  uniform vec3 uColor;
  uniform vec3 uDeep;
  uniform vec3 uHot;
  uniform float uExposure;
  uniform float uOn;
  uniform float uFlash;
  uniform sampler2D uRunes;
  varying vec2 vUv;
  varying float vLife;
  varying float vGlyph;
  ${GLSL_CONSTANTS}
  ${SHARED_GLSL}
  void main() {
    vec2 g = vec2((vGlyph + vUv.x) / 6.0, mix(RUNE_BOTTOM, RUNE_TOP, vUv.y));
    float m = texture(uRunes, g, -0.75).r;
    float aa = max(fwidth(m) * 0.6, 0.015);
    float shape = smoothstep(${RUNE_CUT.toFixed(3)} - aa, ${RUNE_CUT.toFixed(3)} + aa, m);
    float rim = smoothstep(0.22, ${RUNE_CUT.toFixed(3)}, m) * (1.0 - shape);
    float fade = smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.6, 1.0, vLife));
    float energy = (shape * 2.4 + rim * 0.1) * fade * uOn * (1.0 + 0.6 * uFlash) * uExposure;
    float hot = shape * fade * (1.0 - vLife) * 0.7 * uOn;
    if (shape * fade * uOn < 0.04) discard;
    gl_FragColor = vec4(toneMap(uDeep, uColor, uHot, energy, hot), 1.0);
  }`

const GROUND_FS = `
  uniform sampler2D uMap;
  uniform float uAlpha;
  uniform float uOn;
  uniform float uK;
  uniform float uSpan;
  uniform vec3 uShade;
  varying vec2 vUv;
  const float RING = ${RING.toFixed(4)};
  void main() {
    vec2 c = (vUv - 0.5) * uSpan + 0.5;
    float inside = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
    float contact = texture2D(uMap, clamp(c, 0.0, 1.0)).r * uAlpha * inside;
    float r = length(vUv * 2.0 - 1.0) / uK;
    float disc = (1.0 - smoothstep(0.55, 0.97, r)) * 0.28;
    float dr = (r - RING + 0.03) / 0.12;
    float band = exp(-dr * dr) * 0.34;
    float under = (1.0 - (1.0 - disc) * (1.0 - band)) * (0.4 + 0.6 * uOn);
    float a = 1.0 - (1.0 - contact) * (1.0 - under);
    gl_FragColor = vec4(uShade * under, a);
  }`

const curtainGeometries = new Map()

function curtainGeometry(THREE) {
  if (!curtainGeometries.has(THREE)) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, CURTAIN_SEGMENTS, 1, true)
    geometry.translate(0, 0.5, 0)
    curtainGeometries.set(THREE, geometry)
  }
  return curtainGeometries.get(THREE)
}

const glyphGeometries = new Map()

function glyphGeometry(THREE) {
  if (!glyphGeometries.has(THREE)) {
    const quad = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index
    geometry.setAttribute('position', quad.getAttribute('position'))
    geometry.setAttribute('uv', quad.getAttribute('uv'))
    const seeds = new Float32Array(GLYPH_COUNT * 4)
    for (let i = 0; i < GLYPH_COUNT; i++) {
      const spread = ((i * 0.618034) % 1) - 0.5
      seeds[i * 4] = Math.PI / 2 + spread * GLYPH_ARC
      seeds[i * 4 + 1] = (i * 0.381966) % 1
      seeds[i * 4 + 2] = i % 6
      seeds[i * 4 + 3] = 0.8 + ((i * 0.7548777) % 1) * 0.4
    }
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    geometry.instanceCount = GLYPH_COUNT
    glyphGeometries.set(THREE, geometry)
  }
  return glyphGeometries.get(THREE)
}

function easeOutBack(x) {
  const k = x - 1
  return 1 + (OVERSHOOT + 1) * k * k * k + OVERSHOOT * k * k
}

export function createStand(ctx) {
  const { THREE, stand, contact, color, hero, size, T, tiled, safeFragment, additive, floorGeo, FLOOR_VS } = ctx
  const look = LOOK[hero.element] ?? LOOK.fire
  const deep = new THREE.Color(...look.deep).lerp(color, 0.35)
  const hot = new THREE.Vector3(...look.hot)
  const uniforms = {
    uColor: { value: color },
    uDeep: { value: deep },
    uHot: { value: hot },
    uExposure: { value: look.exposure },
    uTime: { value: 0 },
    uOn: { value: 0 },
    uIdle: { value: 1 },
    uFlash: { value: 0 },
    uReveal: { value: REVEAL_END },
    uEdge: { value: 0 },
    uShockR: { value: SHOCK_FROM },
    uShockA: { value: 0 },
    uBold: { value: 1 },
    uCoronaMap: { value: new THREE.Vector3(...look.coronaMap) },
    uCoronaLen: { value: look.coronaLen },
    uWobble: { value: look.wobble },
    uRipple: { value: look.ripple },
    uRunes: { value: tiled(T('T_FX_TRO_Runes_1_1_6x1', false)) },
    uCorona: { value: tiled(T(look.corona, false)) },
    uCaustic: { value: tiled(T('T_FX_Noise_22_2', false)) },
    uWarp: { value: tiled(T('T_FX_Noise_57_1', false)) },
    uFlow: { value: tiled(T('T_FX_Noise_20_1', false)) },
  }
  const material = additive(FLOOR_VS, ARCANE_FS, uniforms)
  const mesh = new THREE.Mesh(floorGeo, material)
  mesh.scale.set(size, 1, size)
  mesh.renderOrder = 3
  stand.add(mesh)

  const curtainUniforms = {
    uColor: uniforms.uColor,
    uDeep: uniforms.uDeep,
    uHot: uniforms.uHot,
    uExposure: uniforms.uExposure,
    uTime: uniforms.uTime,
    uOn: { value: 0 },
    uFlash: uniforms.uFlash,
    uReveal: uniforms.uReveal,
    uRiseSpeed: { value: look.rise },
    uRays: { value: tiled(T('T_FX_Reveal_Flare_1', false)) },
    uFlick: { value: tiled(T('T_FX_Noise_2_1', false)) },
  }
  const curtainMaterial = additive(CURTAIN_VS, CURTAIN_FS, curtainUniforms, { side: THREE.DoubleSide })
  const curtain = new THREE.Mesh(curtainGeometry(THREE), curtainMaterial)
  curtain.renderOrder = 4
  curtain.position.y = CURTAIN_LIFT
  curtain.visible = false
  stand.add(curtain)

  const glyphUniforms = {
    uColor: uniforms.uColor,
    uDeep: uniforms.uDeep,
    uHot: uniforms.uHot,
    uExposure: uniforms.uExposure,
    uTime: uniforms.uTime,
    uOn: curtainUniforms.uOn,
    uFlash: uniforms.uFlash,
    uRunes: uniforms.uRunes,
    uRadius: { value: GLYPH_RADIUS * size / 2 },
    uSize: { value: GLYPH_SIZE },
    uAge: { value: 1e6 },
  }
  const glyphMaterial = additive(GLYPH_VS, GLYPH_FS, glyphUniforms, { depthWrite: true })
  const glyphs = new THREE.Mesh(glyphGeometry(THREE), glyphMaterial)
  glyphs.frustumCulled = false
  glyphs.renderOrder = 5
  glyphs.visible = false
  stand.add(glyphs)

  const original = contact.material
  const ground = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: original.uniforms.uMap.value },
      uAlpha: { value: original.uniforms.uAlpha.value },
      uOn: { value: 0 },
      uK: { value: 1 },
      uSpan: { value: size / CONTACT_SIZE },
      uShade: { value: color.clone().multiplyScalar(SHADE) },
    },
    vertexShader: FLOOR_VS,
    fragmentShader: safeFragment(GROUND_FS),
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
  })
  contact.material = ground
  contact.scale.set(size, 1, size)
  original.dispose()

  const gu = ground.uniforms
  const ringRadius = RING * size / 2
  return {
    update(state) {
      const w = state.w
      const k = IDLE_SCALE + (1 - IDLE_SCALE) * w
      mesh.scale.set(size * k, 1, size * k)
      uniforms.uTime.value = state.t
      uniforms.uOn.value = w
      uniforms.uIdle.value = state.idle
      uniforms.uFlash.value = state.flash
      const ft = state.flashT
      const x = ft < REVEAL_TIME ? ft / REVEAL_TIME : 1
      const eased = 1 - (1 - x) * (1 - x) * (1 - x)
      uniforms.uReveal.value = REVEAL_START + (REVEAL_END - REVEAL_START) * eased
      uniforms.uEdge.value = 1 - x
      const s = ft < SHOCK_TIME ? ft / SHOCK_TIME : 1
      const grow = 1 - (1 - s) * (1 - s) * (1 - s)
      uniforms.uShockR.value = SHOCK_FROM + (SHOCK_TO - SHOCK_FROM) * grow
      uniforms.uShockA.value = Math.pow(1 - s, 1.6) * w
      uniforms.uBold.value = 1 + BOLD_PORTRAIT * state.portrait
      const rise = state.picked ? easeOutBack(ft < CURTAIN_RISE_TIME ? ft / CURTAIN_RISE_TIME : 1) : 1
      curtain.visible = w > 0.001
      curtain.scale.set(ringRadius * k, CURTAIN_HEIGHT * Math.max(rise, 0.001) * w, ringRadius * k)
      curtainUniforms.uOn.value = w
      glyphs.visible = w > 0.001
      glyphUniforms.uAge.value = state.picked ? ft : 1e6
      gu.uOn.value = w
      gu.uK.value = k
    },
    dispose() {
      stand.remove(mesh, curtain, glyphs)
      material.dispose()
      curtainMaterial.dispose()
      glyphMaterial.dispose()
    },
  }
}
