import { appUrl } from "../urls.ts";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
          revision++;
          onChange();
        }
    },
    tick() {
      const now = performance.now();
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
