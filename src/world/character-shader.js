import * as THREE from 'three'
import { DYN_LIGHTS, DYN_LIGHTS_GLSL } from './lights.js'

const BASE = 'assets/glb/'
const texLoader = new THREE.TextureLoader()
const cubeLoader = new THREE.CubeTextureLoader()
const textures = new Map()
const cubes = new Map()
let lighting = null

export const CHARACTER_LIGHT = {
  uCharLightDir: { value: new THREE.Vector3(0.2198, 0.766, 0.604).normalize() },
  uCharLightColor: { value: new THREE.Color(1.8421, 1.8421, 1.8421) },
  uCharAmbient: { value: new THREE.Color(0.587, 0.587, 0.587) },
  uCharTime: { value: 0 },
  uShadowColor: { value: new THREE.Color(0.0442, 0.0215, 0.0144) },
  uShadowGround: { value: 0.02 },
}

export const LOBBY_LIGHT = {
  uLobbyLightDir: { value: new THREE.Vector3(-0.548, 0.601, 0.582).normalize() },
  uLobbyLightColor: { value: new THREE.Color(1.5, 1.5, 1.5) },
  uLobbyAmbient: { value: new THREE.Color(0.5156, 0.4020, 0.3564) },
  uLobbyReflection: { value: 0.9 },
  uLobbyRimDir: { value: new THREE.Vector3(0.62, 0.42, -0.66).normalize() },
  uLobbyRimColor: { value: new THREE.Color(0xb4c8ff).multiplyScalar(3.3) },
}

const LOBBY_LIGHT_FROM_CAMERA = new THREE.Vector3(-0.548, 0.601, 0.582).normalize()
const LOBBY_RIM_FROM_CAMERA = new THREE.Vector3(0.62, 0.42, -0.66).normalize()
const _viewQuat = new THREE.Quaternion()

