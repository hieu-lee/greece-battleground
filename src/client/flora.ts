import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hexToWorld } from "./hex.ts";
import type { Side } from "./hex.ts";
import { fbm, seeded } from "./noise.ts";
import { arenaWeight, groundHeight, landField, tileAt } from "./terrain.ts";
import type { Settlement, TileSpec } from "./terrain.ts";
import { patch } from "./shaders.ts";
import { rockGeometry } from "./rocks.ts";
import { treeData } from "./tree-data.ts";

type Kind = "cypress" | "pine" | "olive" | "wheat" | "boulder" | "crag";

function painted(geometry: THREE.BufferGeometry, colour: string) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  const c = new THREE.Color(colour);
  const count = g.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(data, 3));
  g.deleteAttribute("uv");
  return g;
}

// Darker underside, sunlit crown: the painted-foliage gradient the source art uses.
function shade(geometry: THREE.BufferGeometry, low = 0.62, high = 1.18) {
  const position = geometry.getAttribute("position");
  const colour = geometry.getAttribute("color");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  for (let i = 0; i < position.count; i++) {
    const t =
      (position.getY(i) - box.min.y) / Math.max(0.001, box.max.y - box.min.y);
    const k = low + (high - low) * t;
    colour.setXYZ(
      i,
      colour.getX(i) * k,
      colour.getY(i) * k,
      colour.getZ(i) * k,
    );
  }
  return geometry;
}

function treeGeometry(kind: keyof typeof treeData) {
  const data = treeData[kind];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(data.position, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(data.normal, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(data.colour, 3),
  );
  geometry.setIndex(data.index);
  return geometry;
}

const shapes: Record<Kind, () => THREE.BufferGeometry> = {
  cypress: () => treeGeometry("cypress"),
  pine: () => treeGeometry("pine"),
  olive: () => treeGeometry("olive"),
  wheat: () => {
    // A low tuft of ripe stalks, each tipped with an ear, leaning a little apart (few triangles:
    // fertile tiles carry dozens).
    const parts: THREE.BufferGeometry[] = [];
    const random = seeded(5);
    for (let i = 0; i < 12; i++) {
      const height = 0.24 + random() * 0.08;
      const lean = new THREE.Euler(
        (random() - 0.5) * 0.35,
        0,
        (random() - 0.5) * 0.35,
      );
      const x = (random() - 0.5) * 0.28;
      const z = (random() - 0.5) * 0.28;
      const stalk = new THREE.ConeGeometry(0.018, height, 3, 1, true);
      stalk.translate(0, height / 2, 0);
      const ear = new THREE.OctahedronGeometry(0.05, 0);
      ear.scale(1, 2.4, 1);
      ear.translate(0, height + 0.04, 0);
      for (const [g, colour] of [
        [stalk, "#c39431"],
        [ear, i % 3 ? "#f1c94e" : "#e0ab3e"],
      ] as const) {
        g.rotateX(lean.x);
        g.rotateZ(lean.z);
        g.translate(x, 0, z);
        parts.push(painted(g, colour));
      }
    }
    return shade(mergeGeometries(parts), 0.7, 1.15);
  },
  boulder: () => rockGeometry("boulder", 0.56),
  crag: () => rockGeometry("crag", 1.0),
};

type Placement = {
  kind: Kind;
  /** Owning tile ("side:q,r") and distance from its centre, for hiding props under structures. */
  tile?: string;
  d?: number;
  x: number;
  z: number;
  scale: number;
  tint: number;
};

function tileProps(
  tile: TileSpec,
  side: Side,
  random: () => number,
  out: Placement[],
) {
  const centre = hexToWorld(tile.q, tile.r, side);
  const scatter = (
    kind: Kind,
    count: number,
    min: number,
    max: number,
    size: [number, number],
  ) => {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const d = min + random() * (max - min);
      out.push({
        kind,
        tile: `${side}:${tile.q},${tile.r}`,
        d,
        x: centre.x + Math.cos(a) * d,
        z: centre.z + Math.sin(a) * d * 0.95,
        scale: size[0] + random() * (size[1] - size[0]),
        tint: random(),
      });
    }
  };
  switch (tile.terrain) {
    case "forest":
      scatter("pine", 10, 0, 0.82, [0.8, 1.25]);
      scatter("cypress", 6, 0.1, 0.82, [0.8, 1.2]);
      break;
    case "rocky":
      scatter("crag", 1, 0, 0.25, [0.9, 1.2]);
      scatter("boulder", 5, 0.25, 0.85, [0.5, 1.1]);
      break;
    case "mountain":
      scatter("crag", 3, 0, 0.5, [1.2, 1.6]);
      scatter("boulder", 4, 0.4, 0.85, [0.6, 1.1]);
      break;
    case "circle-of-stone": {
      const rotation = random() * Math.PI * 2;
      for (let i = 0; i < 7; i++) {
        const angle = rotation + (i * Math.PI * 2) / 7;
        const d = 0.54 + random() * 0.02;
        out.push({
          kind: "boulder",
          tile: `${side}:${tile.q},${tile.r}`,
          d,
          x: centre.x + Math.cos(angle) * d,
          z: centre.z + Math.sin(angle) * d,
          scale: 0.8 + random() * 0.1,
          tint: random(),
        });
      }
      break;
    }
    case "wildland":
      scatter("cypress", 3, 0.25, 0.58, [0.6, 0.8]);
      scatter("boulder", 2, 0.3, 0.65, [0.4, 0.8]);
      break;
    case "fertile":
      scatter("wheat", 46, 0, 0.84, [0.85, 1.05]);
      break;
    case "plains":
      if (random() < 0.4) scatter("olive", 1, 0.55, 0.85, [0.7, 0.95]);
      break;
  }
}

