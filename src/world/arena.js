import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { DYN_LIGHTS, DYN_LIGHTS_GLSL } from './lights.js'
import { LOCATIONS, DEFAULT_LOCATION } from '../data/locations.js'
import { fetchBuffer, fetchJson } from '../core/fetch.js'

export const ARENA_RADIUS = 18.5

const LIGHTMAP_INTENSITY = 3.6
const ARENA_DIR = 'assets/locations/'
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

export function pickLocation() {
  const q = new URLSearchParams(location.search).get('loc')
  return LOCATIONS.includes(q) ? q : DEFAULT_LOCATION
}

export async function buildArena(scene, id = pickLocation()) {
  const group = new THREE.Group()
  group.name = `spire_${id}`
  scene.add(group)

  const index = await fetchJson(`${ARENA_DIR}index.json`)
  const meta = index[id]
  const gltf = await loader.parseAsync(await fetchBuffer(`${ARENA_DIR}${meta.file}`), ARENA_DIR)
  const parser = gltf.parser
  const lightmapIds = gltf.scene.userData.lightmaps || []
  const lightmaps = await Promise.all(lightmapIds.map(i => (i == null ? null : parser.getDependency('texture', i))))
  for (const t of lightmaps) {
    if (!t) continue
    t.colorSpace = THREE.SRGBColorSpace
    t.channel = 1
    t.flipY = false
    t.needsUpdate = true
  }

  const scrolling = []
  const materials = new Map()
  const ambient = ambientColor(meta)
  const makeMaterial = async (src, lightmap, mirrored) => {
    const key = `${src.uuid}|${lightmap ? lightmap.uuid : '-'}|${mirrored}`
    if (!materials.has(key)) materials.set(key, convertMaterial(src, lightmap, mirrored, parser, scrolling, ambient))
    return materials.get(key)
  }

  gltf.scene.updateMatrixWorld(true)
  const batches = new Map()
  gltf.scene.traverse(o => {
    if (!o.isMesh) return
    const info = o.userData.lightmap !== undefined ? o.userData : o.parent?.userData || {}
    const lm = info.lightmap ?? -1
    const mirrored = o.matrixWorld.determinant() < 0
    const key = `${o.geometry.uuid}|${o.material.uuid}|${lm}|${mirrored}`
    if (!batches.has(key)) batches.set(key, { geometry: o.geometry, material: o.material, lm, mirrored, items: [] })
    batches.get(key).items.push({ matrix: o.matrixWorld.clone(), st: info.lightmapST || [1, 1, 0, 0] })
  })

  for (const b of batches.values()) {
    const lightmap = b.lm >= 0 ? lightmaps[b.lm] : null
    const material = await makeMaterial(b.material, lightmap, b.mirrored)
    const geometry = shareGeometry(b.geometry)
    const st = new Float32Array(b.items.length * 4)
    b.items.forEach((it, i) => st.set(it.st, i * 4))
    geometry.setAttribute('lmST', new THREE.InstancedBufferAttribute(st, 4))
    const mesh = new THREE.InstancedMesh(geometry, material, b.items.length)
    b.items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.matrixAutoUpdate = false
    mesh.receiveShadow = false
    mesh.castShadow = false
    group.add(mesh)
  }

  const floorY = meta.floorY ?? measureFloor(group)
  group.position.y = -floorY
  group.updateMatrixWorld(true)

  const shadowCatcher = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS + 3, 64),
    new THREE.ShadowMaterial({
      opacity: 0.42,
      depthWrite: false,
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
  )
  shadowCatcher.rotation.x = -Math.PI / 2
  shadowCatcher.position.y = floorY + 0.05
  shadowCatcher.receiveShadow = true
  shadowCatcher.renderOrder = 1
  group.add(shadowCatcher)

  applyAtmosphere(scene, meta)

  return {
    id,
    group,
    meta,
    shadowCatcher,
    update(dt, t) {
      for (const s of scrolling) {
        s.texture.offset.x = (s.speed[0] * t) % 1
        s.texture.offset.y = (s.speed[1] * t) % 1
      }
    },
  }
}

