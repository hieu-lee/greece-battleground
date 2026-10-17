import { appUrl } from "../urls.ts";
import * as THREE from "three";
import { fbm, noise } from "./noise.ts";
import { ISLAND_OFFSET, worldToHex } from "./hex.ts";
import type { Side } from "./hex.ts";
import { patch, world } from "./shaders.ts";

// Engine terrain, or the map feature standing on the tile (features win).
export type Terrain =
  | "plains"
  | "fertile"
  | "rocky"
  | "wildland"
  | "forest"
  | "mountain"
  | "circle-of-stone"
  // Under the fog: the engine does not disclose what lies there.
  | "hidden";
export type TileSpec = { q: number; r: number; terrain: Terrain };
export type Settlement = { tiles: readonly TileSpec[] };

// Land extents; outside this rectangle there is only sea and cloud.
export const BOUNDS = { minX: -30, maxX: 30, minZ: -15, maxZ: 14 };
export const WATER_LEVEL = -1.05;

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

// Positive on land, negative at sea, roughly in world units.
export function landField(x: number, z: number) {
  const islandRadius = 7.1;
  const left = islandRadius - Math.hypot(x + ISLAND_OFFSET, z * 1.06);
  const right = islandRadius - Math.hypot(x - ISLAND_OFFSET, z * 1.06);
  const arena = (1 - Math.hypot(x / 6.8, (z + 0.6) / 5.4)) * 5.4;
  const north = (1 - Math.hypot(x / 17, (z + 7.5) / 3.2)) * 3.2;
  let field = smax(smax(left, right, 2.5), arena, 3);
  field = smax(field, north, 2.5);
  const wobble = (fbm(x * 0.16 + 3.7, z * 0.16 - 1.3) - 0.5) * 3.2;
  const detail = (noise(x * 0.9, z * 0.9) - 0.5) * 0.5;
  return field + wobble + detail;
}

