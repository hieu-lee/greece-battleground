import * as THREE from "three";
import { groundHeight, landField, WATER_LEVEL } from "./terrain.ts";
import { noise, seeded } from "./noise.ts";
import { patch } from "./shaders.ts";
import { rockGeometry } from "./rocks.ts";

// Preserve scanned rock proportions; the terrain itself supplies the continuous cliff.
export function createCoast(seed = 7) {
  const random = seeded(seed);
  const geometry = rockGeometry("boulder");
  geometry.computeBoundingBox();
  const height = geometry.boundingBox?.max.y ?? 1;
  const material = patch(
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.88,
      metalness: 0.02,
      vertexColors: true,
    }),
    {
      fragment: /* glsl */ `
{
  float top = smoothstep(0.75, 0.95, vWorldNormal.y);
  float grain = gbNoise(vWorldPos.xz * 7.0 + vWorldPos.y * 3.0);
  diffuseColor.rgb *= 0.82 + 0.3 * grain;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.16 + vec3(0.015), top);
  float wet = 1.0 - smoothstep(-1.2, -0.75, vWorldPos.y);
  diffuseColor.rgb *= 1.0 - wet * 0.35;
}`,
    },
  );
  type Spot = { x: number; z: number; r: number; top: number; tint: number };
  const spots: Spot[] = [];
  const step = 0.62;
  for (let z = -22; z <= 20; z += step)
    for (let x = -36; x <= 36; x += step * 0.95) {
      const jx = x + (random() - 0.5) * step * 0.7;
      const jz = z + (random() - 0.5) * step * 0.7;
      const field = landField(jx, jz);
      let top: number;
      if (field > -0.15 && field < 0.3) {
        // Cliff lip: concentrate boulders around the meadow edge.
        top = 0.05 + random() * 0.45 - Math.max(0, field) * 0.3;
      } else if (field <= -0.15 && field > -2.6) {
        const t = (-field - 0.15) / 2.45;
        top = 0.15 - t * 1.3 + (random() - 0.5) * 0.7;
        if (random() < t * 0.55) continue;
      } else if (field <= -2.6 && field > -4.5) {
        // A few sea stacks just off the cliffs.
        if (noise(jx * 0.5 + 11, jz * 0.5) < 0.72 || random() < 0.6) continue;
        top = WATER_LEVEL + 0.1 + random() * 0.6;
      } else continue;
      if (top < WATER_LEVEL + 0.05) continue;
      spots.push({
        x: jx,
        z: jz,
        r: random() < 0.12 ? 1.3 + random() * 0.35 : 0.8 + random() * 0.45,
        top,
        tint: random(),
      });
    }
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const base = new THREE.Color("#ffffff");
  const cool = new THREE.Color("#dce1df");
  const warm = new THREE.Color("#fff3dc");
  const colour = new THREE.Color();
  spots.forEach((s, i) => {
    quaternion.setFromAxisAngle(up, random() * Math.PI);
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(random() - 0.5, 0, random() - 0.5).normalize(),
      (random() - 0.5) * 0.12,
    );
    quaternion.multiply(tilt);
    const ground = groundHeight({ polis: null, opponent: null }, s.x, s.z);
    position.set(s.x, ground - height * s.r * 0.18, s.z);
    scale.setScalar(s.r);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    colour
      .copy(base)
      .lerp(s.tint < 0.5 ? cool : warm, Math.abs(s.tint - 0.5) * 2);
    mesh.setColorAt(i, colour);
  });
  const candidates = spots.filter(
    (s) => s.top > WATER_LEVEL + 0.35 && s.r > 1.05,
  );
  const chosen = Array.from(
    { length: Math.min(48, candidates.length) },
    (_, i) =>
      candidates[
        Math.floor((i * candidates.length) / Math.min(48, candidates.length))
      ],
  ).filter((s): s is Spot => s !== undefined);
  const slabs = new THREE.InstancedMesh(
    rockGeometry("slab"),
    material,
    chosen.length,
  );
  chosen.forEach((s, i) => {
    const width = s.r * 1.25;
    const ground = groundHeight({ polis: null, opponent: null }, s.x, s.z);
    position.set(s.x, ground - width * 0.12, s.z);
    quaternion.setFromAxisAngle(up, s.tint * Math.PI * 2);
    scale.setScalar(width);
    matrix.compose(position, quaternion, scale);
    slabs.setMatrixAt(i, matrix);
    colour.setScalar(0.94 + s.tint * 0.12);
    slabs.setColorAt(i, colour);
  });
  slabs.name = "coast-rock-slabs";
  slabs.castShadow = true;
  slabs.receiveShadow = true;
  slabs.computeBoundingSphere();
  mesh.add(slabs);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "coast";
  return mesh;
}
