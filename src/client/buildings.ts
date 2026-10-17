import { appUrl } from "../urls.ts";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hexToWorld } from "./hex.ts";
import type { Side } from "./hex.ts";
import { bindSurfaces } from "./materials.ts";
import { frameCount, sheet } from "./sprites.ts";

export type BuildingPlacement = {
  key: string;
  q: number;
  r: number;
  model: string;
  level: number;
};

const draco = new DRACOLoader().setDecoderPath(appUrl("/draco/"));
const loader = new GLTFLoader().setDRACOLoader(draco);
const models = new Map<string, Promise<THREE.Object3D | null>>();

export function loadModel(model: string, level: number) {
  const id = `${model}-l${level}`;
  let pending = models.get(id);
  if (!pending) {
    pending = loader
      .loadAsync(appUrl(`/models/${id}.glb`))
      .then((gltf) => {
        bindSurfaces(gltf.scene);
        return gltf.scene;
      })
      .catch((error: unknown) => {
        console.error(`Model ${id} unavailable; using its sprite`, error);
        // Retry on the next placement rather than keeping the sprite for the whole session.
        models.delete(id);
        return null;
      });
    models.set(id, pending);
  }
  return pending;
}

// Fallback while a model is missing: the offline-rendered sprite as an upright card.
async function spriteCard(model: string, level: number) {
  const s = await sheet(model);
  const frames = frameCount(s.data);
  const texture = s.texture.clone();
  texture.repeat.set(1 / frames, 1);
  texture.offset.set(Math.min(frames - 1, level - 1) / frames, 0);
  texture.needsUpdate = true;
  const scale = 2.3 / s.data.frameWidth;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(s.data.frameWidth * scale, s.data.height * scale),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
    }),
  );
  const ay = s.data.anchor[1] / s.data.height;
  plane.position.y = (ay - 0.5) * s.data.height * scale;
  const pivot = new THREE.Group();
  pivot.add(plane);
  pivot.userData.card = plane;
  plane.userData.owned = true;
  return pivot;
}

// Structures the Agora also offers glow (the source's upgrade hint): the model's silhouette is
// written to the stencil buffer, then smooth hulls pushed out along view-space normals draw only
// outside it, a bright rim inside a softer violet haze, gently pulsing.
const glowTime = { value: 0 };
const glowMask = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  depthTest: false,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});
function glowMaterial(color: number, width: number, opacity: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      width: { value: width },
      opacity: { value: opacity },
      time: glowTime,
    },
    vertexShader: `
      uniform float width;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        view.xyz += normalize(normalMatrix * normal) * width;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform float time;
      void main() {
        gl_FragColor = vec4(color, opacity * (0.8 + 0.2 * sin(time * 3.0)));
      }`,
    transparent: true,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
  });
}
// Outer haze first, so the rim draws over it.
const glowLayers = [
  glowMaterial(0x8b63ff, 0.12, 0.5),
  glowMaterial(0xeef0ff, 0.045, 0.95),
];
// Low-poly models split their normals at hard edges; hulls weld them so the halo has no cracks.
const hulls = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function hullGeometry(geometry: THREE.BufferGeometry) {
  let hull = hulls.get(geometry);
  if (!hull) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", geometry.attributes.position!);
    if (geometry.index) shape.setIndex(geometry.index);
    hull = mergeVertices(shape);
    hull.computeVertexNormals();
    hulls.set(geometry, hull);
  }
  return hull;
}
function setGlow(object: THREE.Object3D, on: boolean) {
  const added: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child.userData.glow) added.push(child);
    // Fallback sprite cards are flat; only models get a halo.
    else if (child instanceof THREE.Mesh && !child.userData.owned)
      meshes.push(child);
  });
  if (on === added.length > 0) return;
  for (const child of added) child.removeFromParent();
  if (!on) return;
  for (const mesh of meshes) {
    // Shared with the model and cached per geometry, so release() leaves them alone.
    const mask = new THREE.Mesh(mesh.geometry, glowMask);
    mask.userData.glow = true;
    mesh.add(mask);
    for (const [i, material] of glowLayers.entries()) {
      const hull = new THREE.Mesh(hullGeometry(mesh.geometry), material);
      hull.userData.glow = true;
      hull.renderOrder = 1 + i;
      mesh.add(hull);
    }
  }
}

// Fallback cards own their geometry, material and texture clone; models share theirs.
function release(group: THREE.Object3D) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.userData.owned) return;
    child.geometry.dispose();
    const material = child.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  });
}