export function setLobbyView(camera) {
  camera.updateMatrixWorld()
  camera.getWorldQuaternion(_viewQuat)
  LOBBY_LIGHT.uLobbyLightDir.value.copy(LOBBY_LIGHT_FROM_CAMERA).applyQuaternion(_viewQuat)
  LOBBY_LIGHT.uLobbyRimDir.value.copy(LOBBY_RIM_FROM_CAMERA).applyQuaternion(_viewQuat)
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
WHITE.needsUpdate = true
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
BLACK.needsUpdate = true
const GREY_CUBE = (() => {
  const data = new Uint8Array([90, 90, 96, 255])
  const faces = Array.from({ length: 6 }, () => {
    const t = new THREE.DataTexture(data, 1, 1)
    t.needsUpdate = true
    return t.image
  })
  const cube = new THREE.CubeTexture(faces)
  cube.needsUpdate = true
  return cube
})()

export async function loadCharacterLighting(location) {
  if (!lighting) {
    lighting = fetch('assets/locations/lighting.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
  }
  const all = await lighting
  const l = all[location] || all.fire
  if (!l) return
  CHARACTER_LIGHT.uCharLightDir.value.set(l.lightDir[0], l.lightDir[1], l.lightDir[2]).normalize()
  CHARACTER_LIGHT.uCharLightColor.value.setRGB(l.lightColor[0], l.lightColor[1], l.lightColor[2])
  CHARACTER_LIGHT.uCharAmbient.value.setRGB(l.ambient[0], l.ambient[1], l.ambient[2])
  CHARACTER_LIGHT.uShadowColor.value.setRGB(l.shadowColor[0], l.shadowColor[1], l.shadowColor[2])
}

export function tickCharacters(dt) {
  CHARACTER_LIGHT.uCharTime.value += dt
}

function mask(entry, wrap = THREE.RepeatWrapping) {
  if (!entry || !entry.file) return null
  if (!textures.has(entry.file)) {
    const t = texLoader.load(BASE + entry.file)
    t.colorSpace = entry.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.wrapS = t.wrapT = wrap
    t.flipY = false
    textures.set(entry.file, t)
  }
  return textures.get(entry.file)
}

function cube(entry) {
  if (!entry || !entry.faces) return GREY_CUBE
  const key = entry.faces.join('|')
  if (!cubes.has(key)) {
    const c = cubeLoader.load(entry.faces.map(f => BASE + f))
    c.colorSpace = entry.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    c.generateMipmaps = true
    c.minFilter = THREE.LinearMipmapLinearFilter
    cubes.set(key, c)
  }
  return cubes.get(key)
}

function vec4(v, fallback) {
  const a = v || fallback
  return new THREE.Vector4(a[0], a[1], a[2], a[3] === undefined ? 1 : a[3])
}

const FRAGMENT_PARS = `
  uniform sampler2D uMse;
  uniform sampler2D uVfxMask;
  uniform sampler2D uNoise;
  uniform samplerCube uCube;
  uniform vec3 uCharLightDir;
  uniform vec3 uCharLightColor;
  uniform vec3 uCharAmbient;
  uniform float uCharTime;
  uniform vec3 uEmissiveColor;
  uniform float uReflectivity;
  uniform float uSmoothness;
  uniform float uVfxOn;
  uniform float uHitRimPower;
  uniform vec4 uHitRimColor;
  uniform vec4 uRimColor;
  uniform vec4 uNoiseColor;
  uniform vec4 uVfxParams;
  uniform vec4 uNoiseParams;
  ${DYN_LIGHTS_GLSL}
  vec3 characterShade(vec3 albedo, vec3 nView, vec2 uv) {
    vec3 N = normalize(inverseTransformDirection(nView, viewMatrix));
    vec3 V = normalize(inverseTransformDirection(normalize(vViewPosition), viewMatrix));
    vec4 mse = texture2D(uMse, uv);
    float metallic = mse.r;
    float smoothness = mse.g * uSmoothness;
    float oneMinusRefl = 0.96 - metallic * 0.96;
    vec3 diffuse = albedo * oneMinusRefl;
    vec3 specColor = mix(vec3(0.04), albedo, metallic);
    float pr = 1.0 - smoothness;
    float r = max(pr * pr, 0.0078125);
    float r2 = r * r;
    float grazing = clamp(smoothness + 1.0 - oneMinusRefl, 0.0, 1.0);
    vec3 L = normalize(uCharLightDir);
    float NdotL = clamp(dot(N, L), 0.0, 1.0);
    vec3 H = normalize(V + L);
    float NdotH = clamp(dot(N, H), 0.0, 1.0);
    float LdotH = clamp(dot(L, H), 0.0, 1.0);
    float d = NdotH * NdotH * (r2 - 1.0) + 1.00001;
    float specTerm = r2 / ((d * d) * max(LdotH * LdotH, 0.1) * (r * 4.0 + 2.0));
    vec3 brdf = specColor * specTerm + diffuse;
    float NdotV = dot(N, V);
    vec3 R = reflect(-V, N);
    float fres = pow(1.0 - clamp(NdotV, 0.0, 1.0), 4.0);
    float mip = pr * (1.7 - 0.7 * pr) * 6.0;
    vec3 env = textureLod(uCube, vec3(R.x, R.y, -R.z), mip).rgb * uReflectivity;
    vec3 envSpec = (1.0 / (r2 + 1.0)) * mix(specColor, vec3(grazing), fres) * env;
    vec3 col = uCharAmbient * diffuse + envSpec + brdf * NdotL * uCharLightColor;
    vec3 dynWorld = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
    vec3 dyn = dynLight(dynWorld, N);
    col += dyn * (diffuse + specColor) + dyn * pow(1.0 - clamp(NdotV, 0.0, 1.0), 3.0) * 0.8;
    vec3 vfx = vec3(0.0);
    if (uVfxOn > 0.5) {
      vec3 m = texture2D(uVfxMask, uv).rgb;
      float nz = texture2D(uNoise, uv * uNoiseParams.xy + uCharTime * uNoiseParams.zw).r;
      float rimA = clamp(1.0 - NdotV * uVfxParams.x, 0.0, 1.0);
      float rimB = clamp(1.0 - NdotV * uHitRimPower, 0.0, 1.0);
      float hit = clamp(m.r * rimB * uVfxParams.w, 0.0, 1.0);
      float rim = clamp(m.b * rimA * uVfxParams.y * (1.0 - hit), 0.0, 1.0);
      vfx = hit * uHitRimColor.rgb + rim * uRimColor.rgb + m.g * nz * uNoiseColor.rgb;
    }
    col = mix(col, albedo * uEmissiveColor, mse.b);
    return col + vfx;
  }
`

export function characterMaterial(source, extras) {
  if (extras.shader === 'SH_CharacterLobby') return lobbyMaterial(source, extras)
  if (extras.shader === 'SH_HairSpecularStrand') return hairMaterial(source, extras)
  const m = new THREE.MeshStandardMaterial({
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale ? source.normalScale.clone() : new THREE.Vector2(1, 1),
    side: source.side,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    roughness: 1,
    metalness: 0,
  })
  m.name = source.name
  m.userData = { ...source.userData }
  const uniforms = {
    uMse: { value: mask(extras.MSE_SkinMask) || BLACK },
    uVfxMask: { value: mask(extras.VFX_Mask) || BLACK },
    uNoise: { value: mask(extras.NoiseTex) || BLACK },
    uCube: { value: cube(extras.ReflectionCube) },
    uEmissiveColor: { value: new THREE.Vector3(...(extras.EmissiveColor || [1, 1, 1]).slice(0, 3)) },
    uReflectivity: { value: extras.Reflectivity ?? 1 },
    uSmoothness: { value: extras.Smoothness ?? 1 },
    uVfxOn: { value: extras.CharacterInGameVfxRimAndNoise ?? 0 },
    uHitRimPower: { value: extras.HitRimPower ?? 1 },
    uHitRimColor: { value: vec4(extras.HitRimColor, [1, 1, 1, 1]) },
    uRimColor: { value: vec4(extras.RimColor, [0, 0, 0, 1]) },
    uNoiseColor: { value: vec4(extras.NoiseColor, [0, 0, 0, 1]) },
    uVfxParams: { value: vec4(extras.vfxEmissionParams, [1, 1, 0, 0]) },
    uNoiseParams: { value: vec4(extras.NoiseParams, [1, 1, 0, 0]) },
  }
  m.userData.character = uniforms
  m.userData.hitRim = !!(extras.VFX_Mask && extras.CharacterInGameVfxRimAndNoise > 0)
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, DYN_LIGHTS, {
      uCharLightDir: CHARACTER_LIGHT.uCharLightDir,
      uCharLightColor: CHARACTER_LIGHT.uCharLightColor,
      uCharAmbient: CHARACTER_LIGHT.uCharAmbient,
      uCharTime: CHARACTER_LIGHT.uCharTime,
    })
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAGMENT_PARS)
      .replace('#include <lights_fragment_begin>', '')
      .replace('#include <lights_fragment_maps>', '')
      .replace('#include <lights_fragment_end>', '')
      .replace('#include <aomap_fragment>', '')
      .replace('vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;', '')
      .replace('vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;', '')
      .replace('#include <transmission_fragment>', '')
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        'vec3 outgoingLight = characterShade(diffuseColor.rgb, normal, vMapUv) + totalEmissiveRadiance;',
      )
  }
  m.customProgramCacheKey = () => 'invokers-character'
  return m
}

