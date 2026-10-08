export function compileFor(renderer, scene, camera, target = null, targetScene = null) {
  const previous = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  try {
    return renderer.compileAsync(scene, camera, targetScene).catch(() => {})
  } finally {
    renderer.setRenderTarget(previous)
  }
}
