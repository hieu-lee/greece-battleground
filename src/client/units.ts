import * as THREE from "three";
import { frameCount, sheet } from "./sprites.ts";
import type { Sheet } from "./sprites.ts";
import { requiredTroopPoses } from "../troop-poses.ts";
import type { TroopPose } from "../troop-poses.ts";
import type { World } from "./world.ts";
import { projectileSockets } from "./projectile-sockets.ts";

// World height of one sprite "unit" (the manifest's pixelsPerUnit space).
const WORLD_PER_UNIT = 0.4;

type PaintedBody = { x: number; y: number; width: number; height: number };
const paintedFrames = new WeakMap<THREE.Texture, Map<number, PaintedBody>>();
function frameBody(sheet: Sheet, frame: number) {
  let frames = paintedFrames.get(sheet.texture);
  const cached = frames?.get(frame);
  if (cached) return cached;
  const image: unknown = sheet.texture.image;
  if (!(image instanceof HTMLImageElement))
    throw new Error("Troop contact registration needs loaded artwork");
  const canvas = document.createElement("canvas");
  canvas.width = sheet.data.frameWidth;
  canvas.height = sheet.data.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Troop contact registration is unavailable");
  context.drawImage(image, -frame * canvas.width, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let weight = 0,
    xsum = 0,
    ysum = 0;
  let minX = canvas.width,
    maxX = 0,
    minY = canvas.height,
    maxY = 0;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const alpha = pixels[(y * canvas.width + x) * 4 + 3]!;
      if (alpha > 48) {
        xsum += (x + 0.5) * alpha;
        ysum += (y + 0.5) * alpha;
        weight += alpha;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  if (!weight) throw new Error("Troop contact artwork is empty");
  const body = {
    x: xsum / weight,
    y: ysum / weight,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  if (!frames) {
    frames = new Map();
    paintedFrames.set(sheet.texture, frames);
  }
  frames.set(frame, body);
  return body;
}
function idleBodyHeight(sheet: Sheet) {
  return (
    ((sheet.data.anchor[1] - frameBody(sheet, 0).y) /
      sheet.data.pixelsPerUnit) *
    WORLD_PER_UNIT
  );
}

const shadowTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    r.addColorStop(0, "rgba(0,0,0,0.55)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
})();
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: shadowTexture,
  transparent: true,
  depthWrite: false,
});
const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const ringGeometry = new THREE.RingGeometry(0.3, 0.38, 24).rotateX(
  -Math.PI / 2,
);

export type Billboard = ReturnType<typeof createBillboard>;