const LOBBY_PARS = `
  uniform sampler2D uMse;
  uniform sampler2D uGradient;
  uniform sampler2D uVfxMask;
  uniform sampler2D uNoise;
  uniform samplerCube uCube;
  uniform vec3 uLobbyLightDir;
  uniform vec3 uLobbyLightColor;
  uniform vec3 uLobbyAmbient;
  uniform float uLobbyReflection;
  uniform float uCharTime;
  uniform vec3 uEmissiveColor;
  uniform vec3 uSkinAmbient;
  uniform float uSmoothness;
  uniform float uSkinToggle;
  uniform float uEmissionToggle;
  uniform float uRimNoise;
  uniform float uAnimateEmission;
  uniform vec4 uEmissionAnim;
  uniform vec4 uRimColor;
  uniform vec4 uNoiseColor;
  uniform vec4 uVfxParams;
  uniform vec4 uNoiseParams;
  uniform vec3 uLobbyRimDir;
  uniform vec3 uLobbyRimColor;
  vec2 unityUv(vec2 uv) { return vec2(uv.x, 1.0 - uv.y); }
  vec3 lobbyRim(vec3 N, float NdotV, float ao) {
    float edge = smoothstep(0.35, 0.95, 1.0 - NdotV);
    float facing = clamp(dot(N, normalize(uLobbyRimDir)), 0.0, 1.0);
    return uLobbyRimColor * (edge * facing * ao);
  }
  vec3 lobbyShade(vec3 albedo, float ao, vec3 nView, vec2 uv, float shadow) {
    vec3 N = normalize(inverseTransformDirection(nView, viewMatrix));
    vec3 V = normalize(inverseTransformDirection(normalize(vViewPosition), viewMatrix));
    vec3 L = normalize(uLobbyLightDir);
    vec4 mse = texture2D(uMse, uv);
    float metallic = mse.r;
    float skin = mse.a * uSkinToggle;
    float emission = mse.b * uEmissionToggle;
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, 4.0);
    float NdotL = clamp(dot(N, L), 0.0, 1.0) * shadow;
    vec3 gradient = texture2D(uGradient, vec2(NdotL, 1.0)).rgb;
    float oneMinusReflectivity = 0.96 - metallic * 0.96;
    vec3 diffuseLight = gradient * uLobbyLightColor * skin + uLobbyLightColor * ((1.0 - skin) * oneMinusReflectivity * NdotL);
    float specularAA = 1.0 - min(max(abs(dFdx(NdotV)), abs(dFdy(NdotV))) * 3.0, 1.0);
    float smoothness = mse.g * uSmoothness * specularAA;
    float grazing = clamp(smoothness - oneMinusReflectivity + 1.0, 0.0, 1.0);
    vec3 diffuse = albedo * oneMinusReflectivity;
    vec3 specColor = mix(vec3(0.04), albedo, metallic);
    float pr = 1.0 - smoothness;
    float r = max(pr * pr, 0.0078125);
    float r2 = r * r;
    vec3 H = normalize(V + L);
    float NdotH = clamp(dot(N, H), 0.0, 1.0);
    float LdotH = clamp(dot(L, H), 0.0, 1.0);
    float d = NdotH * NdotH * (r2 - 1.0) + 1.00001;
    float specTerm = r2 / ((d * d) * max(LdotH * LdotH, 0.1) * (r * 4.0 + 2.0));
    vec3 direct = (diffuseLight * albedo + specTerm * specColor) * (NdotL * uLobbyLightColor);
    vec3 R = reflect(-V, N);
    float mip = pr * (1.7 - 0.7 * pr) * 6.0;
    vec3 env = textureLod(uCube, vec3(R.x, R.y, -R.z), mip).rgb * uLobbyReflection * ao;
    vec3 envSpec = env * mix(specColor, vec3(grazing), fresnel) / (r2 + 1.0);
    vec3 ambient = mix(uLobbyAmbient, uSkinAmbient, skin);
    vec3 col = (ambient * diffuse + envSpec) * ao + direct + lobbyRim(N, NdotV, ao);
    if (uRimNoise < 0.5) return col + albedo * emission;
    vec3 m = texture2D(uVfxMask, uv).rgb;
    vec2 noiseUv = unityUv(uv) * uNoiseParams.xy + uCharTime * uNoiseParams.zw;
    float noise = texture2D(uNoise, unityUv(noiseUv)).r;
    float rim = clamp(1.0 + uVfxParams.z - (NdotV - uVfxParams.z) * uVfxParams.x, 0.0, 1.0);
    rim = rim * rim;
    rim = rim * rim;
    vec3 vfx = rim * uRimColor.rgb * m.r + noise * uNoiseColor.rgb * m.g * uEmissionToggle;
    float pulse = uAnimateEmission > 0.5 ? cos(uCharTime * uEmissionAnim.x) * uEmissionAnim.y + uEmissionAnim.z : 1.0;
    return col + albedo * uEmissiveColor * pulse * emission + vfx;
  }
`