// Each tile scatters from its own stream, so a revealed tile can be re-scattered alone.
function propsOf(tile: TileSpec, side: Side) {
  const out: Placement[] = [];
  let hash = 2166136261;
  for (const c of `${side}:${tile.q},${tile.r}`)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  tileProps(tile, side, seeded(hash), out);
  return out;
}
// ponytail: fixed spare instances per kind for tiles revealed later; running out falls back to
// a full island rebuild.
const spare: Record<Kind, number> = {
  wheat: 96,
  pine: 24,
  cypress: 16,
  boulder: 40,
  crag: 12,
  olive: 8,
};

export function createFlora(
  initial: Record<Side, Settlement | null>,
  seed = 11,
) {
  let settlements = initial;
  const random = seeded(seed);
  const placements: Placement[] = [];
  for (const side of ["polis", "opponent"] as const) {
    const settlement = settlements[side];
    if (!settlement) continue;
    for (const tile of settlement.tiles)
      placements.push(...propsOf(tile, side));
  }
  // Wild land beyond the settlements: groves on the hills, rocks near cliffs.
  for (let z = -14; z <= 13; z += 0.55)
    for (let x = -29; x <= 29; x += 0.55) {
      const jx = x + (random() - 0.5) * 0.5,
        jz = z + (random() - 0.5) * 0.5;
      const field = landField(jx, jz);
      if (field < 0.35) continue;
      if (tileAt(settlements, jx, jz)) continue;
      const arena = arenaWeight(jx, jz);
      if (arena > 0.05) {
        if (arena < 0.5 && random() < 0.03)
          placements.push({
            kind: "boulder",
            x: jx,
            z: jz,
            scale: 0.5,
            tint: random(),
          });
        continue;
      }
      const grove = fbm(jx * 0.25 + 40, jz * 0.25);
      const roll = random();
      if (grove > 0.56 && roll < 0.5)
        placements.push({
          kind: roll < 0.18 ? "cypress" : roll < 0.36 ? "pine" : "olive",
          x: jx,
          z: jz,
          scale: 0.8 + random() * 0.5,
          tint: random(),
        });
      else if (field < 1.4 && roll < 0.08)
        placements.push({
          kind: "boulder",
          x: jx,
          z: jz,
          scale: 0.6 + random() * 0.8,
          tint: random(),
        });
    }
  const group = new THREE.Group();
  group.name = "flora";
  const material = patch(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
    }),
    {
      fragment: /* glsl */ `
{
  float leafy = smoothstep(0.05, 0.25, vColor.g - vColor.r);
  vec3 autumn = vec3(dot(diffuseColor.rgb, vec3(0.45, 0.4, 0.15))) * vec3(1.7, 1.0, 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, autumn, uAutumn * leafy * 0.65);
  diffuseColor.rgb *= 0.9 + 0.2 * gbNoise(vWorldPos.xz * 5.0 + vWorldPos.y * 4.0);
}`,
    },
  );
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  let tracked: {
    kind: Kind;
    mesh: THREE.InstancedMesh;
    index: number;
    tile: string;
    d: number;
    matrix: THREE.Matrix4;
  }[] = [];
  const meshes = new Map<Kind, THREE.InstancedMesh>();
  const free = new Map<Kind, number[]>();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  const place = (mesh: THREE.InstancedMesh, i: number, p: Placement) => {
    q.setFromAxisAngle(up, p.tint * Math.PI * 2);
    matrix.compose(
      new THREE.Vector3(p.x, groundHeight(settlements, p.x, p.z) - 0.02, p.z),
      q,
      new THREE.Vector3(
        p.scale,
        p.scale * (0.9 + p.tint * 0.25),
        p.scale,
      ).multiplyScalar(0.62),
    );
    mesh.setMatrixAt(i, matrix);
    if (p.tile !== undefined && p.d !== undefined)
      tracked.push({
        kind: p.kind,
        mesh,
        index: i,
        tile: p.tile,
        d: p.d,
        matrix: matrix.clone(),
      });
    colour.setScalar(0.88 + p.tint * 0.24);
    mesh.setColorAt(i, colour);
  };
  for (const kind of Object.keys(shapes) as Kind[]) {
    const list = placements.filter((p) => p.kind === kind);
    const mesh = new THREE.InstancedMesh(
      shapes[kind](),
      material,
      list.length + spare[kind],
    );
    list.forEach((p, i) => place(mesh, i, p));
    const slots: number[] = [];
    for (let i = list.length; i < mesh.count; i++) {
      mesh.setMatrixAt(i, hidden);
      slots.push(i);
    }
    meshes.set(kind, mesh);
    free.set(kind, slots);
    // Culling bounds come from every instance now, before any is hidden: three computes them
    // only once, so bounds taken later would leave out props that reappear when explored.
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    /**
     * Clear props from the middle of tiles that now hold a structure, and all props from tiles
     * hidden by the fog, where they would still hide troops' feet ("side:q,r" keys).
     */
    setHidden(occupied: ReadonlySet<string>, fogged: ReadonlySet<string>) {
      const touched = new Set<THREE.InstancedMesh>();
      for (const t of tracked) {
        const clear =
          (occupied.has(t.tile) && t.d < 0.62) || fogged.has(t.tile);
        t.mesh.setMatrixAt(t.index, clear ? hidden : t.matrix);
        touched.add(t.mesh);
      }
      for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
    },
    /** Re-scatter one tile whose terrain changed; false when the spare instances run out. */
    retile(tile: TileSpec, side: Side, next: Record<Side, Settlement | null>) {
      settlements = next;
      const key = `${side}:${tile.q},${tile.r}`;
      const props = propsOf(tile, side);
      const old = tracked.filter((t) => t.tile === key);
      for (const kind of Object.keys(shapes) as Kind[])
        if (
          props.filter((p) => p.kind === kind).length >
          (free.get(kind)?.length ?? 0) +
            old.filter((t) => t.kind === kind).length
        )
          return false;
      for (const t of old) {
        t.mesh.setMatrixAt(t.index, hidden);
        free.get(t.kind)?.push(t.index);
      }
      tracked = tracked.filter((t) => t.tile !== key);
      const touched = new Set(old.map((t) => t.mesh));
      for (const p of props) {
        const mesh = meshes.get(p.kind);
        const i = free.get(p.kind)?.pop();
        if (!mesh || i === undefined) continue;
        place(mesh, i, p);
        touched.add(mesh);
      }
      for (const mesh of touched) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        // Keep the earlier bounds too: props on fogged tiles are scaled to zero right now.
        const before = mesh.boundingSphere?.clone();
        mesh.computeBoundingSphere();
        if (before) mesh.boundingSphere?.union(before);
      }
      return true;
    },
    dispose() {
      material.dispose();
      for (const child of group.children)
        if (child instanceof THREE.InstancedMesh) {
          child.geometry.dispose();
          child.dispose();
        }
    },
  };
}
