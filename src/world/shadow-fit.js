import * as THREE from 'three'

export const SHADOW_MAP_SIZE = { high: 1024, low: 512 }

const NDC_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
const BOX_STEP = 2
const MIN_HALF = 4
const REACH = 0.6
const _basis = new THREE.Matrix4()
const _eye = new THREE.Vector3()
const _aim = new THREE.Vector3()
const _p = new THREE.Vector3()
const _ray = new THREE.Vector3()
const _view = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
const _cast = { minX: 0, maxX: 0, minY: 0, maxY: 0 }

function clear(b) {
  b.minX = b.minY = Infinity
  b.maxX = b.maxY = -Infinity
}

function grow(b, p, pad = 0) {
  b.minX = Math.min(b.minX, p.x - pad)
  b.maxX = Math.max(b.maxX, p.x + pad)
  b.minY = Math.min(b.minY, p.y - pad)
  b.maxY = Math.max(b.maxY, p.y + pad)
}

function floorPoint(camera, x, y, floorY, reach, out) {
  out.set(x, y, 0.5).unproject(camera)
  _ray.subVectors(out, camera.position)
  const flat = Math.hypot(_ray.x, _ray.z) || 1e-6
  let t = reach / flat
  if (_ray.y < 0) t = Math.min(t, (camera.position.y - floorY) / -_ray.y)
  return out.copy(camera.position).addScaledVector(_ray, t).setY(floorY)
}

function castersBounds(casters, floorY) {
  clear(_cast)
  for (const a of casters) {
    if (!a || !a.root || !a.root.parent || !a.root.visible) continue
    const pad = a.radius + a.height * REACH
    _p.set(a.pos.x, floorY + a.pos.y, a.pos.z).applyMatrix4(_basis)
    grow(_cast, _p, pad)
    _p.set(a.pos.x, floorY + a.pos.y + a.height, a.pos.z).applyMatrix4(_basis)
    grow(_cast, _p, pad)
  }
  return _cast.minX <= _cast.maxX
}

export function fitShadowToView(light, camera, floorY, limit, casters) {
  const c = light.shadow.camera
  light.updateMatrixWorld()
  light.target.updateMatrixWorld()
  _eye.setFromMatrixPosition(light.matrixWorld)
  _aim.setFromMatrixPosition(light.target.matrixWorld)
  _basis.lookAt(_eye, _aim, c.up).setPosition(_eye).invert()
  camera.updateMatrixWorld()
  clear(_view)
  for (const [x, y] of NDC_CORNERS) grow(_view, floorPoint(camera, x, y, floorY, limit * 2, _p).applyMatrix4(_basis))
  let minX = Math.max(_view.minX, -limit)
  let maxX = Math.min(_view.maxX, limit)
  let minY = Math.max(_view.minY, -limit)
  let maxY = Math.min(_view.maxY, limit)
  if (casters && castersBounds(casters, floorY)) {
    minX = Math.max(minX, _cast.minX)
    maxX = Math.min(maxX, _cast.maxX)
    minY = Math.max(minY, _cast.minY)
    maxY = Math.min(maxY, _cast.maxY)
  }
  if (minX >= maxX || minY >= maxY) {
    minX = minY = -MIN_HALF
    maxX = maxY = MIN_HALF
  }
  const span = Math.max(maxX - minX, maxY - minY) / 2
  const half = Math.min(limit, Math.max(MIN_HALF, Math.ceil(span / BOX_STEP) * BOX_STEP))
  const texel = (2 * half) / light.shadow.mapSize.x
  const cx = Math.round((minX + maxX) / 2 / texel) * texel
  const cy = Math.round((minY + maxY) / 2 / texel) * texel
  if (c.left === cx - half && c.right === cx + half && c.bottom === cy - half && c.top === cy + half) return
  c.left = cx - half
  c.right = cx + half
  c.bottom = cy - half
  c.top = cy + half
  c.updateProjectionMatrix()
}