// A painted 2D unit standing in the 3D world: sprite plane facing the camera plus a ground shadow.
// `footprint` scales the shadow and ring (a Big body), `scale` the sprite.
export function createBillboard(
  base: string,
  uploadTexture: World["upload"],
  scale = 1,
  footprint = scale,
) {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.08,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const revivalFlash = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRevivalFlashStrength = revivalFlash;
    shader.uniforms.uRevivalFlashColor = {
      value: new THREE.Color(
        1.495396375656128,
        1.4980391263961792,
        0.9539400935173035,
      ),
    };
    shader.fragmentShader =
      "uniform float uRevivalFlashStrength; uniform vec3 uRevivalFlashColor;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uRevivalFlashColor, uRevivalFlashStrength);",
      );
  };
  const plane = new THREE.Mesh(geometry, material);
  // After the clouds (10), like its shadow and ring (11): a fighter marching through fogged
  // tiles stays in sight.
  plane.renderOrder = 12;
  // Hidden until its sprite sheet arrives, so no untextured quad flashes.
  plane.visible = false;
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.scale.setScalar(0.9 * footprint);
  shadow.position.y = 0.015;
  shadow.renderOrder = 11;
  const ring = new THREE.Mesh(
    ringGeometry,
    new THREE.MeshBasicMaterial({
      color: "#8fe08a",
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    }),
  );
  ring.position.y = 0.02;
  ring.renderOrder = 11;
  ring.visible = false;
  ring.scale.setScalar(footprint);
  group.add(shadow, ring, plane);
  const sheets = new Map<TroopPose, Sheet>();
  let status: "loading" | "ready" | "failed" = "loading";
  let disposed = false;
  let headroom = 0;
  let bodyHeight = 0;
  let frameBounds = { left: 0, right: 0, bottom: 0, top: 0 };
  const poses = requiredTroopPoses(base);
  function upload() {
    if (disposed || status === "failed" || sheets.size !== poses.length) return;
    status = "loading";
    try {
      for (const s of sheets.values()) if (!uploadTexture(s.texture)) return;
    } catch {
      status = "failed";
      shadow.visible = false;
      plane.visible = false;
      return;
    }
    status = "ready";
    shadow.visible = true;
    plane.visible = true;
    show("idle", 0, 1);
  }
  function load() {
    status = "loading";
    sheets.clear();
    void Promise.all(
      poses.map(async (pose) => {
        const s = await sheet(`${base}-${pose}`);
        return { pose, s };
      }),
    )
      .then((loaded) => {
        if (disposed) return;
        for (const { pose, s } of loaded) {
          sheets.set(pose, s);
          if (pose === "idle") bodyHeight = idleBodyHeight(s) * scale;
        }
        headroom = Math.max(
          ...loaded.map(
            ({ s }) =>
              (s.data.anchor[1] / s.data.pixelsPerUnit) *
              WORLD_PER_UNIT *
              scale,
          ),
        );
        const extent = Math.max(
          ...loaded.flatMap(({ s }) => {
            const k = (WORLD_PER_UNIT / s.data.pixelsPerUnit) * scale;
            return [
              s.data.anchor[0] * k,
              (s.data.frameWidth - s.data.anchor[0]) * k,
            ];
          }),
        );
        frameBounds = {
          left: -extent,
          right: extent,
          bottom: Math.min(
            ...loaded.map(
              ({ s }) =>
                ((s.data.anchor[1] - s.data.height) / s.data.pixelsPerUnit) *
                WORLD_PER_UNIT *
                scale,
            ),
          ),
          top: headroom,
        };
        upload();
      })
      .catch(() => {
        if (disposed) return;
        status = "failed";
        shadow.visible = false;
        plane.visible = false;
      });
  }
  load();
  let currentPose: TroopPose | null = null;
  let currentFrame = -1;
  let currentFacing = 0;
  let grounded = false;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  // Frames are picked by rewriting this plane's four UVs, so every unit shares one uploaded sheet.
  function show(pose: TroopPose, frame: number, facing: number) {
    if (status !== "ready") return;
    const s = sheets.get(pose);
    if (!s) return;
    if (pose !== currentPose) {
      // Only the first texture changes the shader program; later swaps reuse it.
      if (!material.map) material.needsUpdate = true;
      material.map = s.texture;
      const { data } = s;
      const k = (WORLD_PER_UNIT / data.pixelsPerUnit) * scale;
      plane.scale.set(data.frameWidth * k, data.height * k, 1);
      // Anchor the feet (manifest anchor) at the group origin.
      anchor[0] = 0.5 - data.anchor[0] / data.frameWidth;
      anchor[1] = data.anchor[1] / data.height - 0.5;
      currentPose = pose;
      currentFrame = -1;
    }
    const frames = frameCount(s.data);
    const f = Math.max(0, Math.min(frames - 1, frame));
    if (f === currentFrame && facing === currentFacing) return;
    const left = f / frames,
      right = (f + 1) / frames;
    const [u0, u1] = facing < 0 ? [right, left] : [left, right];
    // PlaneGeometry UV order: top-left, top-right, bottom-left, bottom-right.
    uv.setX(0, u0);
    uv.setX(1, u1);
    uv.setX(2, u0);
    uv.setX(3, u1);
    uv.needsUpdate = true;
    grounded =
      pose === "death" &&
      s.data.kind === "animation" &&
      s.data.groundedFromFrame !== undefined &&
      f >= s.data.groundedFromFrame;
    if (grounded) {
      const body = frameBody(s, f);
      anchor[0] = 0.5 - body.x / s.data.frameWidth;
      anchor[1] = body.y / s.data.height - 0.5;
      const k = (WORLD_PER_UNIT / s.data.pixelsPerUnit) * scale;
      shadow.scale.set(body.width * k, 1, body.height * k);
    } else {
      anchor[0] = 0.5 - s.data.anchor[0] / s.data.frameWidth;
      anchor[1] = s.data.anchor[1] / s.data.height - 0.5;
      shadow.scale.setScalar(0.9 * footprint);
    }
    currentFrame = f;
    currentFacing = facing;
  }
  const anchor: [number, number] = [0, -0.5];
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  return {
    group,
    sheetData(pose: TroopPose) {
      return sheets.get(pose)?.data ?? null;
    },
    show,
    flash(strength: number) {
      revivalFlash.value = strength;
    },
    upload,
    get status() {
      return status;
    },
    projectileOrigin() {
      const socket =
        status === "ready" && currentPose !== null
          ? projectileSockets[base]?.[currentPose]?.[currentFrame]
          : undefined;
      if (!socket) return null;
      plane.updateWorldMatrix(true, false);
      return plane.localToWorld(
        new THREE.Vector3(
          (socket[0] - 0.5) * (currentFacing < 0 ? -1 : 1),
          0.5 - socket[1],
          0,
        ),
      );
    },
    get bodyHeight() {
      return status === "ready" ? bodyHeight : null;
    },
    get headroom() {
      return headroom;
    },
    get frameBounds(): Readonly<typeof frameBounds> {
      return frameBounds;
    },
    retry() {
      if (!disposed && status === "failed") load();
    },
    ring(colour: string | null) {
      const m = ring.material as THREE.MeshBasicMaterial;
      ring.visible = colour !== null;
      m.opacity = 0.75;
      if (colour) m.color.set(colour);
    },
    /** Orient toward the camera; call every frame. */
    face(camera: THREE.Camera) {
      plane.quaternion.copy(camera.quaternion);
      // Offset the plane so the anchor sits at the origin along camera axes.
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      if (grounded) {
        // Settled artwork uses its painted body as a ground contact, not standing feet.
        up.crossVectors(normal, right).normalize();
        plane.quaternion.setFromRotationMatrix(
          basis.makeBasis(right, up, normal),
        );
      } else up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      plane.position
        .copy(
          right.multiplyScalar(
            anchor[0] * plane.scale.x * (currentFacing < 0 ? -1 : 1),
          ),
        )
        .addScaledVector(up, anchor[1] * plane.scale.y);
      if (grounded) plane.position.y = 0.025;
    },
    dispose() {
      disposed = true;
      // Sheets are shared by every unit; only this billboard's own resources are freed.
      geometry.dispose();
      material.dispose();
      (ring.material as THREE.Material).dispose();
    },
  };
}
