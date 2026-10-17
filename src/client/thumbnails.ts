import * as THREE from "three";
import { loadModel } from "./buildings.ts";
import { surfacesReady } from "./materials.ts";
import { world } from "./shaders.ts";

// Shop and tooltip art rendered from the same glTF models as the map, on a hex of grass.
// One small offscreen renderer is created on first use and kept (models stay cached anyway).
let renderer: THREE.WebGLRenderer | null = null;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
const cache = new Map<string, Promise<string>>();
const holder = new THREE.Group();
const sun = new THREE.DirectionalLight("#fff0d0", 2.8);
sun.position.set(-3, 6, 4);
const hex = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1.02, 0.12, 6),
  new THREE.MeshStandardMaterial({ color: "#7fa046", roughness: 1 }),
);
hex.rotation.y = Math.PI / 6;
hex.position.y = -0.06;
scene.add(
  new THREE.HemisphereLight("#dfeeff", "#4a5a30", 1.4),
  sun,
  hex,
  holder,
);

function setup() {
  if (renderer) return renderer;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

export function thumbnail(model: string, level: number) {
  const key = `${model}:${level}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = loadModel(model, level).then(async (object) => {
      if (!object || !(await surfacesReady())) {
        cache.delete(key);
        return "";
      }
      const r = setup();
      holder.clear();
      holder.add(object.clone());
      // Frame the model's bounds so tall halls and flat camps fill the card alike.
      const box = new THREE.Box3().setFromObject(holder);
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(1.05, size.x * 0.55, size.z * 0.55, size.y * 0.7);
      const centre = box.getCenter(new THREE.Vector3());
      camera.position.set(0, centre.y + radius * 2.7, radius * 2.9);
      camera.lookAt(0, centre.y * 0.6, 0);
      // Shop art never shows the current season's snow.
      const snow = world.uSnow.value;
      world.uSnow.value = 0;
      r.render(scene, camera);
      world.uSnow.value = snow;
      return r.domElement.toDataURL("image/png");
    });
    cache.set(key, pending);
  }
  return pending;
}
