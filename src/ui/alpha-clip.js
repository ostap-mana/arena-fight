const VERTEX = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = vec2(aPos.x, 1.0 - aPos.y);
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}
`

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTexture;
uniform vec2 uSlice;
uniform vec2 uPixel;
uniform float uFill;
uniform float uTaps;
varying vec2 vUV;

vec4 fetch(vec2 uv) {
  float v = uv.y / uFill;
  if (v > 1.0) return vec4(0.0);
  vec2 at = vec2(clamp(uv.x, 0.0, 1.0), uSlice.x + clamp(v, 0.0, 1.0) * uSlice.y);
  float a = texture2D(uTexture, at + vec2(0.0, 0.5)).r;
  return vec4(min(texture2D(uTexture, at).rgb, vec3(a)), a);
}

void main() {
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    if (float(j) >= uTaps) break;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uTaps) break;
      sum += fetch(vUV + ((vec2(float(i), float(j)) + 0.5) / uTaps - 0.5) * uPixel);
    }
  }
  gl_FragColor = sum / (uTaps * uTaps);
}
`

function videoElement(src) {
  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.autoplay = false
  video.loop = false
  video.playsInline = true
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'metadata'
  video.src = src
  return video
}

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
  return shader
}

export class AlphaClip {
  constructor(src, loopFrom = null, wide = 1, fill = 1) {
    this.wide = wide
    this.fill = fill
    this.canvas = document.createElement('canvas')
    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
    if (!this.gl) throw new Error('no webgl')
    this.video = videoElement(src)
    this.shown = -1
    this.fitted = ''
    this.priming = false
    this.loopFrom = loopFrom
    this.rolling = false
    this.video.addEventListener('ended', () => this.rewind())
    this.setup()
  }

  rewind() {
    if (!this.rolling || this.loopFrom === null) return
    const video = this.video
    try {
      video.currentTime = this.loopFrom
      const started = video.play()
      if (started) started.catch(() => {})
    } catch {}
  }

  dispose() {
    this.stop()
    this.canvas.remove()
    try {
      this.video.removeAttribute('src')
      this.video.load()
    } catch {}
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  get ready() {
    return this.video.readyState >= 2
  }

  setup() {
    const gl = this.gl
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.slice = gl.getUniformLocation(program, 'uSlice')
    this.pixel = gl.getUniformLocation(program, 'uPixel')
    this.taps = gl.getUniformLocation(program, 'uTaps')
    gl.uniform1f(gl.getUniformLocation(program, 'uFill'), this.fill)
    gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0)
    gl.clearColor(0, 0, 0, 0)
  }

  size(px) {
    const tall = Math.max(2, Math.round(px))
    const across = Math.max(2, Math.round(px * this.wide))
    if (this.canvas.width === across && this.canvas.height === tall) return
    this.canvas.width = across
    this.canvas.height = tall
    this.shown = -1
  }

  draw() {
    const gl = this.gl
    const video = this.video
    if (video.readyState < 2) return
    if (video.currentTime === this.shown) return
    this.shown = video.currentTime
    this.fit()

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  fit() {
    const { videoWidth: w, videoHeight: h } = this.video
    const { width, height } = this.canvas
    const shape = `${w}x${h}:${width}x${height}`
    if (!w || !h || shape === this.fitted) return
    this.fitted = shape
    const gl = this.gl
    gl.uniform2f(this.slice, 0.5 / h, (h / 2 - 1) / h)
    gl.uniform2f(this.pixel, 1 / width, 1 / height)
    const ratio = Math.max(w / width, h / 2 / (this.fill * height))
    gl.uniform1f(this.taps, Math.min(4, Math.max(1, Math.ceil(ratio - 0.05))))
  }

  prime() {
    if (this.ready) return
    const video = this.video
    this.priming = true
    try {
      const started = video.play()
      if (!started) return
      started.then(() => {
        if (!this.priming) return
        this.priming = false
        video.pause()
        video.currentTime = 0
      }).catch(() => {})
    } catch {}
  }

  play(refused) {
    this.priming = false
    this.rolling = true
    this.shown = -1
    const video = this.video
    const roll = () => {
      try {
        const started = video.play()
        if (started) started.catch(() => refused?.())
      } catch {
        refused?.()
      }
    }
    try {
      if (video.currentTime > 0.01) {
        video.addEventListener('seeked', roll, { once: true })
        video.currentTime = 0
      }
    } catch {}
    roll()
  }

  stop() {
    this.priming = false
    this.rolling = false
    try {
      this.video.pause()
    } catch {}
  }
}