const HAIR_PARS = `
  uniform sampler2D uAose;
  uniform sampler2D uStrand;
  uniform samplerCube uCube;
  uniform vec3 uLobbyLightDir;
  uniform vec3 uLobbyAmbient;
  uniform float uLobbyReflection;
  uniform vec3 uSpec1;
  uniform vec3 uSpec2;
  uniform vec4 uSpecParams;
  uniform vec4 uTiling;
  uniform vec4 uHighlight;
  uniform vec3 uEmissiveColor;
  uniform vec3 uLobbyRimDir;
  uniform vec3 uLobbyRimColor;
  float strandLobe(vec3 T, vec3 H, float exponent) {
    float th = dot(T, H);
    return clamp(th + 1.0, 0.0, 1.0) * pow(max(1.0 - th * th, 1e-5), max(exponent, 1e-3));
  }
  vec3 hairShade(vec3 albedo, vec3 nView, vec3 nTangent, mat3 frame, vec2 uv, float shadow) {
    vec3 N = normalize(inverseTransformDirection(nView, viewMatrix));
    vec3 V = normalize(inverseTransformDirection(normalize(vViewPosition), viewMatrix));
    vec3 L = normalize(uLobbyLightDir);
    vec3 Hv = normalize(normalize(vViewPosition) + normalize((viewMatrix * vec4(L, 0.0)).xyz));
    vec3 H = normalize(vec3(dot(normalize(frame[0]), Hv), dot(normalize(frame[1]), Hv), dot(normalize(frame[2]), Hv)));
    vec2 strandUv = vec2(uv.x, 1.0 - uv.y) * uTiling.xy + uTiling.zw;
    float strand = texture2D(uStrand, vec2(strandUv.x, 1.0 - strandUv.y)).g - 0.5;
    vec4 aose = texture2D(uAose, uv);
    vec3 n = normalize(nTangent);
    vec3 along = normalize(vec3(0.0, n.z, -n.y));
    vec2 shift = uSpecParams.xy + uHighlight.y + strand;
    vec3 highlight = strandLobe(normalize(shift.x * n + along), H, uSpecParams.z * 90.0) * uSpec1
      + strandLobe(normalize(shift.y * n + along), H, uSpecParams.w * 90.0) * uSpec2;
    float NdotL = clamp(dot(N, L), 0.0, 1.0) * shadow;
    float smoothness = aose.g * uHighlight.x;
    float pr = 1.0 - smoothness;
    float r = max(pr * pr, 0.0078125);
    float grazing = clamp(smoothness + 0.04, 0.0, 1.0);
    float fresnel = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 4.0);
    vec3 R = reflect(-V, N);
    float mip = pr * (1.7 - 0.7 * pr) * 6.0;
    vec3 env = textureLod(uCube, vec3(R.x, R.y, -R.z), mip).rgb * uLobbyReflection * aose.r;
    vec3 indirect = uLobbyAmbient * albedo * 0.96 + env * (mix(0.04, grazing, fresnel) / (r * r + 1.0));
    vec3 direct = (highlight * aose.r * uHighlight.z + albedo) * NdotL;
    float edge = smoothstep(0.35, 0.95, 1.0 - clamp(dot(N, V), 0.0, 1.0));
    float facing = clamp(dot(N, normalize(uLobbyRimDir)), 0.0, 1.0);
    vec3 rim = uLobbyRimColor * (edge * facing * aose.r);
    return albedo * uEmissiveColor * aose.b + direct + indirect + rim;
  }
`

