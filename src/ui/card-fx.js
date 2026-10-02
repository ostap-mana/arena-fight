import { loadManifest } from '../world/flipbook.js'
import { stream } from '../core/rng.js'

const random = stream('lobby')

const BOOK = 'flame_tongue'
const CARD = [128, 171]
const PAD = { left: 44, right: 44, top: 78, bottom: 30 }
const BOX = [CARD[0] + PAD.left + PAD.right, CARD[1] + PAD.top + PAD.bottom]
const IGNITE_TIME = 0.45

const RAMPS = {
  legendary: [[0, 0x000000], [0.16, 0x3a0800], [0.38, 0xc23400], [0.6, 0xff7a1a], [0.8, 0xffc45a], [1, 0xfff6de]],
  epic: [[0, 0x000000], [0.18, 0x24063a], [0.4, 0x8a18c8], [0.62, 0xe03cf0], [0.82, 0xff9cf4], [1, 0xfff0ff]],
}
const RAMP_ROWS = Object.keys(RAMPS)
const RAMP_W = 256

const TOP_FLAMES = { count: 15, size: [34, 50], inset: 6 }
const SIDE_FLAMES = { count: 17, size: [18, 38], out: 3 }
const CORNER_FLAMES = { size: [40, 56] }

const VS = `
  attribute vec2 aCorner;
  attribute vec4 aBase;
  attribute vec4 aAnim;
  uniform vec2 uBox;
  uniform vec2 uPad;
  uniform vec2 uPivot;
  uniform float uAspect;
  uniform float uTime;
  uniform float uFrames;
  uniform float uIgnite;
  varying vec2 vCell;
  varying float vFrame;
  varying float vGain;
  varying float vFlip;
  void main() {
    float h = aBase.z * mix(0.35, 1.0, uIgnite);
    float w = aBase.z * uAspect;
    vec2 local = (aCorner - uPivot) * vec2(w, h);
    vec2 p = aBase.xy + vec2(local.x, -local.y) + uPad;
    vec2 clip = vec2(p.x / uBox.x * 2.0 - 1.0, 1.0 - p.y / uBox.y * 2.0);
    gl_Position = vec4(clip, 0.0, 1.0);
    vCell = aCorner + 0.5;
    vFrame = mod(aAnim.x * uFrames + uTime * aAnim.y, uFrames);
    vGain = aBase.w * uIgnite;
    vFlip = aAnim.z;
  }
`

const FS = `
  precision highp float;
  uniform sampler2D uMap;
  uniform sampler2D uRamp;
  uniform vec2 uGrid;
  uniform float uFrames;
  uniform float uRow;
  uniform float uHeat;
  varying vec2 vCell;
  varying float vFrame;
  varying float vGain;
  varying float vFlip;
  vec2 cellUv(float f, vec2 uv) {
    float c = mod(f, uGrid.x);
    float r = floor(f / uGrid.x);
    return vec2((c + uv.x) / uGrid.x, (r + 1.0 - uv.y) / uGrid.y);
  }
  void main() {
    vec2 uv = vec2(vFlip > 0.5 ? 1.0 - vCell.x : vCell.x, vCell.y);
    float f0 = floor(vFrame);
    float f1 = mod(f0 + 1.0, uFrames);
    vec4 c = mix(texture2D(uMap, cellUv(f0, uv)), texture2D(uMap, cellUv(f1, uv)), vFrame - f0);
    vec2 e = smoothstep(vec2(0.0), vec2(0.03), vCell) * smoothstep(vec2(1.0), vec2(0.97), vCell);
    float heat = clamp(c.r * uHeat, 0.0, 1.0);
    vec3 col = texture2D(uRamp, vec2(heat, uRow)).rgb * c.r * vGain * e.x * e.y;
    gl_FragColor = vec4(col, max(max(col.r, col.g), col.b));
  }
`

function hexRgb(h) {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255]
}

function rampPixels() {
  const data = new Uint8Array(RAMP_W * RAMP_ROWS.length * 4)
  RAMP_ROWS.forEach((name, row) => {
    const stops = RAMPS[name].map(([t, h]) => [t, hexRgb(h)])
    for (let x = 0; x < RAMP_W; x++) {
      const t = x / (RAMP_W - 1)
      let i = 0
      while (i < stops.length - 2 && t > stops[i + 1][0]) i++
      const [t0, c0] = stops[i]
      const [t1, c1] = stops[i + 1]
      const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-5, t1 - t0)))
      const o = (row * RAMP_W + x) * 4
      for (let j = 0; j < 3; j++) data[o + j] = Math.round(c0[j] + (c1[j] - c0[j]) * k)
      data[o + 3] = 255
    }
  })
  return data
}

const rand = (a, b) => a + random() * (b - a)

