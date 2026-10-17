import * as THREE from "three";
import { world } from "./shaders.ts";
import { ISLAND_OFFSET, hexToWorld, worldToHex } from "./hex.ts";
import type { Side } from "./hex.ts";
import { BOUNDS, arenaWeight, landField } from "./terrain.ts";

/** A tile's fog of war: 0 is clear, 1 hidden; in between leaves a mist (the explorable border). */
export type FogCell = { side: Side; q: number; r: number; fog: number };

// Around each island, wild land within this distance of its hall is hidden;
// beyond it the storm clouds take over. The arena between the islands stays clear.
const FOG_RADIUS = [8, 11] as const;

const FOG = { w: 240, h: 116 };
const FOG_FADE_SECONDS = 0.9;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const SX = FOG.w / (BOUNDS.maxX - BOUNDS.minX);
const SZ = FOG.h / (BOUNDS.maxZ - BOUNDS.minZ);
const texelX = (i: number) => BOUNDS.minX + (i + 0.5) / SX;
const texelZ = (j: number) => BOUNDS.minZ + (j + 0.5) / SZ;

// Unexplored fog never changes: land near either hall is hidden, thinning down the cliffs and
// leaving the sea and the arena clear. Its noise is costly, so it is computed once.
let wildFog: Float32Array | null = null;
function wild() {
  if (wildFog) return wildFog;
  wildFog = new Float32Array(FOG.w * FOG.h);
  const [near, far] = FOG_RADIUS;
  for (const side of ["polis", "opponent"] as const) {
    const hall = hexToWorld(0, 0, side);
    for (let j = 0; j < FOG.h; j++)
      for (let i = 0; i < FOG.w; i++) {
        const x = texelX(i);
        const z = texelZ(j);
        const d = Math.hypot(x - hall.x, z - hall.z);
        if (d > far) continue;
        wildFog[j * FOG.w + i] =
          (1 - smoothstep(near, far, d)) *
          (1 - arena(x, z)) *
          smoothstep(-0.6, 0.8, landField(x, z));
      }
  }
  wildFog = boxBlur(boxBlur(wildFog, 1), 1);
  return wildFog;
}

// Four bytes per texel: the wild land's fog, each tile's own fog times its coverage, and that
// coverage. Tiles take their own fog over the wild land's (so a tile reaching into the arena is
// still hidden), and the battle lift clears only the wild land. Blurs soften the hex edges and
// the shader roughens them.
function paintFog(cells: readonly FogCell[], out: Uint8Array) {
  const fog = new Float32Array(FOG.w * FOG.h);
  const cover = new Float32Array(FOG.w * FOG.h);
  for (const side of ["polis", "opponent"] as const) {
    // Fog by axial hex, in a small grid around the hall (-1 = not a tile).
    const tileFog = new Float32Array(HEX_SPAN * HEX_SPAN).fill(-1);
    const hall = hexToWorld(0, 0, side);
    // Texels farther out than every tile (plus a hex) need no hex lookup.
    let reach = 0;
    for (const c of cells)
      if (c.side === side) {
        tileFog[hexIndex(c.q, c.r)] = c.fog;
        const p = hexToWorld(c.q, c.r, side);
        reach = Math.max(reach, Math.hypot(p.x - hall.x, p.z - hall.z) + 1.01);
      }
    if (!reach) continue;
    const i0 = Math.max(0, Math.floor((hall.x - reach - BOUNDS.minX) * SX));
    const i1 = Math.min(
      FOG.w - 1,
      Math.ceil((hall.x + reach - BOUNDS.minX) * SX),
    );
    const j0 = Math.max(0, Math.floor((hall.z - reach - BOUNDS.minZ) * SZ));
    const j1 = Math.min(
      FOG.h - 1,
      Math.ceil((hall.z + reach - BOUNDS.minZ) * SZ),
    );
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const { q, r } = worldToHex(texelX(i), texelZ(j), side);
        const index = hexIndex(q, r);
        if (index < 0 || tileFog[index]! < 0) continue;
        fog[j * FOG.w + i] = tileFog[index]!;
        cover[j * FOG.w + i] = 1;
      }
  }
  const tiles = boxBlur(boxBlur(fog, 1), 1);
  const covered = boxBlur(boxBlur(cover, 1), 1);
  const land = wild();
  const byte = (v: number) => Math.round(255 * Math.min(1, v));
  for (let k = 0; k < land.length; k++) {
    out[k * 4] = byte(land[k]!);
    out[k * 4 + 1] = byte(tiles[k]!);
    out[k * 4 + 2] = byte(covered[k]!);
    out[k * 4 + 3] = 255;
  }
}