function lobbySurface(source) {
  const m = new THREE.MeshStandardMaterial({
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale ? source.normalScale.clone() : new THREE.Vector2(1, 1),
    side: source.side,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    roughness: 1,
    metalness: 0,
  })
  m.name = source.name
  m.userData = { ...source.userData }
  return m
}

const LOBBY_SHADOW = `
  float lobbyShadow() {
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow keyShadow = directionalLightShadows[ 0 ];
      return receiveShadow ? getShadow( directionalShadowMap[ 0 ], keyShadow.shadowMapSize, keyShadow.shadowIntensity, keyShadow.shadowBias, keyShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
    #else
      return 1.0;
    #endif
  }
`

function injectShade(shader, pars, shade) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + pars)
    .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + LOBBY_SHADOW)
    .replace('#include <lights_fragment_begin>', '')
    .replace('#include <lights_fragment_maps>', '')
    .replace('#include <lights_fragment_end>', '')
    .replace('#include <aomap_fragment>', '')
    .replace('vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;', '')
    .replace('vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;', '')
    .replace('#include <transmission_fragment>', '')
    .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `vec3 outgoingLight = ${shade} + totalEmissiveRadiance;`)
}

function lobbyMaterial(source, extras) {
  const m = lobbySurface(source)
  const kw = extras.keywords || []
  const uniforms = {
    uMse: { value: mask(extras.MSE_SkinMask) || BLACK },
    uGradient: { value: mask(extras.SkinGradientTex, THREE.ClampToEdgeWrapping) || WHITE },
    uVfxMask: { value: mask(extras.VFX_Mask) || BLACK },
    uNoise: { value: mask(extras.NoiseTex) || BLACK },
    uCube: { value: cube(extras.ReflectionCube) },
    uEmissiveColor: { value: new THREE.Vector3(...(extras.EmissiveColor || [1, 1, 1]).slice(0, 3)) },
    uSkinAmbient: { value: new THREE.Vector3(...(extras.S_AmbientColor || [0.5, 0.5, 0.5]).slice(0, 3)) },
    uSmoothness: { value: extras.Smoothness ?? 1 },
    uSkinToggle: { value: extras.SkinMaskUseToggle ?? 0 },
    uEmissionToggle: { value: extras.EmissionToggle ?? 1 },
    uRimNoise: { value: kw.includes('RIM_AND_NOISE') ? 1 : 0 },
    uAnimateEmission: { value: kw.includes('ANIMATE_EMISSION') ? 1 : 0 },
    uEmissionAnim: { value: vec4(extras.EmissionAnimParams, [1, 0, 1, 0]) },
    uRimColor: { value: vec4(extras.RimColor, [0, 0, 0, 1]) },
    uNoiseColor: { value: vec4(extras.NoiseColor, [0, 0, 0, 1]) },
    uVfxParams: { value: vec4(extras.vfxEmissionParams, [1, 1, 0, 0]) },
    uNoiseParams: { value: vec4(extras.NoiseParams, [1, 1, 0, 0]) },
  }
  m.userData.character = uniforms
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, LOBBY_LIGHT, { uCharTime: CHARACTER_LIGHT.uCharTime })
    injectShade(shader, LOBBY_PARS, m.map ? 'lobbyShade(diffuseColor.rgb, texture2D(map, vMapUv).a, normal, vMapUv, lobbyShadow())' : 'lobbyShade(diffuseColor.rgb, 1.0, normal, vec2(0.0), lobbyShadow())')
  }
  m.customProgramCacheKey = () => 'invokers-lobby'
  return m
}

