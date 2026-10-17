import { appUrl } from "../urls.ts";
import * as THREE from "three";
import { patch } from "./shaders.ts";

// Shared painted surfaces for every building model. Names match blender_kit.py materials ("gb_<name>").
const textured = [
  "roof",
  "limestone",
  "marble",
  "wood",
  "plaster",
  "bronze",
  "cloth",
  "cobble",
] as const;
const flat: Record<string, string> = {
  terracotta: "#c4683f",
  red: "#a8261a",
  blue: "#2a5aa8",
  gold: "#f2c050",
  dark: "#2a2420",
  foliage: "#4f8a34",
  olive: "#7c9a4a",
  olive_leaf: "#86a077",
  straw: "#d9b46a",
  water: "#4aa8bc",
  fire: "#ffb347",
  rock: "#9aa0a6",
  silver: "#dfe6ea",
  grape: "#6a2c74",
  earth: "#8a6a48",
  verdigris: "#86bfa8",
};
const metallic = new Set(["bronze", "gold", "silver"]);
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Material>();
type PaintedSurface = {
  name: string;
  material: THREE.MeshStandardMaterial;
  load:
    { kind: "loading"; done: Promise<boolean> } | { kind: "ready" | "failed" };
};
const painted = new Map<string, PaintedSurface>();

export function surfacesStatus(): "loading" | "ready" | "failed" {
  let status: "loading" | "ready" = "ready";
  for (const { load } of painted.values()) {
    if (load.kind === "failed") return "failed";
    if (load.kind === "loading") status = "loading";
  }
  return status;
}

/** Failed images never count as decoded surfaces. */
export async function surfacesReady() {
  const ready = await Promise.all(
    [...painted.values()].map(({ load }) =>
      load.kind === "loading" ? load.done : load.kind === "ready",
    ),
  );
  return ready.every(Boolean);
}

function loadPainted(entry: PaintedSurface) {
  const previous = entry.material.map;
  const done = new Promise<boolean>((resolve) => {
    const complete = (ready: boolean) => {
      entry.load = { kind: ready ? "ready" : "failed" };
      resolve(ready);
    };
    const map = loader.load(
      appUrl(`/textures/${entry.name}.webp`),
      () => complete(true),
      undefined,
      () => complete(false),
    );
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    entry.material.map = map;
    entry.material.needsUpdate = true;
  });
  entry.load = { kind: "loading", done };
  previous?.dispose();
}

export function retrySurfaces() {
  for (const entry of painted.values())
    if (entry.load.kind === "failed") loadPainted(entry);
}

function surface(name: string) {
  let material = cache.get(name);
  if (material) return material;
  const standard = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: metallic.has(name) ? 0.42 : 0.82,
    metalness: metallic.has(name) ? 0.55 : 0,
  });
  if ((textured as readonly string[]).includes(name)) {
    const entry: PaintedSurface = {
      name,
      material: standard,
      load: { kind: "failed" },
    };
    painted.set(name, entry);
    loadPainted(entry);
  } else {
    const colour = flat[name];
    if (!colour) console.error(`Unknown building surface "${name}"`);
    standard.color.set(colour ?? "#cccccc");
  }
  if (name === "fire") {
    standard.emissive.set("#ff8a2a");
    standard.emissiveIntensity = 2.2;
  }
  if (name === "water") {
    standard.roughness = 0.15;
    standard.metalness = 0.1;
  }
  material = patch(standard);
  cache.set(name, material);
  return material;
}

/**
 * A tiny mesh per shared surface, shaped like the exported models (normals, UVs and the RGBA
 * vertex colours every export carries), so all building shader variants compile up front.
 */
export function surfaceSamples() {
  const geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(new Array(count * 4).fill(1), 4),
  );
  const group = new THREE.Group();
  for (const name of [...textured, ...Object.keys(flat)]) {
    const mesh = new THREE.Mesh(geometry, surface(name));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, dispose: () => geometry.dispose() };
}

export function bindSurfaces(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material) => surface(m.name.replace(/^gb_/, ""));
    child.material = Array.isArray(child.material)
      ? child.material.map(swap)
      : swap(child.material);
    child.castShadow = true;
    child.receiveShadow = true;
  });
}