// arenaWeight is zero well outside this box; skipping its noise there keeps a repaint cheap.
function arena(x: number, z: number) {
  return Math.abs(x) < 7.6 && Math.abs(z + 0.3) < 5.9 ? arenaWeight(x, z) : 0;
}

// Axial coordinates within FOG_RADIUS of a hall stay well inside ±HEX_REACH.
const HEX_REACH = 8;
const HEX_SPAN = 2 * HEX_REACH + 1;
function hexIndex(q: number, r: number) {
  return Math.abs(q) > HEX_REACH || Math.abs(r) > HEX_REACH
    ? -1
    : (q + HEX_REACH) * HEX_SPAN + r + HEX_REACH;
}

// A running-sum box blur along one axis (edges clamp): `stride` steps along a line of `length`
// texels, `step` from one line to the next. Its cost does not grow with the radius.
function blurPass(
  src: Float32Array,
  radius: number,
  lines: number,
  length: number,
  step: number,
  stride: number,
) {
  const dst = new Float32Array(src.length);
  const n = 2 * radius + 1;
  const last = length - 1;
  for (let line = 0; line < lines; line++) {
    const base = line * step;
    let sum = 0;
    for (let k = -radius; k <= radius; k++)
      sum += src[base + Math.min(last, Math.max(0, k)) * stride]!;
    for (let k = 0; k < length; k++) {
      dst[base + k * stride] = sum / n;
      sum +=
        src[base + Math.min(last, k + radius + 1) * stride]! -
        src[base + Math.max(0, k - radius) * stride]!;
    }
  }
  return dst;
}

function boxBlur(src: Float32Array, radius: number) {
  const rows = blurPass(src, radius, FOG.h, FOG.w, FOG.w, 1);
  return blurPass(rows, radius, FOG.w, FOG.h, 1, FOG.w);
}

function fogTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array(FOG.w * FOG.h * 4),
    FOG.w,
    FOG.h,
    THREE.RGBAFormat,
  );
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Storm clouds frame the playable land. `clear` is an ellipse (cx, cz, rx, rz) kept open; the
// fog of war also gathers the clouds over unexplored tiles inside it.
export function createClouds() {
  const clear = { value: new THREE.Vector4(-ISLAND_OFFSET, 0, 9, 7.5) };
  // The fog cross-fades from one mask to the next.
  const fogFrom = { value: fogTexture() };
  const fogTo = { value: fogTexture() };
  const fogMix = { value: 1 };
  // 1 while a battle is on: troops march between the halls, so the wild land's fog there lifts
  // (explored or not, tiles keep theirs).
  const fogLift = { value: 0 };
  let liftGoal = 0;
  const fogBounds = {
    value: new THREE.Vector4(
      BOUNDS.minX,
      BOUNDS.minZ,
      BOUNDS.maxX - BOUNDS.minX,
      BOUNDS.maxZ - BOUNDS.minZ,
    ),
  };
  let fogKey = "";
  const make = (height: number, scale: number, opacity: number) => {
    const geometry = new THREE.PlaneGeometry(260, 180, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: world.uTime,
        uClear: clear,
        uScale: { value: scale },
        uOpacity: { value: opacity },
        uSnow: world.uSnow,
        uFogFrom: fogFrom,
        uFogTo: fogTo,
        uFogMix: fogMix,
        uFogLift: fogLift,
        uFogBounds: fogBounds,
      },
      vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: /* glsl */ `
uniform float uTime, uScale, uOpacity, uSnow;
uniform vec4 uClear, uFogBounds;
uniform sampler2D uFogFrom, uFogTo;
uniform float uFogMix, uFogLift;
varying vec3 vWorld;
float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.02+11.3; a*=0.5; } return s; }
void main() {
  vec2 d = (vWorld.xz - uClear.xy) / uClear.zw;
  // The fog of war covers the ground seen through this point, not the point below it.
  vec3 ray = vWorld - cameraPosition;
  vec2 ground = cameraPosition.xz + ray.xz * cameraPosition.y / max(-ray.y, 1e-3);
  vec2 fogUv = (ground - uFogBounds.xy) / uFogBounds.zw;
  vec3 f = mix(texture2D(uFogFrom, fogUv).rgb, texture2D(uFogTo, fogUv).rgb, uFogMix);
  float corridor = (1.0 - smoothstep(2.0, 5.5, abs(ground.y))) *
    (1.0 - smoothstep(${(ISLAND_OFFSET - 3).toFixed(1)}, ${ISLAND_OFFSET.toFixed(1)}, abs(ground.x)));
  // Wild land, lifted along the corridor during a battle, under the tiles' own fog.
  float fog = f.r * (1.0 - f.b) * (1.0 - uFogLift * corridor) + f.g;
  // warp is in [0, 1], so inside this radius the storm mask is provably zero: skip the noise.
  if (length(d) < 0.575 && fog < 0.004) discard;
  vec2 p = vWorld.xz * uScale;
  vec2 drift = vec2(uTime * 0.018, uTime * 0.006);
  float warp = fbm(p * 0.6 + drift);
  float c = fbm(p + warp * 1.8 - drift * 1.6);
  float r = length(d) + (warp - 0.5) * 0.45;
  float storm = smoothstep(0.8, 1.3, r);
  float hidden = smoothstep(0.12, 0.88, fog + (warp - 0.5) * 0.3) * (1.0 - storm);
  float mask = storm + hidden;
  float density = smoothstep(0.32, 0.72, c) * mask;
  vec3 dark = mix(vec3(0.045, 0.06, 0.11), vec3(0.08, 0.09, 0.16), n(p * 0.3));
  vec3 lit = mix(vec3(0.2, 0.23, 0.34), vec3(0.5, 0.55, 0.66), uSnow);
  vec3 col = mix(dark, lit, smoothstep(0.5, 0.85, c) * 0.55);
  // Colour-only billows keep the fog's concealment and reveal mask unchanged.
  vec2 billowP = p * 15.0 + warp * 2.4;
  float billow = n(billowP);
  float sunward = clamp((billow - n(billowP + vec2(-0.28, 0.24))) * 2.8, 0.0, 1.0);
  vec3 mist = mix(vec3(0.22, 0.27, 0.35), vec3(0.67, 0.73, 0.81), smoothstep(0.18, 0.8, billow));
  mist += vec3(0.16, 0.15, 0.12) * sunward;
  mist *= 0.88 + 0.2 * c;
  col = mix(col, mist, hidden);
  float alpha = clamp((density + mask * 0.6 + hidden * 0.35) * uOpacity, 0.0, 0.98);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height;
    mesh.renderOrder = 10;
    return mesh;
  };
  const group = new THREE.Group();
  group.name = "clouds";
  group.add(make(1.6, 0.11, 0.95), make(3.2, 0.07, 0.8));
  return {
    group,
    clear,
    /**
     * Fog these tiles, and hide the wild land around both islands' halls (until the first
     * call, nothing is fogged). Fades unless `instant`.
     */
    fog(cells: readonly FogCell[], instant: boolean) {
      const key = JSON.stringify(cells);
      if (key === fogKey) return;
      fogKey = key;
      const from = fogFrom.value.image.data as Uint8Array;
      const to = fogTo.value.image.data as Uint8Array;
      // Start the next fade from what is on screen now.
      for (let k = 0; k < from.length; k++)
        from[k] = Math.round(from[k]! + (to[k]! - from[k]!) * fogMix.value);
      paintFog(cells, to);
      fogMix.value = instant ? 1 : 0;
      fogFrom.value.needsUpdate = fogTo.value.needsUpdate = true;
    },
    /** Lift the fog between the halls (during a battle) or let it settle back. */
    lift(on: boolean) {
      liftGoal = on ? 1 : 0;
    },
    tick(dt: number, instant: boolean) {
      const step = instant ? 1 : dt / FOG_FADE_SECONDS;
      fogMix.value = Math.min(1, fogMix.value + step);
      fogLift.value += Math.max(
        -step,
        Math.min(step, liftGoal - fogLift.value),
      );
    },
  };
}