function hairMaterial(source, extras) {
  const m = lobbySurface(source)
  const uniforms = {
    uAose: { value: mask(extras.AOSE_Mask) || WHITE },
    uStrand: { value: mask(extras.StrandMap) || BLACK },
    uCube: { value: cube(extras.ReflectionCube) },
    uSpec1: { value: new THREE.Vector3(...(extras.SpecularColor1 || [1, 1, 1]).slice(0, 3)) },
    uSpec2: { value: new THREE.Vector3(...(extras.SpecularColor2 || [1, 1, 1]).slice(0, 3)) },
    uSpecParams: { value: vec4(extras.SpecParams, [0, 0, 1, 1]) },
    uTiling: { value: vec4(extras.TilingOffset, [1, 1, 0, 0]) },
    uHighlight: { value: vec4(extras.HighlightParams, [0.5, 0, 0.5, 0]) },
    uEmissiveColor: { value: new THREE.Vector3(...(extras.EmissiveColor || [0, 0, 0]).slice(0, 3)) },
  }
  if (extras.Color) m.color.setRGB(extras.Color[0], extras.Color[1], extras.Color[2], THREE.LinearSRGBColorSpace)
  m.userData.character = uniforms
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, LOBBY_LIGHT)
    injectShade(shader, HAIR_PARS, m.normalMap ? 'hairShade(diffuseColor.rgb, normal, mapN, tbn, vMapUv, lobbyShadow())' : 'hairShade(diffuseColor.rgb, normal, vec3(0.0, 0.0, 1.0), mat3(1.0), vMapUv, lobbyShadow())')
  }
  m.customProgramCacheKey = () => 'invokers-hair'
  return m
}

