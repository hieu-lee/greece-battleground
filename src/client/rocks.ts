import * as THREE from "three";
import { rockData } from "./rock-data.ts";

export function rockGeometry(kind: keyof typeof rockData, width = 1) {
  const data = rockData[kind];
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
  geometry.scale(width, width, width);
  return geometry;
}
