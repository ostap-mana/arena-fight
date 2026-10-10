import * as THREE from 'three'

const OPAQUE_OUT = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );'
const OPAQUE_SAFE = 'gl_FragColor = vec4( clamp( outgoingLight, 0.0, 1.0 ), clamp( diffuseColor.a, 0.0, 1.0 ) );'

if (THREE.ShaderChunk.opaque_fragment.includes(OPAQUE_OUT)) {
  THREE.ShaderChunk.opaque_fragment = THREE.ShaderChunk.opaque_fragment.replace(OPAQUE_OUT, OPAQUE_SAFE)
}

export function safeFragment(source) {
  if (source.includes('mainUnclamped')) return source
  return `${source.replace(/void\s+main\s*\(\s*\)/, 'void mainUnclamped()')}
void main() {
  mainUnclamped();
  uvec4 bits = floatBitsToUint(gl_FragColor);
  bvec4 broken = bvec4(uvec4(equal(bits & uvec4(0x7f800000u), uvec4(0x7f800000u))) * uvec4(notEqual(bits & uvec4(0x007fffffu), uvec4(0u))));
  gl_FragColor = clamp(mix(gl_FragColor, vec4(0.0), broken), 0.0, 1.0);
}
`
}