const SHADOW_VS = `
  #include <common>
  #include <skinning_pars_vertex>
  uniform vec3 uCharLightDir;
  uniform float uShadowGround;
  void main() {
    #include <begin_vertex>
    #include <skinbase_vertex>
    #include <skinning_vertex>
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vec3 L = normalize(uCharLightDir);
    float t = (uShadowGround - wp.y) / max(L.y, 0.001);
    wp.xyz += L * t;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const SHADOW_FS = `
  uniform vec3 uShadowColor;
  void main() {
    gl_FragColor = vec4(uShadowColor, 1.0);
  }
`

let shadowMaterial = null

function projectedShadowMaterial() {
  if (!shadowMaterial) {
    shadowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCharLightDir: CHARACTER_LIGHT.uCharLightDir,
        uShadowGround: CHARACTER_LIGHT.uShadowGround,
        uShadowColor: CHARACTER_LIGHT.uShadowColor,
      },
      vertexShader: SHADOW_VS,
      fragmentShader: SHADOW_FS,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    shadowMaterial.name = 'ProjectiveShadow'
  }
  return shadowMaterial
}

export const SHADOW_MODE = { projected: true }

export function addProjectedShadow(model) {
  const shadows = []
  model.shadows = shadows
  if (!SHADOW_MODE.projected) return shadows
  for (const skin of model.skins) {
    if (skin.material && skin.material.userData && skin.material.userData.fx) continue
    const s = new THREE.SkinnedMesh(skin.geometry, projectedShadowMaterial())
    s.bind(skin.skeleton, skin.bindMatrix)
    s.bindMode = skin.bindMode
    s.frustumCulled = false
    s.renderOrder = 1
    s.castShadow = false
    s.receiveShadow = false
    s.name = skin.name + '_ProjectiveShadow'
    skin.parent.add(s)
    s.position.copy(skin.position)
    s.quaternion.copy(skin.quaternion)
    s.scale.copy(skin.scale)
    shadows.push(s)
  }
  model.shadows = shadows
  return shadows
}
