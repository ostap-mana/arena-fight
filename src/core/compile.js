export function compileFor(renderer, scene, camera, target = null) {
  const previous = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  try {
    return renderer.compileAsync(scene, camera).catch(() => {})
  } finally {
    renderer.setRenderTarget(previous)
  }
}