function flame(x, y, size, gain) {
  return { x, y, size, gain, phase: random(), rate: rand(0.85, 1.15), flip: random() < 0.5 ? 1 : 0 }
}

function layout() {
  const [w, h] = CARD
  const out = []
  for (let k = 0; k < SIDE_FLAMES.count; k++) {
    const t = (k + rand(-0.3, 0.3)) / (SIDE_FLAMES.count - 1)
    const y = h * (1 - t) - 4
    const size = SIDE_FLAMES.size[0] + (SIDE_FLAMES.size[1] - SIDE_FLAMES.size[0]) * t * rand(0.8, 1.1)
    const gain = 0.55 + 0.45 * t
    out.push(flame(-SIDE_FLAMES.out, y, size, gain))
    out.push(flame(w + SIDE_FLAMES.out, y, size * rand(0.9, 1.1), gain))
  }
  for (let k = 0; k < TOP_FLAMES.count; k++) {
    const t = (k + 0.5 + rand(-0.35, 0.35)) / TOP_FLAMES.count
    const middle = 1 - Math.abs(t * 2 - 1)
    const size = rand(...TOP_FLAMES.size) * (0.8 + 0.2 * middle)
    out.push(flame(t * w, TOP_FLAMES.inset, size, rand(0.8, 1)))
  }
  out.push(flame(4, 8, rand(...CORNER_FLAMES.size), 1))
  out.push(flame(w - 4, 8, rand(...CORNER_FLAMES.size), 1))
  return out.sort((a, b) => a.size - b.size)
}

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}

export class CardBorderFx {
  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'burn'
    this.time = 0
    this.ignite = 0
    this.slot = null
    this.row = 0
    this.def = null
    this.ready = false
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
    this.gl = gl
    if (!gl) return
    loadManifest().then(m => {
      const def = m[BOOK]
      if (def) this.load(def)
    })
  }

  load(def) {
    const gl = this.gl
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    this.u = {}
    for (const n of ['uBox', 'uPad', 'uPivot', 'uAspect', 'uTime', 'uFrames', 'uIgnite', 'uMap', 'uRamp', 'uGrid', 'uRow', 'uHeat']) this.u[n] = gl.getUniformLocation(prog, n)
    this.buildMesh(prog)
    gl.uniform2f(this.u.uBox, BOX[0], BOX[1])
    gl.uniform2f(this.u.uPad, PAD.left, PAD.top)
    const pivot = def.pivot || [0, -0.45]
    gl.uniform2f(this.u.uPivot, pivot[0], pivot[1])
    gl.uniform1f(this.u.uAspect, def.aspect || 0.6)
    gl.uniform1f(this.u.uFrames, def.frames)
    gl.uniform2f(this.u.uGrid, def.grid[0], def.grid[1])
    gl.uniform1f(this.u.uHeat, def.cardHeat || 1)
    this.fps = def.fps || 24
    this.def = def

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, RAMP_W, RAMP_ROWS.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, rampPixels())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.uniform1i(this.u.uRamp, 1)

    const img = new Image()
    img.onload = () => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.uniform1i(this.u.uMap, 0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      this.ready = true
    }
    img.src = `assets/fx/eg/${def.file}.webp`
  }

  buildMesh(prog) {
    const gl = this.gl
    const flames = layout()
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
    const data = new Float32Array(flames.length * 6 * 10)
    let o = 0
    for (const f of flames) {
      for (const [cx, cy] of corners) {
        data.set([cx, cy, f.x, f.y, f.size, f.gain, f.phase, f.rate, f.flip, 0], o)
        o += 10
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    const bind = (name, size, offset) => {
      const loc = gl.getAttribLocation(prog, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, offset * 4)
    }
    bind('aCorner', 2, 0)
    bind('aBase', 4, 2)
    bind('aAnim', 4, 6)
    this.count = flames.length * 6
  }

  attach(slot, rarity) {
    if (this.slot !== slot) this.ignite = 0
    this.slot = slot
    this.row = (Math.max(0, RAMP_ROWS.indexOf(rarity)) + 0.5) / RAMP_ROWS.length
    if (this.canvas.parentNode !== slot) slot.prepend(this.canvas)
  }

  tick(dt) {
    const gl = this.gl
    if (!gl || !this.ready || !this.slot || !this.canvas.isConnected) return
    this.time += dt
    this.ignite = Math.min(1, this.ignite + dt / IGNITE_TIME)
    const k = 1 - (1 - this.ignite) ** 3
    const dpr = Math.min(devicePixelRatio, 2)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.uniform1f(this.u.uTime, this.time * this.fps)
    gl.uniform1f(this.u.uIgnite, k)
    gl.uniform1f(this.u.uRow, this.row)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, this.count)
  }
}
