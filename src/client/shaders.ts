import type { Material, WebGLProgramParametersWithUniforms } from "three";

// Uniforms shared by every patched material so a season change is one write.
export const world = {
  uTime: { value: 0 },
  uSnow: { value: 0 },
  uAutumn: { value: 0 },
  uSummer: { value: 0 },
};

const glslNoise = /* glsl */ `
float gbHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float gbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = gbHash(i), b = gbHash(i + vec2(1.0, 0.0));
  float c = gbHash(i + vec2(0.0, 1.0)), d = gbHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gbFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * gbNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

const worldVertex = /* glsl */ `
vec4 gbWorld = vec4(transformed, 1.0);
vec3 gbNormal = objectNormal;
#ifdef USE_INSTANCING
  gbWorld = instanceMatrix * gbWorld;
  // Instances are T*R*S, so dividing by squared axis scales equals the inverse-transpose
  // (keeps normals right on non-uniformly scaled basalt columns) at a fraction of the cost.
  mat3 gbIm = mat3(instanceMatrix);
  gbNormal /= vec3(dot(gbIm[0], gbIm[0]), dot(gbIm[1], gbIm[1]), dot(gbIm[2], gbIm[2]));
  gbNormal = gbIm * gbNormal;
#endif
gbWorld = modelMatrix * gbWorld;
vWorldPos = gbWorld.xyz;
vWorldNormal = normalize(mat3(modelMatrix) * gbNormal);
`;

type Patch = {
  vertexHead?: string;
  vertex?: string;
  fragmentHead?: string;
  fragment?: string;
  uniforms?: Record<string, { value: unknown }>;
};

// Adds world position/normal, seasonal snow and optional custom colouring to a built-in material.
export function patch<T extends Material>(material: T, options: Patch = {}) {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, world, options.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\n" +
          (options.vertexHead ?? ""),
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n" + worldVertex + (options.vertex ?? ""),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform float uTime, uSnow, uAutumn, uSummer;
${glslNoise}
${options.fragmentHead ?? ""}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
${options.fragment ?? ""}
if (uSnow > 0.001) {
  float gbUp = smoothstep(0.5, 0.85, vWorldNormal.y);
  float gbDrift = 0.55 + 0.25 * gbNoise(vWorldPos.xz * 3.1) + 0.2 * smoothstep(0.35, 0.6, gbFbm(vWorldPos.xz * 0.35));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 1.0), uSnow * gbUp * gbDrift);
}`,
      );
  };
  const key =
    "gb:" +
    (options.vertexHead ?? "") +
    (options.vertex ?? "") +
    (options.fragmentHead ?? "") +
    (options.fragment ?? "");
  material.customProgramCacheKey = () => key;
  return material;
}
