import * as THREE from "three";
import type { World } from "./world.ts";
import type { Season } from "../workshop.ts";

const COUNT = 900;

// One bounded particle draw: rain, rising heat, tumbling leaves and snow.
export function createWeather(world: World) {
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = Math.random() * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 24;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
  const uniforms = {
    uTime: { value: 0 },
    uFallen: { value: 0 },
    uWind: { value: 0 },
    uCentre: { value: new THREE.Vector3() },
    uSpread: { value: 1 },
    uOffset: { value: new THREE.Vector2() },
    uColour: { value: new THREE.Color("#ffffff") },
    uSize: { value: 1 },
    uAmount: { value: 0 },
    uWeather: { value: new THREE.Vector3(1, 0, 0) },
    uPixels: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
attribute float seed;
uniform float uTime, uFallen, uWind, uSize, uAmount, uPixels;
uniform vec3 uCentre;
uniform vec3 uWeather;
uniform float uSpread;
uniform vec2 uOffset;
varying float vAlpha;
varying float vSeed;
void main() {
  vec3 p = position;
  float pace = 0.6 + seed * 0.6;
  float t = uTime * pace;
  // Fall distance and wind are accumulated on the CPU, so season changes never jump.
  p.y = mod(p.y - uFallen * pace, 8.0);
  float height = p.y;
  p.y *= mix(1.0, 0.3, uWeather.z);
  p.x += sin(t * 0.8 + seed * 40.0) * 0.6 + uWind * pace;
  p.z += cos(t * 0.6 + seed * 20.0) * 0.4;
  // Wrap into a 40x24 box around the view centre, then spread that bounded offset with zoom so
  // the volume covers the visible ground. uOffset cancels camera pans (tracked on the CPU), so
  // flakes stay world-fixed while panning and zoom is a pure scale around the focus.
  const vec2 box = vec2(40.0, 24.0);
  vec2 local = mod(p.xz + uOffset + box * 0.5, box) - box * 0.5;
  p.xz = local * uSpread + uCentre.xz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // Scale with the projection (portrait views use a wider field of view) and drop hidden flakes.
  float visible = step(seed, uAmount);
  gl_PointSize = min(visible * uSize * (14.0 + seed * 10.0) * 10.0 * uPixels * projectionMatrix[1][1] / 3.49 / -mv.z, 48.0 * uPixels);
  gl_Position = projectionMatrix * mv;
  vAlpha = step(seed, uAmount) * smoothstep(0.0, 1.0, height) * (1.0 - smoothstep(6.0, 8.0, height));
  vSeed = seed;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColour;
uniform vec3 uWeather;
uniform float uTime;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c * vec2(1.0, 1.0 + vSeed));
  float snow = 1.0 - smoothstep(0.16, 0.48, d);
  float rain = (1.0 - smoothstep(0.035, 0.085, abs(c.x - c.y * 0.2)))
    * (1.0 - smoothstep(0.32, 0.49, abs(c.y)));
  float angle = vSeed * 6.283 + uTime * (0.7 + vSeed);
  vec2 leaf = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * c;
  leaf.x /= 0.55 + 0.45 * abs(sin(angle * 0.8));
  float width = 0.24 * max(0.0, 1.0 - abs(leaf.y) / 0.48);
  float autumn = (1.0 - smoothstep(width, width + 0.035, abs(leaf.x)))
    * (1.0 - smoothstep(0.42, 0.49, abs(leaf.y)));
  float curl = sin(c.y * 10.0 + vSeed * 6.283) * 0.13;
  float heat = (1.0 - smoothstep(0.025, 0.07, abs(c.x - curl)))
    * (1.0 - smoothstep(0.25, 0.48, abs(c.y)));
  float shape = snow * (1.0 - uWeather.x - uWeather.y - uWeather.z)
    + rain * uWeather.x + autumn * uWeather.y + heat * uWeather.z;
  float a = shape * vAlpha * mix(0.85, 0.26, uWeather.z);
  if (a < 0.01) discard;
  vec3 tint = uColour * (0.85 + 0.3 * vSeed);
  tint *= 1.0 - uWeather.y * 0.3 * (1.0 - smoothstep(0.01, 0.035, abs(leaf.x)));
  gl_FragColor = vec4(tint, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // Over the clouds (10) and the troops (12).
  points.renderOrder = 13;
  world.scene.add(points);
  const looks: Record<
    Season,
    {
      colour: string;
      fall: number;
      size: number;
      amount: number;
      weather: THREE.Vector3;
    }
  > = {
    spring: {
      colour: "#b8d7ee",
      fall: 4.2,
      size: 1.65,
      amount: 0.38,
      weather: new THREE.Vector3(1, 0, 0),
    },
    summer: {
      colour: "#ffe6ad",
      fall: -0.32,
      size: 4.5,
      amount: 0.1,
      weather: new THREE.Vector3(0, 0, 1),
    },
    autumn: {
      colour: "#e5a14a",
      fall: 0.55,
      size: 1.8,
      amount: 0.3,
      weather: new THREE.Vector3(0, 1, 0),
    },
    winter: {
      colour: "#f2f7ff",
      fall: 0.9,
      size: 1.05,
      amount: 1,
      weather: new THREE.Vector3(0, 0, 0),
    },
  };
  let goal = looks.spring;
  const goalColour = new THREE.Color(goal.colour);
  let reduced = false;
  let fall = goal.fall;
  let tracking = false;
  world.onFrame((dt) => {
    if (!reduced) {
      uniforms.uTime.value += dt;
      uniforms.uFallen.value += dt * fall;
      uniforms.uWind.value += dt * 0.35;
    }
    // Sizes are tuned for a 900 px tall view; scale with the real drawing buffer.
    uniforms.uPixels.value = world.pixelHeight / 900;
    const k = 1 - Math.exp(-dt * 1.5);
    uniforms.uAmount.value +=
      ((reduced ? 0 : goal.amount) - uniforms.uAmount.value) * k;
    fall += (goal.fall - fall) * k;
    uniforms.uSize.value += (goal.size - uniforms.uSize.value) * k;
    uniforms.uColour.value.lerp(goalColour, k);
    uniforms.uWeather.value.lerp(goal.weather, k);
    // Centred on the ground point in view (not the camera, which sits far behind it).
    const focus = world.focus;
    const spread = Math.max(1, focus.distance / 20);
    const centre = uniforms.uCentre.value;
    if (tracking) {
      // A pan by d shifts the wrap by -d / spread, so the final world position stays put.
      const offset = uniforms.uOffset.value;
      offset.x = (offset.x - (focus.x - centre.x) / spread) % 40;
      offset.y = (offset.y - (focus.z - centre.z) / spread) % 24;
    }
    tracking = true;
    centre.set(focus.x, 0, focus.z);
    uniforms.uSpread.value = spread;
    points.visible = uniforms.uAmount.value > 0.01;
  });
  return {
    set(season: Season) {
      goal = looks[season];
      goalColour.set(goal.colour);
    },
    setReducedMotion(value: boolean) {
      reduced = value;
      if (value) {
        uniforms.uAmount.value = 0;
        points.visible = false;
      }
    },
  };
}