export function arenaWeight(x: number, z: number) {
  const d = Math.hypot(x / 5.6, (z + 0.3) / 4.3);
  const edge = (fbm(x * 0.5, z * 0.5) - 0.5) * 0.5;
  return 1 - smoothstep(0.75, 1.05, d + edge);
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Per-terrain tint over the painted grass, plus how much painted dirt / rock shows through.
const look: Record<
  Terrain | "wild",
  { tint: THREE.Color; dirt: number; rock: number }
> = {
  plains: { tint: new THREE.Color(1, 1, 1), dirt: 0, rock: 0 },
  fertile: { tint: new THREE.Color(1.3, 1.12, 0.55), dirt: 0.45, rock: 0 },
  rocky: { tint: new THREE.Color(0.95, 0.97, 0.9), dirt: 0.1, rock: 0.62 },
  wildland: { tint: new THREE.Color(0.9, 0.95, 0.78), dirt: 0.2, rock: 0.15 },
  forest: { tint: new THREE.Color(0.78, 0.92, 0.72), dirt: 0.05, rock: 0 },
  mountain: { tint: new THREE.Color(0.9, 0.9, 0.88), dirt: 0.1, rock: 0.85 },
  "circle-of-stone": {
    tint: new THREE.Color(1, 1, 0.95),
    dirt: 0.15,
    rock: 0.2,
  },
  hidden: { tint: new THREE.Color(1, 1, 1), dirt: 0, rock: 0 },
  wild: { tint: new THREE.Color(0.96, 0.98, 0.92), dirt: 0, rock: 0 },
};

const indexes = new WeakMap<Settlement, Map<string, TileSpec>>();
function tileIndex(settlement: Settlement) {
  let index = indexes.get(settlement);
  if (!index) {
    index = new Map(settlement.tiles.map((t) => [`${t.q},${t.r}`, t]));
    indexes.set(settlement, index);
  }
  return index;
}

export function tileAt(
  settlements: Record<Side, Settlement | null>,
  x: number,
  z: number,
): { side: Side; tile: TileSpec } | null {
  for (const side of ["polis", "opponent"] as const) {
    const settlement = settlements[side];
    if (!settlement) continue;
    const { q, r } = worldToHex(x, z, side);
    const tile = tileIndex(settlement).get(`${q},${r}`);
    if (tile) return { side, tile };
  }
  return null;
}

export function groundHeight(
  settlements: Record<Side, Settlement | null>,
  x: number,
  z: number,
  field = landField(x, z),
) {
  let y = (fbm(x * 0.35, z * 0.35) - 0.5) * 0.08;
  if (field < 0.6) y -= 2.2 * smoothstep(0.6, -1.4, field);
  if (field > 1.5 && arenaWeight(x, z) < 0.2 && !tileAt(settlements, x, z))
    y +=
      Math.max(0, fbm(x * 0.22 + 9, z * 0.22) - 0.52) *
      1.6 *
      smoothstep(1.5, 3, field);
  return y;
}

type GroundSample = {
  r: number;
  g: number;
  b: number;
  dirt: number;
  rock: number;
};

function groundSample(
  settlements: Record<Side, Settlement | null>,
  x: number,
  z: number,
): GroundSample {
  const hit = tileAt(settlements, x, z);
  const l = look[hit ? hit.tile.terrain : "wild"];
  const dirt = hit ? l.dirt : Math.max(l.dirt, arenaWeight(x, z));
  return { r: l.tint.r, g: l.tint.g, b: l.tint.b, dirt, rock: l.rock };
}

// Trodden earth under structures lives in a small mask texture, so placing one only repaints pixels.
const MASK = { w: 480, h: 232 };
export function createOccupancyMask() {
  const data = new Uint8Array(MASK.w * MASK.h);
  const texture = new THREE.DataTexture(data, MASK.w, MASK.h, THREE.RedFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const sx = MASK.w / (BOUNDS.maxX - BOUNDS.minX);
  const sz = MASK.h / (BOUNDS.maxZ - BOUNDS.minZ);
  return {
    texture,
    bounds: new THREE.Vector4(
      BOUNDS.minX,
      BOUNDS.minZ,
      BOUNDS.maxX - BOUNDS.minX,
      BOUNDS.maxZ - BOUNDS.minZ,
    ),
    paint(centres: readonly { x: number; z: number }[]) {
      data.fill(0);
      for (const c of centres) {
        const i0 = Math.max(0, Math.floor((c.x - 0.9 - BOUNDS.minX) * sx));
        const i1 = Math.min(
          MASK.w - 1,
          Math.ceil((c.x + 0.9 - BOUNDS.minX) * sx),
        );
        const j0 = Math.max(0, Math.floor((c.z - 0.9 - BOUNDS.minZ) * sz));
        const j1 = Math.min(
          MASK.h - 1,
          Math.ceil((c.z + 0.9 - BOUNDS.minZ) * sz),
        );
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const x = BOUNDS.minX + (i + 0.5) / sx;
            const z = BOUNDS.minZ + (j + 0.5) / sz;
            const d =
              Math.hypot(x - c.x, z - c.z) +
              (noise(x * 3.1, z * 3.1) - 0.5) * 0.35;
            const v = Math.round(255 * (1 - smoothstep(0.45, 0.8, d)));
            const k = j * MASK.w + i;
            if (v > data[k]!) data[k] = v;
          }
      }
      texture.needsUpdate = true;
    },
  };
}

const offsets = [
  [0, 0],
  [0.42, 0],
  [-0.42, 0],
  [0.21, 0.36],
  [-0.21, 0.36],
  [0.21, -0.36],
  [-0.21, -0.36],
] as const;
/**
 * Terrain colour and dirt/rock splat per ground vertex. With `around` (world centres of retiled
 * tiles) only the vertices that can sample those tiles are repainted.
 */
export function paintGround(
  geometry: THREE.BufferGeometry,
  settlements: Record<Side, Settlement | null>,
  around?: readonly { x: number; z: number }[],
) {
  const position = geometry.getAttribute("position");
  const colours = geometry.getAttribute("color") as THREE.BufferAttribute;
  const splat = geometry.getAttribute("splat") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    if (around && !around.some((c) => Math.hypot(x - c.x, z - c.z) < 1.5))
      continue;
    let r = 0,
      g = 0,
      b = 0,
      dirt = 0,
      rock = 0;
    for (const [dx, dz] of offsets) {
      const sample = groundSample(settlements, x + dx, z + dz);
      r += sample.r;
      g += sample.g;
      b += sample.b;
      dirt += sample.dirt;
      rock += sample.rock;
    }
    const n = offsets.length;
    const cliff = smoothstep(1.0, -0.2, landField(x, z));
    colours.setXYZ(i, r / n, g / n, b / n);
    splat.setXY(i, dirt / n, Math.max(rock / n, cliff));
  }
  colours.needsUpdate = true;
  splat.needsUpdate = true;
}