function measureFloor(group) {
  group.updateMatrixWorld(true)
  const meshes = group.children.filter(o => o.isInstancedMesh)
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const origin = new THREE.Vector3()
  const heights = []
  for (const r of [0, 5, 10, 15]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r * 0.1
      origin.set(Math.cos(a) * r, 20, Math.sin(a) * r)
      ray.set(origin, down)
      const hit = ray.intersectObjects(meshes, false).find(h => h.point.y > -1.5 && h.point.y < 1.5)
      if (hit) heights.push(hit.point.y)
    }
  }
  if (!heights.length) return 0
  heights.sort((a, b) => a - b)
  return heights[heights.length >> 1]
}

function shareGeometry(src) {
  const g = new THREE.BufferGeometry()
  for (const name in src.attributes) g.setAttribute(name, src.attributes[name])
  g.setIndex(src.index)
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex)
  g.boundingBox = src.boundingBox
  g.boundingSphere = src.boundingSphere
  return g
}

function ambientColor(meta) {
  const r = meta.render || {}
  const sky = new THREE.Color().setRGB(...(r.ambientSky || [0.6, 0.6, 0.6]), THREE.SRGBColorSpace)
  const eq = new THREE.Color().setRGB(...(r.ambientEquator || [0.5, 0.5, 0.5]), THREE.SRGBColorSpace)
  return sky.lerp(eq, 0.5)
}

function applyAtmosphere(scene, meta) {
  const r = meta.render || {}
  const fog = new THREE.Color().setRGB(...(r.fogColor || [0.05, 0.06, 0.1]), THREE.SRGBColorSpace)
  const dark = fog.clone().multiplyScalar(0.35)
  scene.fog = new THREE.FogExp2(dark, 0.006)
  scene.background = dark
}

function patchLightmapUv(material) {
  const dynamic = !material.userData.noDynLight
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 lmST;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_LIGHTMAP\n\tvLightMapUv = uv1 * lmST.xy + lmST.zw;\n#endif')
    if (dynamic) patchDynamicLights(shader)
    if (material.userData.terrain) patchTerrain(shader, material.userData.terrain)
  }
  material.customProgramCacheKey = () => (material.userData.terrain ? 'spire-terrain' : 'spire-lm') + (dynamic ? '-dyn' : '')
}

function patchDynamicLights(shader) {
  Object.assign(shader.uniforms, DYN_LIGHTS)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDynWorld;\nvarying vec3 vDynNormal;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
	vec4 dynWorld = vec4( transformed, 1.0 );
	vec3 dynNormal = normal;
	#ifdef USE_INSTANCING
		dynWorld = instanceMatrix * dynWorld;
		dynNormal = mat3( instanceMatrix ) * dynNormal;
	#endif
	vDynWorld = ( modelMatrix * dynWorld ).xyz;
	vDynNormal = mat3( modelMatrix ) * dynNormal;`
    )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDynWorld;\nvarying vec3 vDynNormal;\n' + DYN_LIGHTS_GLSL)
    .replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * dynLight( vDynWorld, normalize( vDynNormal ) );\n#include <opaque_fragment>')
}

function patchTerrain(shader, t) {
  Object.assign(shader.uniforms, {
    uMask: { value: t.mask },
    uRed: { value: t.red },
    uGreen: { value: t.green },
    uBaseTint: { value: new THREE.Color(...t.baseTint) },
    uBaseTint2: { value: new THREE.Color(...t.baseTint2) },
    uRedTint: { value: new THREE.Color(...t.redTint) },
    uGreenTint: { value: new THREE.Color(...t.greenTint) },
    uTiling: { value: t.tiling },
    uBlend: { value: t.blend },
  })
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform sampler2D uMask;
uniform sampler2D uRed;
uniform sampler2D uGreen;
uniform vec3 uBaseTint;
uniform vec3 uBaseTint2;
uniform vec3 uRedTint;
uniform vec3 uGreenTint;
uniform float uTiling;
uniform float uBlend;`
    )
    .replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
	vec2 layerUv = vMapUv * uTiling;
	vec4 layerMask = texture2D( uMask, vMapUv );
	vec3 layerColor = texture2D( map, layerUv ).rgb * mix( uBaseTint, uBaseTint2, layerMask.b );
	layerColor = mix( layerColor, texture2D( uRed, layerUv ).rgb * uRedTint, clamp( layerMask.r * uBlend, 0.0, 1.0 ) );
	layerColor = mix( layerColor, texture2D( uGreen, layerUv ).rgb * uGreenTint, clamp( layerMask.g * uBlend, 0.0, 1.0 ) );
	diffuseColor.rgb *= layerColor;
