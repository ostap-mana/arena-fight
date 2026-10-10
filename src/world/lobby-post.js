import * as THREE from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'

const LUMA = `
  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }
`

const SHARPEN_FS = `
  uniform float uFocus;
  uniform float uAmount;
  uniform float uRange;
  uniform float uLimit;
  ${LUMA}
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    float inFocus = 1.0 - smoothstep(uRange * 0.5, uRange, abs(-getViewZ(depth) - uFocus));
    float around = luma(texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb)
      + luma(texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb)
      + luma(texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb)
      + luma(texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb);
    float detail = clamp(luma(inputColor.rgb) - around * 0.25, -uLimit, uLimit);
    outputColor = vec4(max(inputColor.rgb + detail * uAmount * inFocus, 0.0), inputColor.a);
  }
`

const GRADE_FS = `
  uniform float uMix;
  uniform float uFocus;
  uniform vec2 uBackRange;
  uniform float uBackDim;
  uniform float uBackDesat;
  uniform float uGlowGuard;
  uniform float uVibrance;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  ${LUMA}
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    float l = luma(c);
    float back = smoothstep(uFocus + uBackRange.x, uFocus + uBackRange.y, -getViewZ(depth));
    back *= 1.0 - smoothstep(uGlowGuard, uGlowGuard + 0.45, l);
    c = mix(c, vec3(l), back * uBackDesat);
    c *= 1.0 - back * (1.0 - uBackDim);

    float hi = max(c.r, max(c.g, c.b));
    float lo = min(c.r, min(c.g, c.b));
    float chroma = hi > 1e-4 ? (hi - lo) / hi : 0.0;
    l = luma(c);
    c = max(mix(vec3(l), c, 1.0 + uVibrance * (1.0 - chroma)), 0.0);

    float tone = smoothstep(0.0, 0.7, sqrt(max(l, 0.0)));
    c *= mix(uShadowTint, uHighlightTint, tone);
    outputColor = vec4(mix(inputColor.rgb, c, uMix), inputColor.a);
  }
`

const SANITIZE_FS = `
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    uvec4 bits = floatBitsToUint(inputColor);
    bvec4 broken = bvec4(uvec4(equal(bits & uvec4(0x7f800000u), uvec4(0x7f800000u))) * uvec4(notEqual(bits & uvec4(0x007fffffu), uvec4(0u))));
    outputColor = clamp(mix(inputColor, vec4(0.0, 0.0, 0.0, 1.0), broken), 0.0, 1.0);
  }
`

export class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', SANITIZE_FS, { blendFunction: BlendFunction.SRC })
  }
}

export class FocusSharpenEffect extends Effect {
  constructor({ amount = 0.8, range = 3, limit = 0.05 } = {}) {
    super('FocusSharpenEffect', SHARPEN_FS, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uFocus', new THREE.Uniform(9)],
        ['uAmount', new THREE.Uniform(amount)],
        ['uRange', new THREE.Uniform(range)],
        ['uLimit', new THREE.Uniform(limit)],
      ]),
    })
    this.baseAmount = amount
  }

  set focus(value) {
    this.uniforms.get('uFocus').value = value
  }

  set mix(value) {
    this.uniforms.get('uAmount').value = this.baseAmount * value
  }
}

export class LobbyGradeEffect extends Effect {
  constructor({
    backRange = [2.5, 14],
    backDim = 0.55,
    backDesat = 0.36,
    glowGuard = 0.32,
    vibrance = 0.3,
    shadowTint = [0.93, 0.97, 1.07],
    highlightTint = [1.03, 1, 0.96],
  } = {}) {
    super('LobbyGradeEffect', GRADE_FS, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uMix', new THREE.Uniform(1)],
        ['uFocus', new THREE.Uniform(9)],
        ['uBackRange', new THREE.Uniform(new THREE.Vector2(...backRange))],
        ['uBackDim', new THREE.Uniform(backDim)],
        ['uBackDesat', new THREE.Uniform(backDesat)],
        ['uGlowGuard', new THREE.Uniform(glowGuard)],
        ['uVibrance', new THREE.Uniform(vibrance)],
        ['uShadowTint', new THREE.Uniform(new THREE.Vector3(...shadowTint))],
        ['uHighlightTint', new THREE.Uniform(new THREE.Vector3(...highlightTint))],
      ]),
    })
  }

  set focus(value) {
    this.uniforms.get('uFocus').value = value
  }

  set mix(value) {
    this.uniforms.get('uMix').value = value
  }
}