export function createGround(
  settlements: Record<Side, Settlement | null>,
  mask: ReturnType<typeof createOccupancyMask>,
) {
  const width = BOUNDS.maxX - BOUNDS.minX;
  const depth = BOUNDS.maxZ - BOUNDS.minZ;
  const geometry = new THREE.PlaneGeometry(width, depth, 300, 145);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(
    (BOUNDS.minX + BOUNDS.maxX) / 2,
    0,
    (BOUNDS.minZ + BOUNDS.maxZ) / 2,
  );
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    position.setY(i, groundHeight(settlements, x, z));
  }
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(position.count * 3), 3),
  );
  geometry.setAttribute(
    "splat",
    new THREE.BufferAttribute(new Float32Array(position.count * 2), 2),
  );
  paintGround(geometry, settlements);
  geometry.computeVertexNormals();
  const textures = groundTextures();
  const material = patch(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    }),
    {
      uniforms: {
        uOccupied: { value: mask.texture },
        uMaskBounds: { value: mask.bounds },
        uGrass: { value: textures.grass },
        uDirt: { value: textures.dirt },
        uRock: { value: textures.rock },
      },
      vertexHead: "attribute vec2 splat;\nvarying vec2 vSplat;",
      vertex: "vSplat = splat;",
      fragmentHead:
        "uniform sampler2D uGrass, uDirt, uRock, uOccupied;\nuniform vec4 uMaskBounds;\nvarying vec2 vSplat;",
      fragment: /* glsl */ `
{
  vec2 p = vWorldPos.xz;
  // Two rotated scales hide the repeat; broad noise picks between them.
  vec2 a = p * 0.31;
  vec2 b = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.23 + 7.3;
  float pick = smoothstep(0.35, 0.65, gbFbm(p * 0.09));
  vec3 grass = mix(texture2D(uGrass, a).rgb, texture2D(uGrass, b).rgb, pick);
  vec3 dirt = mix(texture2D(uDirt, a * 1.1).rgb, texture2D(uDirt, b).rgb, pick);
  dirt = mix(dirt, vec3(dot(dirt, vec3(0.3, 0.59, 0.11))), 0.3) * vec3(1.0, 0.96, 0.9);
  vec3 rock = mix(texture2D(uRock, a * 0.9).rgb, texture2D(uRock, b * 1.2).rgb, pick);
  float broad = gbFbm(p * 0.18);
  grass = mix(grass, vec3(dot(grass, vec3(0.3, 0.59, 0.11))), 0.18) * vec3(0.95, 0.93, 0.82);
  grass *= diffuseColor.rgb * (0.86 + 0.26 * broad);
  grass = mix(grass, grass * vec3(1.1, 1.05, 0.75), smoothstep(0.58, 0.78, broad) * 0.5);
  float edge = gbNoise(p * 4.0) * 0.25;
  float occupied = texture2D(uOccupied, (p - uMaskBounds.xy) / uMaskBounds.zw).r;
  float dw = smoothstep(0.25, 0.6, max(vSplat.x, occupied) + edge - 0.12);
  float rw = smoothstep(0.25, 0.6, vSplat.y + edge - 0.12);
  vec3 c = mix(grass, dirt, dw);
  c = mix(c, rock, rw);
  // Buried limestone edging recalls a worn Greek key without marking a combat boundary.
  float cadence = fract((p.x + 4.0) * 0.8);
  float shoulder = abs(p.y + 0.3) - 2.55;
  float stepLine = mix(-0.16, 0.16, step(0.5, cadence));
  float horizontal = abs(shoulder - stepLine);
  float vertical = max(abs(shoulder) - 0.16, min(cadence, abs(cadence - 0.5)) / 0.8);
  float edging = (1.0 - smoothstep(0.025, 0.07, min(horizontal, vertical)))
    * (1.0 - smoothstep(3.1, 3.8, abs(p.x))) * dw;
  float erosion = smoothstep(0.3, 0.67, gbNoise(p * 3.5));
  c = mix(c, rock * vec3(1.3, 1.2, 1.0), edging * erosion * 0.6);
  vec3 autumn = vec3(dot(c, vec3(0.5, 0.35, 0.15))) * vec3(1.45, 1.05, 0.55);
  c = mix(c, autumn, uAutumn * 0.5 * (1.0 - dw));
  c = mix(c, c * vec3(1.06, 1.02, 0.86), uSummer * 0.5);
  float slope = 1.0 - smoothstep(0.6, 0.9, vWorldNormal.y);
  c = mix(c, rock * 0.8, slope * 0.75);
  diffuseColor.rgb = c;
}`,
    },
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}

let shared: Record<"grass" | "dirt" | "rock", THREE.Texture> | null = null;
function groundTextures() {
  if (shared) return shared;
  const loader = new THREE.TextureLoader();
  const load = (name: string) => {
    const t = loader.load(appUrl(`/textures/ground-${name}.webp`));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  shared = { grass: load("grass"), dirt: load("dirt"), rock: load("rock") };
  return shared;
}

// A low-resolution land-field texture for water foam and cloud masks.
export function fieldTexture() {
  const w = 256,
    h = 128;
  const data = new Uint8Array(w * h * 4);
  const span = { x: 120, z: 60 };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = (i / (w - 1) - 0.5) * span.x;
      const z = (j / (h - 1) - 0.5) * span.z;
      const f = landField(x, z);
      const v = Math.max(0, Math.min(255, Math.round(128 + f * 24)));
      const k = (j * w + i) * 4;
      data[k] = v;
      data[k + 1] = v;
      data[k + 2] = v;
      data[k + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, w, h);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, span };
}