#endif`
    )
}

async function convertMaterial(src, lightmap, mirrored, parser, scrolling, ambient) {
  const extras = src.userData || {}
  const kind = extras.kind || 'lit'
  const side = src.side === THREE.DoubleSide ? THREE.DoubleSide : mirrored ? THREE.BackSide : THREE.FrontSide
  const common = {
    map: src.map,
    color: src.color.clone(),
    side,
    alphaTest: src.alphaTest,
    transparent: src.transparent,
    opacity: src.opacity,
    depthWrite: src.depthWrite,
  }

  let m
  if (kind === 'lava') {
    const map = src.map ? src.map.clone() : null
    if (map) {
      map.repeat.set(extras.repeat || 1, extras.repeat || 1)
      scrolling.push({ texture: map, speed: extras.speed || [0.004, 0.012] })
    }
    m = new THREE.MeshBasicMaterial({ map, side })
  } else if (kind === 'waterfall') {
    const map = src.map ? src.map.clone() : null
    m = new THREE.MeshBasicMaterial({ ...common, map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    if (map) scrolling.push({ texture: map, speed: extras.speed || [0, -0.5] })
  } else if (kind === 'water') {
    m = new THREE.MeshLambertMaterial({ color: src.color.clone(), transparent: true, opacity: src.opacity, depthWrite: false, side })
  } else if (kind === 'decal') {
    m = new THREE.MeshBasicMaterial({
      ...common,
      transparent: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  } else if (kind === 'unlit' || lightmap) {
    m = new THREE.MeshBasicMaterial(common)
  } else {
    m = new THREE.MeshBasicMaterial(common)
    m.color.multiply(ambient)
  }

  if (kind === 'terrain') {
    const tex = async i => {
      if (i == null) return null
      const t = await parser.getDependency('texture', i)
      return t
    }
    const [mask, red, green] = await Promise.all([tex(extras.mask), tex(extras.red), tex(extras.green)])
    if (mask) mask.colorSpace = THREE.NoColorSpace
    for (const t of [red, green]) if (t) t.colorSpace = THREE.SRGBColorSpace
    m.color.setRGB(1, 1, 1)
    if (!lightmap) m.color.multiply(ambient)
    m.userData.terrain = {
      mask,
      red: red || src.map,
      green: green || src.map,
      baseTint: extras.baseTint,
      baseTint2: extras.baseTint2,
      redTint: extras.redTint,
      greenTint: extras.greenTint,
      tiling: extras.tiling * 4,
      blend: Math.min(extras.blend, 3),
    }
  }

  if (kind === 'lava' || kind === 'waterfall' || kind === 'water' || kind === 'decal') m.userData.noDynLight = true
  if (lightmap && kind !== 'lava' && kind !== 'waterfall' && kind !== 'water' && kind !== 'decal') {
    m.lightMap = lightmap
    m.lightMapIntensity = LIGHTMAP_INTENSITY
  }
  patchLightmapUv(m)
  m.name = src.name
  return m
}
