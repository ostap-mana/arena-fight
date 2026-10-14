const ROUND_GLOW_TEXTURE = /^T_FX_(Glow_(?!Sector|Star)|Circle_(7|8|10|11)_1$|Decal_2_1$|Liquid_5_1)/
const SHAPED_MESH = /Slash|Spiral|Cylinder|Blade|Weapon|Star|ELD0|LTS|Wave/
const BLOB_TEXTURE = /^T_FX_Liquid_/
const DISK_MESH = /Disk/

export const KEEP_GLOW_PREFAB = /^FX_Loot_Drop_(?!Trail)/

export function isGlowCircleSystem(materials, ps) {
  const r = ps.r
  const mat = r && materials[r.mat]
  const main = mat && mat.t && mat.t._MainTex
  if (!main) return false
  const meshes = r.meshes || []
  if (BLOB_TEXTURE.test(main[0]) && meshes.some(m => DISK_MESH.test(m))) return true
  if (!ROUND_GLOW_TEXTURE.test(main[0])) return false
  return r.mode !== 4 || !meshes.some(m => SHAPED_MESH.test(m))
}