export function createWater(field: ReturnType<typeof fieldTexture>) {
  const geometry = new THREE.PlaneGeometry(240, 160, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const swell = /* glsl */ `
vec3 swell(vec2 p, float t) {
  vec2 a = vec2(1.9, 0.72), b = vec2(-0.72, 2.1), c = vec2(3.1, 2.4);
  float x = dot(p, a) - t * 1.45;
  float y = dot(p, b) - t * 1.08 + 1.9;
  float z = dot(p, c) - t * 1.86 + 0.6;
  return vec3(0.035 * sin(x) + 0.018 * sin(y) + 0.009 * sin(z),
    0.035 * a * cos(x) + 0.018 * b * cos(y) + 0.009 * c * cos(z));
}`;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uField: { value: field.texture },
      uSpan: { value: new THREE.Vector2(field.span.x, field.span.z) },
      uTime: world.uTime,
      uSnow: world.uSnow,
    },
    vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uField;
uniform vec2 uSpan;
uniform float uTime, uSnow;
varying vec3 vWorld;
${swell}
float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
void main() {
  vec2 p = vWorld.xz;
  float field = (texture2D(uField, p / uSpan + 0.5).r * 255.0 - 128.0) / 24.0;
  float d = max(-field, 0.0);
  float coast = smoothstep(0.3, 1.8, d);
  vec3 wave = swell(p, uTime);
  vec2 ripples = vec2(sin(dot(p, vec2(2.6, 1.4)) - uTime * 2.3),
    sin(dot(p, vec2(-1.7, 3.1)) - uTime * 1.7 + sin(p.x * 0.7)));
  vec2 slope = (wave.yz * 1.4 + ripples * 0.045) * coast;
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = 0.035 + 0.38 * pow(1.0 - max(dot(normal, view), 0.0), 3.0);
  vec3 c = mix(vec3(0.055, 0.48, 0.52), vec3(0.025, 0.23, 0.34), smoothstep(0.0, 5.0, d));
  c = mix(c, vec3(0.015, 0.105, 0.21), smoothstep(2.8, 5.2, d));
  c = mix(c, vec3(0.32, 0.56, 0.66), fresnel * 0.45);
  vec2 rippleUV = p + vec2(n(p * 0.72 + uTime * 0.06), n(p * 0.68 - uTime * 0.05)) * 0.38;
  float ripplePhase = rippleUV.y * 5.2 + sin(rippleUV.x * 1.15) * 0.6 - uTime * 2.1;
  float crest = pow(0.5 + 0.5 * sin(ripplePhase), 16.0);
  float patches = smoothstep(0.45, 0.72, n(vec2(rippleUV.x * 2.8, rippleUV.y * 2.4) + vec2(uTime * 0.12, 0.0)));
  patches *= smoothstep(0.28, 0.68, n(p * 1.7 - vec2(0.0, uTime * 0.08)));
  c += vec3(0.03, 0.085, 0.095) * crest * patches * coast;
  vec3 halfSun = normalize(view + normalize(vec3(-0.45, 0.8, 0.55)));
  float sun = pow(max(dot(normal, halfSun), 0.0), 55.0);
  c += vec3(0.55, 0.72, 0.69) * sun * patches * 0.07 * coast;
  float broken = n(p * 2.3 + vec2(uTime * 0.18, -uTime * 0.11));
  float wash = sin(d * 5.8 - uTime * 1.7 + n(p * 0.7) * 3.0);
  float foam = smoothstep(0.62, 0.94, wash) * (1.0 - smoothstep(0.25, 1.9, d));
  foam *= broken * broken;
  foam += smoothstep(0.72, 0.98, wash) * smoothstep(1.3, 2.5, d) *
    (1.0 - smoothstep(3.2, 4.6, d)) * broken * broken * 0.30;
  foam += (1.0 - smoothstep(0.02, 0.28, d)) * (0.32 + 0.25 * broken);
  c = mix(c, vec3(0.64, 0.84, 0.83), min(foam, 0.8));
  c = mix(c, vec3(0.75, 0.85, 0.9), uSnow * 0.15 * (1.0 - smoothstep(0.0, 5.0, d)));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = WATER_LEVEL;
  mesh.name = "water";
  return mesh;
}
