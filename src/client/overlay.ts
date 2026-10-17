import * as THREE from "three";
import { edgeNeighbour, hexCorners, hexToWorld, neighbours } from "./hex.ts";
import type { Side } from "./hex.ts";
import { world } from "./shaders.ts";

type Hex = { q: number; r: number };
const key = (q: number, r: number) => `${q},${r}`;

// Ribbon along a closed polyline; `v` runs 0..1 across the width for the glow profile.
function ribbon(loop: THREE.Vector2[], width: number, y: number) {
  const positions: number[] = [];
  const across: number[] = [];
  const index: number[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n]!,
      cur = loop[i]!,
      next = loop[(i + 1) % n]!;
    const t = new THREE.Vector2().subVectors(next, prev).normalize();
    const normal = new THREE.Vector2(-t.y, t.x);
    positions.push(
      cur.x + normal.x * width,
      y,
      cur.y + normal.y * width,
      cur.x - normal.x * width,
      y,
      cur.y - normal.y * width,
    );
    across.push(0, 1);
    const a = i * 2,
      b = ((i + 1) % n) * 2;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("across", new THREE.Float32BufferAttribute(across, 1));
  g.setIndex(index);
  return g;
}

function chaikin(points: THREE.Vector2[], rounds: number) {
  let current = points;
  for (let r = 0; r < rounds; r++) {
    const next: THREE.Vector2[] = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i]!,
        b = current[(i + 1) % current.length]!;
      next.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75));
    }
    current = next;
  }
  return current;
}

// Outer boundary loops of a set of hexes, each as ordered corner points.
function boundaryLoops(hexes: readonly Hex[], side: Side, inset = 0.9) {
  const owned = new Set(hexes.map((h) => key(h.q, h.r)));
  const edges = new Map<string, { from: THREE.Vector2; to: THREE.Vector2 }>();
  const pointKey = (p: THREE.Vector2) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  for (const h of hexes) {
    const c = hexToWorld(h.q, h.r, "polis");
    const corners = hexCorners(c.x, c.z);
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = neighbours[edgeNeighbour[i]!]!;
      if (owned.has(key(h.q + dq, h.r + dr))) continue;
      const a = corners[i]!,
        b = corners[(i + 1) % 6]!;
      const from = new THREE.Vector2(a[0], a[1]);
      edges.set(pointKey(from), { from, to: new THREE.Vector2(b[0], b[1]) });
    }
  }
  const loops: THREE.Vector2[][] = [];
  while (edges.size) {
    const [startKey, start] = edges.entries().next().value!;
    edges.delete(startKey);
    const loop = [start.from];
    let cursor = start.to;
    while (pointKey(cursor) !== startKey) {
      loop.push(cursor);
      const next = edges.get(pointKey(cursor));
      if (!next) break;
      edges.delete(pointKey(cursor));
      cursor = next.to;
    }
    // Rounded and pulled inward so the line sits inside the territory.
    loops.push(insetLoop(chaikin(loop, 3), 1 - inset));
  }
  // Mirror for the opponent: polis-space x is shifted, so map through world space.
  if (side === "opponent")
    for (const loop of loops) for (const p of loop) p.x = -p.x;
  return loops;
}

// Boundary edges follow each owned hex's corner order, so the territory always lies on the
// same side of them, for outer borders and holes alike. A lone hex's winding names that side.
const territorySide = (() => {
  const corners = hexCorners(0, 0);
  let area = 0;
  corners.forEach(([ax, ay], i) => {
    const [bx, by] = corners[(i + 1) % corners.length]!;
    area += ax * by - bx * ay;
  });
  return area > 0 ? 1 : -1;
})();

function insetLoop(loop: THREE.Vector2[], amount: number) {
  const n = loop.length;
  return loop.map((cur, i) => {
    const prev = loop[(i - 1 + n) % n]!,
      next = loop[(i + 1) % n]!;
    const t = new THREE.Vector2().subVectors(next, prev).normalize();
    const inward = new THREE.Vector2(-t.y, t.x).multiplyScalar(territorySide);
    return cur.clone().addScaledVector(inward, amount);
  });
}

const glowMaterial = (colour: string, strength: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColour: { value: new THREE.Color(colour) },
      uStrength: { value: strength },
      uTime: world.uTime,
    },
    vertexShader: /* glsl */ `
attribute float across;
varying float vAcross;
void main() { vAcross = across; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform vec3 uColour; uniform float uStrength, uTime;
varying float vAcross;
void main() {
  float d = abs(vAcross - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.35, d);
  float halo = pow(1.0 - d, 2.0) * 0.5;
  float pulse = 0.9 + 0.1 * sin(uTime * 2.0);
  gl_FragColor = vec4(uColour * (core + halo) * uStrength * pulse, 1.0);
  #include <colorspace_fragment>
}`,
  });

export function createOverlay(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = "overlay";
  scene.add(group);
  const territory: Record<Side, THREE.Group> = {
    polis: new THREE.Group(),
    opponent: new THREE.Group(),
  };
  group.add(territory.polis, territory.opponent);
  const gold = glowMaterial("#f2c14e", 0.95);
  const red = glowMaterial("#e0573f", 0.8);
  const hoverMaterial = glowMaterial("#cfeaff", 1.1);
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: "#cfeaff",
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const targetMaterial = new THREE.MeshBasicMaterial({
    color: "#ffe9a6",
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const hexShape = (() => {
    const s = new THREE.Shape();
    hexCorners(0, 0, 0.94).forEach(([x, z], i) =>
      i ? s.lineTo(x, -z) : s.moveTo(x, -z),
    );
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  const hover = new THREE.Group();
  hover.add(new THREE.Mesh(hexShape, fillMaterial));
  hover.add(
    new THREE.Mesh(
      ribbon(
        hexCorners(0, 0, 0.92).map(([x, z]) => new THREE.Vector2(x, z)),
        0.05,
        0,
      ),
      hoverMaterial,
    ),
  );
  hover.position.y = 0.06;
  hover.visible = false;
  // Hover and targets draw after the clouds (10), so the border tiles' mist does not dim them.
  hover.renderOrder = 11;
  group.add(hover);
  const targets = new THREE.Group();
  group.add(targets);
  return {
    setTerritory(side: Side, hexes: readonly Hex[]) {
      const key = JSON.stringify(hexes.map((h) => [h.q, h.r]));
      if (territory[side].userData.key === key) return;
      territory[side].userData.key = key;
      const g = territory[side];
      for (const child of g.children)
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      g.clear();
      for (const loop of boundaryLoops(hexes, side)) {
        const mesh = new THREE.Mesh(
          ribbon(loop, 0.075, 0.07),
          side === "polis" ? gold : red,
        );
        mesh.renderOrder = 4;
        g.add(mesh);
      }
    },
    setHover(hex: Hex | null, side: Side = "polis") {
      hover.visible = Boolean(hex);
      if (!hex) return;
      const c = hexToWorld(hex.q, hex.r, side);
      hover.position.set(c.x, 0.06, c.z);
    },
    setTargets(hexes: readonly Hex[], side: Side = "polis") {
      const key = side + JSON.stringify(hexes.map((h) => [h.q, h.r]));
      if (targets.userData.key === key) return;
      targets.userData.key = key;
      targets.clear();
      for (const h of hexes) {
        const c = hexToWorld(h.q, h.r, side);
        const m = new THREE.Mesh(hexShape, targetMaterial);
        m.position.set(c.x, 0.05, c.z);
        m.renderOrder = 11;
        targets.add(m);
      }
    },
  };
}