export function createBuildings(
  scene: THREE.Scene,
  camera: THREE.Camera,
  onChange: () => void = () => {},
) {
  const root = new THREE.Group();
  root.name = "buildings";
  scene.add(root);
  const live = new Map<
    string,
    {
      group: THREE.Group;
      signature: string;
      side: Side;
      status: "loading" | "ready" | "failed";
    }
  >();
  const cards: THREE.Object3D[] = [];
  const glowing = new Set<string>();
  let reduced = false;
  let revision = 0;
  async function build(
    p: BuildingPlacement,
    side: Side,
    group: THREE.Group,
    signature: string,
  ) {
    const entry = live.get(`${side}:${p.key}`);
    const model = await loadModel(p.model, p.level);
    const object = model
      ? model.clone()
      : await spriteCard(p.model, p.level).catch(() => null);
    if (
      !entry ||
      live.get(`${side}:${p.key}`) !== entry ||
      entry.group !== group ||
      entry.signature !== signature
    ) {
      if (object) release(object);
      return;
    }
    if (!object) {
      entry.status = "failed";
      onChange();
      return;
    }
    release(group);
    group.clear();
    group.add(object);
    setGlow(group, glowing.has(`${side}:${p.key}`));
    entry.status = "ready";
    if (object.userData.card) cards.push(object);
    // Rise from the ground when newly placed (appear in place under reduced motion).
    group.userData.spawn = performance.now();
    group.userData.settled = reduced;
    group.scale.setScalar(reduced ? 1 : 0.6);
    onChange();
  }
  return {
    get revision() {
      return revision;
    },
    get assetStatus(): "loading" | "ready" | "failed" {
      let status: "loading" | "ready" = "ready";
      for (const entry of live.values()) {
        if (entry.status === "failed") return "failed";
        if (entry.status === "loading") status = "loading";
      }
      return status;
    },
    setReducedMotion(value: boolean) {
      reduced = value;
    },
    set(side: Side, placements: readonly BuildingPlacement[]) {
      const keep = new Set<string>();
      for (const p of placements) {
        const id = `${side}:${p.key}`;
        keep.add(id);
        const signature = `${p.model}:${p.level}:${p.q},${p.r}`;
        const existing = live.get(id);
        if (existing?.signature === signature && existing.status !== "failed")
          continue;
        const group = existing?.group ?? new THREE.Group();
        const c = hexToWorld(p.q, p.r, side);
        group.position.set(c.x, 0, c.z);
        group.userData.home = c;
        group.rotation.y = side === "polis" ? 0 : Math.PI;
        group.userData.key = p.key;
        group.userData.side = side;
        if (!existing) root.add(group);
        revision++;
        live.set(id, { group, signature, side, status: "loading" });
        void build(p, side, group, signature);
      }
      for (const [id, entry] of live)
        if (entry.side === side && !keep.has(id)) {
          root.remove(entry.group);
          release(entry.group);
          live.delete(id);
          glowing.delete(id);
          revision++;
          onChange();
        }
    },
    /** Makes exactly these structures glow on a side. */
    glow(side: Side, keys: ReadonlySet<string>) {
      for (const [id, entry] of live) {
        if (entry.side !== side) continue;
        const on = keys.has(id.slice(side.length + 1));
        if (on) glowing.add(id);
        else glowing.delete(id);
        setGlow(entry.group, on);
      }
    },
    /** Lifts a structure to follow the ground point under the pointer; null sets it back on its tile. */
    hold(side: Side, key: string, point: { x: number; z: number } | null) {
      const group = live.get(`${side}:${key}`)?.group;
      if (!group) return;
      const at = point ?? (group.userData.home as { x: number; z: number });
      group.position.set(at.x, point ? 0.4 : 0, at.z);
      onChange();
    },
    tick() {
      const now = performance.now();
      // Reduced motion keeps the highlight steady.
      glowTime.value = reduced ? 0 : now / 1000;
      for (const { group } of live.values()) {
        if (group.userData.settled) continue;
        const t = Math.min(1, (now - (group.userData.spawn ?? 0)) / 450);
        if (t >= 1) group.userData.settled = true;
        onChange();
        const s =
          t < 1
            ? 0.6 +
              0.4 *
                (1 - Math.pow(1 - t, 3)) *
                (1 + 0.12 * Math.sin(t * Math.PI))
            : 1;
        group.scale.setScalar(s);
      }
      for (let i = cards.length - 1; i >= 0; i--) {
        const card = cards[i]!;
        if (!card.parent?.parent) cards.splice(i, 1);
        else
          card.quaternion
            .copy(card.parent.quaternion)
            .invert()
            .multiply(camera.quaternion);
      }
    },
  };
}
