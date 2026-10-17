import * as THREE from "three";
import { world as shared } from "./shaders.ts";
import { createClouds } from "./sky.ts";
import { ISLAND_OFFSET } from "./hex.ts";
import { surfacesReady } from "./materials.ts";
import { worldSettings, type WorldSettings } from "../preferences.ts";

type Focus = { x: number; z: number; distance: number };

// Owns renderer, camera rig and frame loop. Content modules add themselves to `scene`.
export function createWorld(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    // Glowing structures mask their silhouette so only the halo around it shows.
    stencil: true,
  });
  // Lighter tier for phones and small or touch-first screens: lower pixel ratio and shadow map.
  const light =
    matchMedia("(pointer: coarse)").matches ||
    Math.min(innerWidth, innerHeight) < 700;
  let settings = worldSettings.parse({});
  const pixelRatio = () =>
    Math.min(
      devicePixelRatio,
      settings.resolution === "lower" ? 1 : light ? 1.5 : 2,
    );
  let resizes = 0;
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Shadow casters are static scenery and buildings, so the depth pass reruns only on change.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  let contextGeneration = 0;
  canvas.addEventListener("webglcontextlost", () => contextGeneration++);
  // A restored context (phones backgrounding the tab, GPU resets) needs the shadow pass again.
  canvas.addEventListener("webglcontextrestored", () => {
    renderer.shadowMap.needsUpdate = true;
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0a0f1a");
  const fog = new THREE.Fog("#0d1420", 38, 80);
  scene.fog = fog;

  const hemisphere = new THREE.HemisphereLight("#cfe3ff", "#3a4a2a", 1.15);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#fff1d6", 2.6);
  sun.position.set(-14, 22, 12);
  sun.castShadow = true;
  if (light) sun.shadow.mapSize.set(2048, 1024);
  else sun.shadow.mapSize.set(4096, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const clouds = createClouds();
  scene.add(clouds.group);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
  const pitch = THREE.MathUtils.degToRad(54);
  const focus: Focus = { x: -ISLAND_OFFSET, z: 0.6, distance: 20 };
  const goal: Focus = { ...focus };
  const limits = { minX: -24, maxX: 24, minZ: -8, maxZ: 8, near: 11, far: 42 };
  function placeCamera() {
    camera.position.set(
      focus.x,
      Math.sin(pitch) * focus.distance,
      focus.z + Math.cos(pitch) * focus.distance,
    );
    camera.lookAt(focus.x, 0, focus.z);
  }
  function clampGoal(far = limits.far) {
    goal.x = THREE.MathUtils.clamp(goal.x, limits.minX, limits.maxX);
    goal.z = THREE.MathUtils.clamp(goal.z, limits.minZ, limits.maxZ);
    goal.distance = THREE.MathUtils.clamp(goal.distance, limits.near, far);
  }

  // Drag with any button pans; wheel or a two-finger pinch zooms toward the pointer.
  let drag: { x: number; y: number; moved: number; id: number } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundPoint(clientX: number, clientY: number) {
    const rect = bounds;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(ground, hit) ? hit : null;
  }
  // When the player last panned or zoomed the camera themselves.
  let steeredAt = 0;
  // Scale the goal distance by `factor`, keeping the ground point under (clientX, clientY) in place.
  function zoomAt(clientX: number, clientY: number, factor: number) {
    steeredAt = performance.now();
    const anchor = groundPoint(clientX, clientY);
    const previous = goal.distance;
    goal.distance *= factor;
    // Battle framing may have pulled back past the zoom-out limit: the player's zoom never
    // jumps closer than they asked.
    const far = Math.max(limits.far, previous);
    clampGoal(far);
    if (!anchor) return;
    const kept = goal.distance / previous;
    goal.x = anchor.x - (anchor.x - goal.x) * kept;
    goal.z = anchor.z - (anchor.z - goal.z) * kept;
    clampGoal(far);
  }
  function fingerSpread() {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  // A press the game claims (picking up a structure) never starts a camera pan. Every touch is
  // still tracked, and a second finger is offered as a pinch so the game can let go.
  let pressClaim: ((event: PointerEvent, pinch: boolean) => boolean) | null =
    null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size >= 2) {
        pressClaim?.(event, true);
        pinch = touches.size === 2 ? fingerSpread() : 0;
        // A pinch is never a tap: keep the drag marked as moved so no tile is picked.
        if (drag) drag.moved = Infinity;
        return;
      }
    }
    if (pressClaim?.(event, false)) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      moved: 0,
      id: event.pointerId,
    };
  });
  addEventListener("pointermove", (event) => {
    const touch = touches.get(event.pointerId);
    if (touch) {
      touch.x = event.clientX;
      touch.y = event.clientY;
      // Several fingers never pan; exactly two pinch-zoom.
      if (touches.size >= 2) {
        if (touches.size === 2 && pinch > 0) {
          const spread = fingerSpread();
          const [a, b] = [...touches.values()];
          if (spread > 0 && a && b)
            zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch / spread);
          pinch = spread;
        }
        return;
      }
    }
    if (!drag || drag.id !== event.pointerId || !(event.buttons & 7)) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.moved < 6) return;
    steeredAt = performance.now();
    const k =
      (focus.distance * 0.0016 * 900 * settings.panSpeed) /
      Math.max(400, canvas.clientHeight);
    goal.x -= dx * k;
    goal.z -= (dy * k) / Math.sin(pitch);
    clampGoal(Math.max(limits.far, goal.distance));
  });
  const release = (event: PointerEvent) => {
    const pinching = touches.has(event.pointerId) && touches.size >= 2;
    touches.delete(event.pointerId);
    // Two fingers left after a third lifts start a fresh pinch from their current spread.
    pinch = touches.size === 2 ? fingerSpread() : 0;
    // Only the dragging pointer ends its drag (a tap elsewhere leaves a pan going), except
    // that lifting any pinch finger ends it: the drag origin went stale during the pinch.
    const ended = drag;
    if (!ended || (ended.id !== event.pointerId && !pinching)) return;
    // Cleared after the click handlers ran; a newer gesture's drag is left alone.
    setTimeout(() => {
      if (drag === ended) drag = null;
    }, 0);
  };
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(
        event.clientX,
        event.clientY,
        Math.exp(event.deltaY * 0.0012 * (settings.reverseWheel ? -1 : 1)),
      );
    },
    { passive: false },
  );
  const keys = new Set<string>();
  addEventListener("keydown", (event) => {
    // A held modifier means a shortcut; macOS also drops letter keyups while Cmd is down.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      keys.clear();
      return;
    }
    const target = event.target;
    // Text fields and sliders own every key; other focused controls (tile buttons) own arrows.
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
      return;
    if (
      event.key.startsWith("Arrow") &&
      target instanceof HTMLElement &&
      target !== document.body &&
      target !== canvas
    )
      return;
    keys.add(event.key.toLowerCase());
  });
  addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());
  const size = { w: 1, h: 1 };
  // Cached canvas rectangle for pointer picking (refreshed on resize and scroll).
  let bounds = canvas.getBoundingClientRect();
  addEventListener("scroll", () => (bounds = canvas.getBoundingClientRect()), {
    passive: true,
  });
  function resize() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    size.w = w;
    size.h = h;
    bounds = canvas.getBoundingClientRect();
    // Browser zoom or a monitor change can alter devicePixelRatio.
    if (renderer.getPixelRatio() !== pixelRatio())
      renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    resizes++;
    camera.aspect = w / h;
    // Keep the island framed on portrait screens.
    camera.fov = w / h < 1 ? 46 : 32;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  // A pixel-ratio change alone (another monitor) does not resize the box; watch it directly.
  const watchRatio = () =>
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        resize();
        watchRatio();
      },
      { once: true },
    );
  watchRatio();
  resize();

  const projected = new THREE.Vector3();
  const tickers = new Set<(dt: number, time: number) => void>();
  let last = performance.now();
  let reduced = false;
  let idle = false;
  let drawnAt = -Infinity;
  let drawnResize = -1;
  const drawnFocus = { ...focus };
  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduced) shared.uTime.value += dt;
    const speed = focus.distance * 0.9 * dt * settings.panSpeed;
    if (keys.size) {
      const { x, z } = goal;
      if (keys.has("a") || keys.has("arrowleft")) goal.x -= speed;
      if (keys.has("d") || keys.has("arrowright")) goal.x += speed;
      if (keys.has("w") || keys.has("arrowup")) goal.z -= speed;
      if (keys.has("s") || keys.has("arrowdown")) goal.z += speed;
      if (goal.x !== x || goal.z !== z) steeredAt = now;
      clampGoal(Math.max(limits.far, goal.distance));
    }
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 6);
    focus.x += (goal.x - focus.x) * ease;
    focus.z += (goal.z - focus.z) * ease;
    focus.distance += (goal.distance - focus.distance) * ease;
    placeCamera();
    // The haze keeps its depth from the camera when battle framing pulls back past the
    // player's zoom-out limit, so distant fighters are not dimmed.
    const beyond = Math.max(0, focus.distance - limits.far);
    fog.near = 38 + beyond;
    fog.far = 80 + beyond;
    for (const tick of tickers) tick(dt, now / 1000);
    // Keep late-loading art responsive without redrawing a motionless polis every rAF.
    if (
      !document.hidden &&
      (!reduced ||
        !idle ||
        now - drawnAt >= 100 ||
        drawnResize !== resizes ||
        drawnFocus.x !== focus.x ||
        drawnFocus.z !== focus.z ||
        drawnFocus.distance !== focus.distance)
    ) {
      renderer.render(scene, camera);
      drawnAt = now;
      drawnResize = resizes;
      Object.assign(drawnFocus, focus);
    }
    if (running) requestAnimationFrame(frame);
  }
  const visibilityWaiters = new Set<() => void>();
  let running = true;
  requestAnimationFrame(frame);

  return {
    get available() {
      return !renderer.getContext().isContextLost();
    },
    /** Ends the render loop for good (the page can no longer show a polis). */
    stop() {
      running = false;
      for (const shown of visibilityWaiters) shown();
    },
    /** Uploads a texture to the GPU now instead of on its first draw. */
    upload(texture: THREE.Texture) {
      if (renderer.getContext().isContextLost()) return false;
      renderer.initTexture(texture);
      return !renderer.getContext().isContextLost();
    },
    /**
     * Compiles every material now in the scene plus `extra`, in parallel where the GPU allows.
     * Shaders otherwise compile on first draw; the sea, clouds, weather, battle effects and a
     * rival's building surfaces first draw when a battle starts, which froze laptops for seconds.
     */
    async precompile(extra?: THREE.Object3D) {
      if (!running || renderer.getContext().isContextLost()) return false;
      const generation = contextGeneration;
      extra?.traverse((object) => (object.frustumCulled = false));
      if (extra) scene.add(extra);
      let compileTimer: ReturnType<typeof setTimeout> | undefined;
      let frameTimer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      try {
        // Surface decoding and compilation share one deadline; a timeout cannot unlock battle.
        const compiled = await Promise.race([
          (async () => {
            if (!(await surfacesReady())) return false;
            if (
              !running ||
              expired ||
              generation !== contextGeneration ||
              renderer.getContext().isContextLost()
            )
              return false;
            await renderer.compileAsync(scene, camera);
            return true;
          })(),
          new Promise<false>((done) => {
            compileTimer = setTimeout(() => {
              expired = true;
              done(false);
            }, 4000);
          }),
        ]);
        clearTimeout(compileTimer);
        if (!running || !compiled || generation !== contextGeneration)
          return false;
        // A hidden tab draws nothing. First wait until its first use can be shown.
        while (running && document.hidden)
          await new Promise<void>((resolve) => {
            const shown = () => {
              document.removeEventListener("visibilitychange", shown);
              visibilityWaiters.delete(shown);
              resolve();
            };
            visibilityWaiters.add(shown);
            document.addEventListener("visibilitychange", shown, {
              once: true,
            });
          });
        if (
          !running ||
          generation !== contextGeneration ||
          renderer.getContext().isContextLost()
        )
          return false;
        // First-use current geometry, including buildings outside the battle camera.
        const culled: THREE.Object3D[] = [];
        scene.traverse((object) => {
          if (object.frustumCulled) {
            culled.push(object);
            object.frustumCulled = false;
          }
        });
        renderer.shadowMap.needsUpdate = true;
        try {
          renderer.render(scene, camera);
        } finally {
          for (const object of culled) object.frustumCulled = true;
        }
        await new Promise((done) => {
          requestAnimationFrame(() => requestAnimationFrame(done));
          frameTimer = setTimeout(done, 500);
        });
        return (
          running &&
          generation === contextGeneration &&
          !renderer.getContext().isContextLost()
        );
      } finally {
        expired = true;
        clearTimeout(compileTimer);
        clearTimeout(frameTimer);
        if (extra) scene.remove(extra);
        renderer.shadowMap.needsUpdate = true;
      }
    },
    scene,
    camera,
    clouds,
    groundPoint,
    /** True when the last pointer interaction was a drag rather than a click. */
    dragged: () => (drag?.moved ?? 0) >= 6,
    claimPress(claim: (event: PointerEvent, pinch: boolean) => boolean) {
      pressClaim = claim;
    },
    onFrame(tick: (dt: number, time: number) => void) {
      tickers.add(tick);
      return () => tickers.delete(tick);
    },
    /** Ground point the camera looks at, and its distance. */
    get focus(): Readonly<Focus> {
      return focus;
    },
    /** When the player last panned or zoomed the camera (performance.now() time, 0 if never). */
    get steeredAt() {
      return steeredAt;
    },
    /** Camera distance at which `width` world units span the screen horizontally. */
    distanceForWidth(width: number) {
      const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
      return width / (2 * Math.tan(halfFov) * camera.aspect);
    },
    /** Fit world-space corners inside the band clear of the HUD and battle controls. */
    fitPoints(points: readonly THREE.Vector3[]): Focus {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const p of points) {
        const y = p.y * Math.cos(pitch) - p.z * Math.sin(pitch);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const x = THREE.MathUtils.clamp(
        (minX + maxX) / 2,
        limits.minX,
        limits.maxX,
      );
      const z = THREE.MathUtils.clamp(
        -(minY + maxY) / (2 * Math.sin(pitch)),
        limits.minZ,
        limits.maxZ,
      );
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      let distance = limits.near;
      for (const p of points) {
        const depth = p.y * Math.sin(pitch) + (p.z - z) * Math.cos(pitch);
        const y = p.y * Math.cos(pitch) - (p.z - z) * Math.sin(pitch);
        distance = Math.max(
          distance,
          Math.abs(p.x - x) / (tangent * camera.aspect * 0.94) + depth,
          Math.abs(y) / (tangent * 0.64) + depth,
        );
      }
      return { x, z, distance };
    },
    /** Move the camera goal; `far` may exceed the player's zoom-out limit (battle framing). */
    flyTo(next: Partial<Focus>, instant = false, far = limits.far) {
      Object.assign(goal, next);
      clampGoal(far);
      if (instant) Object.assign(focus, goal);
    },
    invalidateShadows() {
      renderer.shadowMap.needsUpdate = true;
    },
    /** Increments on every canvas resize, so screen-space labels know to reproject. */
    get resizes() {
      return resizes;
    },
    /** Drawing-buffer height in pixels, for screen-space sizes. */
    get pixelHeight() {
      return size.h * renderer.getPixelRatio();
    },
    setPreferences(next: WorldSettings) {
      const resolutionChanged = next.resolution !== settings.resolution;
      settings = next;
      if (resolutionChanged) resize();
    },
    setReducedMotion(value: boolean) {
      reduced = value;
    },
    setIdle(value: boolean) {
      idle = value;
    },
    /** Screen position of a world point; uses the cached canvas size (no layout reads). */
    project(point: THREE.Vector3) {
      projected.copy(point).project(camera);
      return {
        x: ((projected.x + 1) / 2) * size.w,
        y: ((1 - projected.y) / 2) * size.h,
        visible: projected.z < 1,
      };
    },
  };
}
export type World = ReturnType<typeof createWorld>;
