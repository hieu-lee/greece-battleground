import { appUrl } from "../urls.ts";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CombatEvent } from "../effects.ts";
import { projectileArc } from "../projectile-visual.ts";
import type { createCombat } from "../combat.ts";
import type { World } from "./world.ts";

type Kind =
  | "spark"
  | "fire"
  | "smoke"
  | "ward"
  | "glow"
  | "poison"
  | "thorn"
  | "stun"
  | "frost"
  | "haste";
type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  age: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
};

const MAX = 600;
const textureLoader = new THREE.TextureLoader();

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.6)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function poisonBubble() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Poison bubble canvas unavailable");
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(32, 32, 17, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

function stunStar() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Stun star canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radius = i % 2 === 0 ? 29 : 12;
    ctx.lineTo(32 + Math.cos(angle) * radius, 32 + Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

function frostCrystal() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Frost crystal canvas unavailable");
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.translate(32, 32);
  for (let arm = 0; arm < 6; arm++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -27);
    ctx.moveTo(-8, -17);
    ctx.lineTo(0, -10);
    ctx.lineTo(8, -17);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function hasteChevron() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Haste chevron canvas unavailable");
  ctx.translate(0, 64);
  ctx.scale(1, -1);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const y of [28, 48]) {
    ctx.beginPath();
    ctx.moveTo(13, y);
    ctx.lineTo(32, y - 18);
    ctx.lineTo(51, y);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function contactTexture(ring: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Weapon contact canvas unavailable");
  ctx.translate(128 * 0.727, 128 * 0.507);
  ctx.strokeStyle = "#ffe2a4";
  ctx.lineWidth = ring ? 3 : 6;
  ctx.beginPath();
  if (ring) ctx.arc(0, 0, 13, 0, Math.PI * 2);
  else ctx.arc(-24, 0, 24, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function missileGeometry(
  parts: readonly (readonly [THREE.BufferGeometry, string])[],
) {
  for (const [geometry, hex] of parts) {
    const color = new THREE.Color(hex);
    const colors = new Float32Array(
      geometry.getAttribute("position").count * 3,
    );
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  const merged = mergeGeometries(
    parts.map(([geometry]) => geometry),
    false,
  );
  for (const [geometry] of parts) geometry.dispose();
  return merged;
}

function system(texture: THREE.Texture, additive: boolean) {
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(MAX * 3);
  const colour = new Float32Array(MAX * 4);
  const size = new Float32Array(MAX);
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "tint",
    new THREE.BufferAttribute(colour, 4).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "size",
    new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uMap: { value: texture }, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
attribute vec4 tint; attribute float size; uniform float uScale; varying vec4 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale * projectionMatrix[1][1] / 3.49 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uMap; varying vec4 vTint;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vTint.rgb * t.rgb, t.a * vTint.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 15;
  const particles: Particle[] = [];
  let drawn = 0;
  let replace = 0;
  return {
    points,
    material,
    emit(p: Particle) {
      // Oldest particle makes way when the pool is full.
      if (particles.length >= MAX) particles[replace++ % MAX] = p;
      else particles.push(p);
    },
    clear() {
      particles.length = 0;
      drawn = replace = 0;
      geometry.setDrawRange(0, 0);
    },
    update(dt: number) {
      if (!particles.length && !drawn) return;
      let alive = 0;
      for (const p of particles) {
        p.age += dt;
        if (p.age >= p.life) continue;
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        particles[alive++] = p;
      }
      particles.length = alive;
      for (let n = 0; n < alive; n++) {
        const p = particles[n]!;
        const t = p.age / p.life;
        position[n * 3] = p.x;
        position[n * 3 + 1] = p.y;
        position[n * 3 + 2] = p.z;
        colour[n * 4] = p.r;
        colour[n * 4 + 1] = p.g;
        colour[n * 4 + 2] = p.b;
        colour[n * 4 + 3] =
          Math.min(1, (1 - t) * 1.6) * Math.min(1, t * 12 + 0.2);
        size[n] = p.size * (1 + p.grow * t);
      }
      drawn = alive;
      geometry.setDrawRange(0, alive);
      // Upload only the live prefix of each buffer.
      for (const [name, width] of [
        ["position", 3],
        ["tint", 4],
        ["size", 1],
      ] as const) {
        const attribute = geometry.attributes[name] as THREE.BufferAttribute;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, Math.max(1, alive) * width);
        attribute.needsUpdate = true;
      }
    },
  };
}

type Projectile = {
  mesh: THREE.Mesh;
  origin: THREE.Vector3 | null;
  heightGain: number;
};

export function createVfx(world: World, layer: HTMLElement) {
  const dot = softDot();
  const systems: Record<Kind, ReturnType<typeof system>> = {
    spark: system(dot, true),
    glow: system(dot, true),
    fire: system(dot, true),
    smoke: system(dot, false),
    ward: system(dot, true),
    poison: system(poisonBubble(), false),
    thorn: system(dot, true),
    stun: system(stunStar(), false),
    frost: system(frostCrystal(), false),
    haste: system(hasteChevron(), false),
  };
  systems.poison.material.depthTest = false;
  systems.thorn.material.depthTest = false;
  systems.stun.material.depthTest = false;
  systems.frost.material.depthTest = false;
  systems.haste.material.depthTest = false;
  for (const [kind, url] of [
    ["fire", "/vfx/fire.webp"],
    ["smoke", "/vfx/smoke.webp"],
    ["spark", "/vfx/spark.webp"],
    ["ward", "/vfx/ward.webp"],
  ] as const)
    textureLoader.load(appUrl(url), (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      systems[kind].material.uniforms.uMap!.value = t;
      if (kind === "spark") systems.thorn.material.uniforms.uMap!.value = t;
    });
  for (const s of Object.values(systems)) world.scene.add(s.points);
  // Projectiles run on battle time: playback speed scales it and pause stops it.
  let clock = 0;
  let rate = 1;
  const projectiles = new Map<number, Projectile>();
  let syncTroopProjectiles = () => {};
  const towerProjectiles = new Map<
    number,
    {
      mesh: THREE.Mesh;
      to: () => THREE.Vector3 | null;
      speed: number;
      clock: number;
    }
  >();
  const bolts: {
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    start: number;
  }[] = [];
  const arrowGeometry = missileGeometry([
    [
      new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4)
        .rotateZ(Math.PI / 2)
        .translate(0.03, 0, 0),
      "#6f4728",
    ],
    [
      new THREE.ConeGeometry(0.02, 0.06, 4)
        .rotateZ(Math.PI / 2)
        .translate(-0.15, 0, 0),
      "#d8ac62",
    ],
    [new THREE.BoxGeometry(0.09, 0.05, 0.006).translate(0.12, 0, 0), "#e8dfc6"],
    [
      new THREE.BoxGeometry(0.09, 0.05, 0.006)
        .rotateX(Math.PI / 2)
        .translate(0.12, 0, 0),
      "#e8dfc6",
    ],
  ]);
  const arrowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const boltGeometry = new THREE.BufferGeometry();
  boltGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(9 * 3), 3),
  );
  const boltMaterial = new THREE.LineBasicMaterial({
    color: "#a7e4ff",
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const missiles = {
    arrow: { geometry: arrowGeometry, material: arrowMaterial },
    javelin: {
      geometry: missileGeometry([
        [
          new THREE.CylinderGeometry(0.022, 0.022, 0.5, 5)
            .rotateZ(Math.PI / 2)
            .translate(0.06, 0, 0),
          "#7a5532",
        ],
        [
          new THREE.ConeGeometry(0.038, 0.12, 5)
            .rotateZ(Math.PI / 2)
            .translate(-0.25, 0, 0),
          "#d8ac62",
        ],
      ]),
      material: arrowMaterial,
    },
    fire: {
      geometry: new THREE.SphereGeometry(0.1, 10, 8),
      material: new THREE.MeshBasicMaterial({ color: "#ffb24a" }),
    },
  };
  const numbers: {
    el: HTMLElement;
    at: THREE.Vector3;
    age: number;
    life: number;
  }[] = [];
  let reduced = false;
  const contactRing = contactTexture(true);
  let kopisTexture: THREE.Texture = contactTexture(false);
  const kopisMaterial = new THREE.SpriteMaterial({
    map: kopisTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const contacts: {
    sprite: THREE.Sprite;
    source: THREE.Vector3;
    start: number;
    static: boolean;
  }[] = [];
  textureLoader.load(appUrl("/vfx/kopis.webp"), (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    kopisTexture = texture;
    kopisMaterial.map = texture;
    for (const contact of contacts)
      if (!contact.static) contact.sprite.material.map = texture;
  });

  function kopis(source: THREE.Vector3, target: THREE.Vector3) {
    let contact = contacts.find((c) => !c.sprite.visible);
    if (!contact) {
      if (contacts.length >= 96) return;
      const sprite = new THREE.Sprite(kopisMaterial.clone());
      // Match the painted contact registration in the classic renderer; Sprite V points up.
      sprite.center.set(0.727, 0.493);
      sprite.renderOrder = 16;
      world.scene.add(sprite);
      contact = {
        sprite,
        source: new THREE.Vector3(),
        start: 0,
        static: false,
      };
      contacts.push(contact);
    }
    contact.start = clock;
    contact.static = reduced;
    contact.source.copy(source);
    contact.sprite.position.copy(target);
    contact.sprite.scale.setScalar(1.9);
    contact.sprite.material.map = reduced ? contactRing : kopisTexture;
    contact.sprite.material.opacity = reduced ? 0.55 : 1;
    contact.sprite.visible = true;
  }

  function burst(
    kind: Kind,
    at: THREE.Vector3,
    count: number,
    options: Partial<Particle> & { spread?: number; speed?: number } = {},
  ) {
    const spread = options.spread ?? 0.08;
    const speed = options.speed ?? 1.2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      systems[kind].emit({
        x: at.x + (Math.random() - 0.5) * spread,
        y: at.y + (Math.random() - 0.5) * spread,
        z: at.z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * speed * (0.4 + Math.random() * 0.6),
        vy: up * speed * 1.2,
        vz: Math.sin(a) * speed * (0.4 + Math.random() * 0.6),
        life: 0.35 + Math.random() * 0.3,
        age: 0,
        size: 0.12,
        grow: 0.5,
        r: 1,
        g: 0.85,
        b: 0.55,
        gravity: 3,
        ...options,
      });
    }
  }

  function warded(at: THREE.Vector3) {
    burst("ward", at, 8, {
      r: 0.6,
      g: 0.85,
      b: 1,
      size: 0.3,
      speed: 0.4,
      gravity: 0,
      life: 0.5,
    });
    floating("Blocked", at, "blocked");
  }
  function floating(text: string, at: THREE.Vector3, className: string) {
    if (
      reduced &&
      className !== "crit" &&
      className !== "stun" &&
      className !== "frost" &&
      className !== "haste" &&
      className !== "insight"
    )
      return;
    if (numbers.length > 60) numbers.shift()?.el.remove();
    const el = document.createElement("span");
    el.className = "float-number " + className;
    if (className === "thorn") el.style.color = "#d1f57e";
    if (className === "insight") {
      el.style.color = "#71c8ff";
      el.style.fontSize = "15px";
    }
    el.textContent = text;
    el.style.transform = "translate(-999px, -999px)";
    layer.append(el);
    numbers.push({
      el,
      at: at.clone(),
      age: 0,
      life: className === "insight" ? 1.4 : 0.9,
    });
  }

  const scratchA = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  let frameElapsed = 0;
  function syncProjectiles() {
    for (const [id, projectile] of towerProjectiles) {
      const to = projectile.to();
      if (!to) {
        world.scene.remove(projectile.mesh);
        towerProjectiles.delete(id);
        continue;
      }
      const distance = projectile.mesh.position.distanceTo(to);
      const travel = projectile.speed * (clock - projectile.clock);
      projectile.clock = clock;
      projectile.mesh.lookAt(to);
      projectile.mesh.rotateY(Math.PI / 2);
      if (distance > 0)
        projectile.mesh.position.lerp(to, Math.min(1, travel / distance));
    }
    syncTroopProjectiles();
  }
  world.onFrame((dt) => {
    const elapsed = dt * rate;
    frameElapsed = elapsed;
    clock += elapsed;
    // Keep particle sizes proportional to the viewport at any pixel ratio.
    for (const s of Object.values(systems))
      s.material.uniforms.uScale!.value = world.pixelHeight * 0.67;
    if (elapsed > 0) for (const s of Object.values(systems)) s.update(elapsed);
    for (let i = numbers.length - 1; i >= 0; i--) {
      const n = numbers[i]!;
      n.age += elapsed;
      if (n.age >= n.life) {
        n.el.remove();
        numbers.splice(i, 1);
        continue;
      }
      const at = scratchA.copy(n.at);
      const still =
        reduced &&
        (n.el.classList.contains("stun") ||
          n.el.classList.contains("frost") ||
          n.el.classList.contains("haste") ||
          n.el.classList.contains("insight"));
      at.y += 0.9 + (still ? 0 : n.age * 0.9);
      const s = world.project(at);
      n.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${still ? 1 : 1 + Math.max(0, 0.25 - n.age) * 2})`;
      n.el.style.opacity = String(Math.min(1, (n.life - n.age) * 4));
    }
    for (const contact of contacts) {
      if (!contact.sprite.visible) continue;
      const age = (clock - contact.start) / 0.38;
      if (age >= 1) {
        contact.sprite.visible = false;
        continue;
      }
      const from = world.project(contact.source);
      const to = world.project(contact.sprite.position);
      contact.sprite.material.rotation = contact.static
        ? 0
        : Math.atan2(from.y - to.y, to.x - from.x);
      contact.sprite.material.opacity = (contact.static ? 0.55 : 1) * (1 - age);
    }
    for (const bolt of bolts) {
      if (!bolt.line.visible) continue;
      const age = (clock - bolt.start) / 0.22;
      bolt.line.visible = age < 1;
      bolt.line.material.opacity = Math.max(0, 1 - age);
    }
  });

  function lightning(source: THREE.Vector3, target: THREE.Vector3) {
    if (reduced) return;
    let bolt = bolts.find((entry) => !entry.line.visible);
    if (!bolt) {
      if (bolts.length >= 96) return;
      const line = new THREE.Line(boltGeometry.clone(), boltMaterial.clone());
      line.frustumCulled = false;
      line.renderOrder = 16;
      world.scene.add(line);
      bolt = { line, start: clock };
      bolts.push(bolt);
    }
    bolt.start = clock;
    bolt.line.visible = true;
    bolt.line.material.opacity = 1;
    const positions = bolt.line.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const t = i / (positions.count - 1);
      const point = scratchA.copy(source).lerp(target, t);
      if (i > 0 && i < positions.count - 1)
        point.y += (i % 2 === 0 ? -1 : 1) * 0.16;
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    burst("glow", target, 3, {
      r: 0.65,
      g: 0.89,
      b: 1,
      size: 0.28,
      speed: 0.4,
      gravity: 0,
      life: 0.22,
    });
  }

  return {
    syncProjectiles,
    /** Warm projectile and painted-contact shaders before their first battle use. */
    sample() {
      const group = new THREE.Group();
      const contact = new THREE.Sprite(kopisMaterial);
      contact.scale.setScalar(0.001);
      group.add(
        new THREE.Mesh(arrowGeometry, arrowMaterial),
        new THREE.Mesh(missiles.fire.geometry, missiles.fire.material),
        new THREE.Line(boltGeometry, boltMaterial),
        contact,
      );
      return group;
    },
    setReducedMotion(value: boolean) {
      reduced = value;
      if (value) for (const contact of contacts) contact.sprite.visible = false;
      if (value) {
        for (const projectile of projectiles.values())
          world.scene.remove(projectile.mesh);
        projectiles.clear();
        for (const projectile of towerProjectiles.values())
          world.scene.remove(projectile.mesh);
        towerProjectiles.clear();
        for (const bolt of bolts) bolt.line.visible = false;
      }
    },
    /** Battle playback rate for effects (0 while paused). */
    setRate(value: number) {
      rate = value;
    },
    /** Presentation for one authoritative combat event. */
    combat(
      event: CombatEvent,
      toWorld: (p: { x: number; y: number }) => THREE.Vector3,
      combat: ReturnType<typeof createCombat>,
      bodyPoint: (
        unit: number,
        position: { x: number; y: number },
      ) => THREE.Vector3 | null,
      sourcePoint: (unit: number) => THREE.Vector3 | null,
    ) {
      const release = (p: { x: number; y: number }) =>
        toWorld(p).add(new THREE.Vector3(0, 0.62, 0));
      syncTroopProjectiles = () => {
        const active = new Set<number>();
        if (!reduced && !combat.result)
          for (const shot of combat.projectiles) {
            const unit = combat.units[shot.from];
            const target = combat.units[shot.to];
            if (!unit || !target) continue;
            active.add(shot.id);
            let displayed = projectiles.get(shot.id);
            if (!displayed) {
              const missile =
                missiles[
                  unit.sprite === "drakon"
                    ? "fire"
                    : unit.sprite === "tracker"
                      ? "arrow"
                      : "javelin"
                ];
              displayed = {
                mesh: new THREE.Mesh(missile.geometry, missile.material),
                origin: null,
                heightGain: 0,
              };
              world.scene.add(displayed.mesh);
              projectiles.set(shot.id, displayed);
            }
            const destination = bodyPoint(shot.to, target) ?? release(target);
            if (shot.kind === "held") {
              const at = sourcePoint(shot.from) ?? release(unit);
              displayed.mesh.position.copy(at);
              displayed.mesh.lookAt(destination);
              displayed.mesh.rotateY(Math.PI / 2);
            } else {
              if (!displayed.origin) {
                displayed.origin =
                  sourcePoint(shot.from) ?? release(shot.source);
                displayed.mesh.position.copy(displayed.origin);
                const launch = combat.events.findLast(
                  (event) =>
                    event.kind === "launch" && event.projectileId === shot.id,
                );
                if (launch?.kind === "launch") {
                  const distance = Math.hypot(
                    launch.target.x - launch.source.x,
                    launch.target.y - launch.source.y,
                  );
                  const scale = toWorld({ x: 1, y: 0 }).distanceTo(
                    toWorld({ x: 0, y: 0 }),
                  );
                  displayed.heightGain =
                    distance * scale * shot.heightPerDistance;
                }
              }
              const progress = shot.progress;
              const pos = toWorld(shot.position);
              const originOffset = scratchA
                .copy(displayed.origin)
                .sub(toWorld(shot.source));
              pos.addScaledVector(originOffset, 1 - progress);
              pos.addScaledVector(
                destination.clone().sub(toWorld(target)),
                progress,
              );
              pos.y += projectileArc(progress) * displayed.heightGain;
              const previous = scratchB.copy(displayed.mesh.position);
              displayed.mesh.position.copy(pos);
              if (previous.distanceToSquared(pos) > 0) {
                displayed.mesh.lookAt(
                  previous.multiplyScalar(-1).addScaledVector(pos, 2),
                );
                displayed.mesh.rotateY(Math.PI / 2);
              } else if (progress === 0) {
                displayed.mesh.lookAt(destination);
                displayed.mesh.rotateY(Math.PI / 2);
              }
              if (unit.sprite === "drakon" && frameElapsed > 0)
                burst("fire", pos, 1, {
                  r: 1,
                  g: 0.6,
                  b: 0.2,
                  size: 0.2,
                  speed: 0.2,
                  gravity: -1,
                  life: 0.35,
                });
            }
          }
        for (const [id, projectile] of projectiles)
          if (!active.has(id)) {
            world.scene.remove(projectile.mesh);
            projectiles.delete(id);
          }
      };
      switch (event.kind) {
        case "attack": {
          if (event.from === null) {
            const target = combat.units[event.to];
            if (reduced || event.effect !== "arrow" || !target) break;
            const mesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
            mesh.position.copy(release(event.source));
            world.scene.add(mesh);
            const unit = toWorld({ x: event.source.x + 1, y: event.source.y });
            towerProjectiles.set(event.projectileId, {
              mesh,
              to: () =>
                !combat.result && target.life.kind !== "dead"
                  ? bodyPoint(event.to, target)
                  : null,
              speed: unit.distanceTo(toWorld(event.source)) * 7.5,
              clock,
            });
            break;
          }

          break;
        }
        case "launch":
          break;
        case "impact": {
          if (event.from !== null && event.projectileId !== undefined) {
            const projectile = projectiles.get(event.projectileId);
            if (projectile) world.scene.remove(projectile.mesh);
            projectiles.delete(event.projectileId);
          }
          if (event.from === null) {
            const projectile = towerProjectiles.get(event.projectileId);
            if (projectile) {
              world.scene.remove(projectile.mesh);
              towerProjectiles.delete(event.projectileId);
            }
          }
          const at = bodyPoint(event.to, event.target);
          if (!at) break;
          if (event.effect === "lightning")
            lightning(release(event.source), at);
          // A Ward absorbs the blow, but any Burn on the attack still takes hold.
          if (event.blocked) warded(at);
          else {
            const thorn = event.reflection === true;
            if (event.effect === "kopis") kopis(release(event.source), at);
            if (thorn) {
              burst("thorn", at, reduced ? 1 : 10, {
                r: 0.8,
                g: 1,
                b: 0.36,
                size: reduced ? 0.4 : 0.24,
                speed: reduced ? 0 : 0.9,
                gravity: 0,
                spread: reduced ? 0 : 0.12,
                grow: reduced ? 0 : 0.8,
                life: 0.48,
              });
            } else
              burst("spark", at, event.critical ? 16 : 7, {
                r: event.critical ? 1 : event.armorDamage > 0 ? 0.6 : 1,
                g: event.critical ? 0.95 : 0.8,
                b: event.critical ? 0.5 : event.armorDamage > 0 ? 1 : 0.55,
                size: event.critical ? 0.16 : 0.1,
                speed: event.critical ? 2 : 1.3,
              });
            if (
              !reduced &&
              !thorn &&
              !event.critical &&
              event.armorDamage === 0 &&
              event.effect === "spear"
            )
              burst("spark", at, 1, {
                r: 1,
                g: 1,
                b: 1,
                size: 0.6,
                speed: 0,
                gravity: 0,
                spread: 0,
                grow: 0,
                life: 0.18,
              });
            if (event.critical)
              burst("glow", at, 1, {
                size: 0.9,
                speed: 0,
                gravity: 0,
                life: 0.25,
                r: 1,
                g: 0.9,
                b: 0.5,
              });
            // `damage` already includes what the armour absorbed (`armorDamage`).
            const total = Math.round(event.damage);
            if (total > 0)
              floating(
                (thorn ? "THORN " : "") + total,
                at,
                event.critical
                  ? "crit"
                  : thorn
                    ? "thorn"
                    : event.armorDamage >= event.damage
                      ? "armor"
                      : "damage",
              );
          }
          if (event.burnApplied > 0 || event.effect === "fire")
            burst("fire", at, 6, {
              r: 1,
              g: 0.55,
              b: 0.18,
              size: 0.22,
              gravity: -1.5,
              speed: 0.4,
            });
          break;
        }
        case "stun": {
          const at = bodyPoint(event.unit, event.target);
          if (!at) break;
          at.y += 0.45;
          burst("stun", at, reduced ? 1 : 5, {
            r: 0.84,
            g: 0.68,
            b: 1,
            size: reduced ? 0.36 : 0.24,
            grow: 0,
            speed: reduced ? 0 : 0.45,
            vy: 0,
            spread: reduced ? 0 : 0.4,
            gravity: 0,
            life: 0.55,
          });
          floating("STUN", at, "stun");
          break;
        }
        case "frost": {
          const at = bodyPoint(event.unit, event.target);
          if (!at) break;
          at.y += 0.45;
          burst("frost", at, reduced ? 1 : event.frozen ? 8 : 4, {
            r: 0.6,
            g: 0.88,
            b: 1,
            size: reduced ? 0.5 : event.frozen ? 0.36 : 0.25,
            grow: 0,
            speed: reduced ? 0 : 0.4,
            vy: 0,
            spread: reduced ? 0 : 0.35,
            gravity: 0,
            life: 0.7,
          });
          floating(
            event.frozen ? "FREEZE" : `FROST +${event.amount}`,
            at,
            "frost",
          );
          break;
        }
        case "haste": {
          const at = bodyPoint(event.unit, event.target);
          if (!at) break;
          at.y += 0.45;
          burst("haste", at, reduced ? 1 : 4, {
            r: 1,
            g: 0.78,
            b: 0.3,
            size: reduced ? 0.45 : 0.3,
            grow: 0,
            speed: reduced ? 0 : 0.2,
            vy: reduced ? 0 : 0.45,
            spread: reduced ? 0 : 0.35,
            gravity: 0,
            life: 0.65,
          });
          floating("HASTE", at, "haste");
          break;
        }
        case "poison": {
          const at = bodyPoint(event.unit, event.target);
          if (!at) break;
          if (event.blocked) {
            warded(at);
            break;
          }
          burst("poison", at, reduced ? 1 : 7, {
            r: 0.47,
            g: 0.9,
            b: 0.74,
            size: reduced ? 0.5 : 0.36,
            grow: reduced ? 0 : 0.45,
            speed: reduced ? 0 : 0.6,
            vy: reduced ? 0 : 0.12,
            spread: reduced ? 0 : 0.7,
            gravity: 0,
            life: 0.7,
          });
          floating("POISON " + Math.round(event.amount), at, "poison");
          break;
        }
        case "burn": {
          const at = bodyPoint(event.unit, event.target);
          if (!at) break;
          if (event.blocked) {
            warded(at);
            break;
          }
          burst("fire", at, 5, {
            r: 1,
            g: 0.5,
            b: 0.15,
            size: 0.25,
            gravity: -1.8,
            speed: 0.3,
            life: 0.6,
          });
          floating(String(Math.round(event.amount)), at, event.kind);
          break;
        }
        case "insight": {
          const at =
            bodyPoint(event.unit, event.target) ?? release(event.target);
          at.y += 0.55;
          burst("glow", at, reduced ? 1 : 6, {
            r: 0.44,
            g: 0.78,
            b: 1,
            size: reduced ? 0.4 : 0.16,
            gravity: 0,
            speed: reduced ? 0 : 0.35,
            life: 0.7,
          });
          floating(`+${event.amount} YOUR INSIGHT`, at, "insight");
          break;
        }
        case "heal":
        case "revive": {
          if (
            event.kind === "revive" &&
            combat.units[event.unit]!.sprite === "elysian-champion"
          ) {
            if (!reduced)
              burst(
                "smoke",
                toWorld(event.target).add(new THREE.Vector3(0, 0.05, 0)),
                10,
                {
                  r: 0.75,
                  g: 0.7,
                  b: 0.6,
                  size: 0.25,
                  grow: 1,
                  gravity: -0.2,
                  speed: 0.35,
                  life: 0.5,
                },
              );
            const at = bodyPoint(event.unit, event.target);
            if (at) floating("+" + Math.round(event.amount), at, "heal");
            break;
          }
          const at = bodyPoint(event.unit, event.target);
          if (!at) break;
          burst("glow", at, 8, {
            r: 0.5,
            g: 1,
            b: 0.55,
            size: 0.12,
            gravity: -1.2,
            speed: 0.4,
            life: 0.8,
          });
          floating("+" + Math.round(event.amount), at, "heal");
          break;
        }
        case "death": {
          const at = toWorld(event.target).add(new THREE.Vector3(0, 0.1, 0));
          burst("smoke", at, 10, {
            r: 0.75,
            g: 0.7,
            b: 0.6,
            size: 0.45,
            grow: 1.5,
            gravity: -0.3,
            speed: 0.5,
            life: 0.9,
          });
          break;
        }
        case "footstep": {
          if (reduced || combat.units.length > 40) break;
          const at = toWorld(event.target).add(new THREE.Vector3(0, 0.03, 0));
          burst("smoke", at, 1, {
            r: 0.7,
            g: 0.62,
            b: 0.48,
            size: 0.18,
            grow: 1,
            gravity: -0.1,
            speed: 0.15,
            life: 0.5,
          });
          break;
        }
      }
    },
    /** A pillar of light where a structure was placed or upgraded. */
    placement(at: THREE.Vector3, upgrade: boolean) {
      burst("glow", at.clone().add(new THREE.Vector3(0, 0.3, 0)), 1, {
        size: 3,
        speed: 0,
        gravity: 0,
        life: 0.45,
        r: 1,
        g: 0.9,
        b: 0.6,
      });
      burst(
        "spark",
        at.clone().add(new THREE.Vector3(0, 0.2, 0)),
        upgrade ? 40 : 24,
        {
          spread: 1.2,
          speed: 1.6,
          gravity: 2,
          size: 0.12,
          life: 0.9,
          r: 1,
          g: 0.86,
          b: 0.5,
        },
      );
      burst("smoke", at.clone().add(new THREE.Vector3(0, 0.05, 0)), 12, {
        spread: 1.3,
        speed: 0.6,
        gravity: -0.2,
        size: 0.6,
        grow: 1.2,
        life: 1,
        r: 0.85,
        g: 0.8,
        b: 0.7,
      });
    },
    clear() {
      for (const s of Object.values(systems)) s.clear();
      for (const contact of contacts) contact.sprite.visible = false;
      for (const p of projectiles.values()) world.scene.remove(p.mesh);
      projectiles.clear();
      syncTroopProjectiles = () => {};
      for (const projectile of towerProjectiles.values())
        world.scene.remove(projectile.mesh);
      towerProjectiles.clear();
      for (const bolt of bolts) bolt.line.visible = false;
      for (const n of numbers) n.el.remove();
      numbers.length = 0;
    },
  };
}
export type Vfx = ReturnType<typeof createVfx>;
