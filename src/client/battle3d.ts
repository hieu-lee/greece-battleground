import * as THREE from "three";
import { bodyRadius, createCombat, tickSeconds } from "../combat.ts";
import type { Battle, Fighter } from "../combat.ts";
import type { CombatEvent } from "../effects.ts";
import { createBillboard } from "./units.ts";
import type { Billboard } from "./units.ts";
import type { TroopPose } from "../troop-poses.ts";
import type { World } from "./world.ts";
import type { Vfx } from "./vfx.ts";

// Combat runs in flat arena units; the arena is centred between the two islands. One uniform
// scale keeps ranges and bodies round (a range reads the same left-right as up-down).
const ARENA_SCALE = 1.45;
function arenaPoint(p: { x: number; y: number }, out = new THREE.Vector3()) {
  return out.set(p.x * ARENA_SCALE, 0, p.y * ARENA_SCALE);
}

type Combat = ReturnType<typeof createCombat>;
type Unit = Combat["units"][number];

// Health bar parts are shared by every unit; each bar only owns three small meshes.
const barGeometry = {
  back: new THREE.PlaneGeometry(0.62, 0.085),
  fill: new THREE.PlaneGeometry(0.6, 0.06),
  armor: new THREE.PlaneGeometry(0.6, 0.025),
};
const teamRing = (side: Fighter["side"]) =>
  side === "polis" ? "#8fe08a" : "#ef7b62";
const barMaterial = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity,
  });
const barMaterials = {
  back: barMaterial("#0b1820", 0.85),
  polis: barMaterial("#7fd46b"),
  opponent: barMaterial("#ea6a52"),
  armor: barMaterial("#8fd0ff"),
};

function healthBar(side: "polis" | "opponent") {
  const group = new THREE.Group();
  const back = new THREE.Mesh(barGeometry.back, barMaterials.back);
  const fill = new THREE.Mesh(barGeometry.fill, barMaterials[side]);
  const armor = new THREE.Mesh(barGeometry.armor, barMaterials.armor);
  fill.position.z = 0.001;
  armor.position.set(0, 0.058, 0.001);
  group.add(back, fill, armor);
  back.renderOrder = 20;
  fill.renderOrder = 21;
  armor.renderOrder = 22;
  return {
    group,
    set(health: number, maximum: number, armour: number) {
      const k = maximum > 0 ? Math.max(0, Math.min(1, health / maximum)) : 0;
      fill.scale.x = Math.max(0.0001, k);
      fill.position.x = -0.3 * (1 - k);
      const a = maximum > 0 ? Math.max(0, Math.min(1, armour / maximum)) : 0;
      armor.visible = a > 0;
      armor.scale.x = Math.max(0.0001, a);
      armor.position.x = -0.3 * (1 - a);
    },
  };
}

export function createBattleView(world: World, vfx: Vfx) {
  const root = new THREE.Group();
  root.name = "battle";
  world.scene.add(root);
  let combat: Combat | null = null;
  let actors: {
    billboard: Billboard;
    bar: ReturnType<typeof healthBar>;
    unit: number;
    fallen: boolean;
    revivedAt: number | null;
    /** World distance walked so far: the walk cycle is locked to it, so feet never slide. */
    stride: number;
    /** Where the unit marches out from (its building), or null to start in formation. */
    from: THREE.Vector3 | null;
  }[] = [];
  let tail = 0;
  let lastId = -1;
  // Ticks' worth of time not yet simulated; it belongs to the current replay only.
  let carry = 0;

  function clear() {
    for (const a of actors) {
      root.remove(a.billboard.group, a.bar.group);
      a.billboard.dispose();
    }
    actors = [];
    combat = null;
    lastId = -1;
    carry = 0;
  }

  function pose(
    u: Unit,
    c: Combat,
    actor: Billboard,
    stride: number,
    reduced: boolean,
  ): { pose: TroopPose; frame: number } {
    const attackData = actor.sheetData("attack");
    const hitData = actor.sheetData("hit");
    const sinceAttack =
      u.attackAt === null
        ? Infinity
        : (c.ticks - u.attackAt) * tickSeconds + tail;
    const sinceHit =
      u.hitAt === null ? Infinity : (c.ticks - u.hitAt) * tickSeconds + tail;
    const attackRate =
      attackData?.kind === "animation" &&
      attackData.contactFrame !== null &&
      u.windupSeconds > 0
        ? attackData.contactFrame / u.windupSeconds
        : 8;
    const attackFrames =
      attackData?.kind === "animation" ? attackData.frames : 1;
    const hitFrames = hitData?.kind === "animation" ? hitData.frames : 1;
    const hitFps = hitData?.kind === "animation" ? hitData.fps : 8;
    if (u.life.kind !== "alive") {
      const d = actor.sheetData("death");
      const fps = d?.kind === "animation" ? d.fps : 5;
      if (reduced || (c.result && u.life.kind === "reviving"))
        return {
          pose: "death",
          frame: d?.kind === "animation" ? d.frames - 1 : 0,
        };
      const rising = actor.sheetData("revive");
      if (
        !c.result &&
        u.life.kind === "reviving" &&
        rising?.kind === "animation"
      ) {
        const start =
          u.life.restoreAt - rising.frames / (rising.fps * tickSeconds);
        const elapsed = (c.ticks - start) * tickSeconds + tail;
        if (elapsed >= 0)
          return { pose: "revive", frame: Math.floor(elapsed * rising.fps) };
      }
      const since = (c.ticks - (u.deathAt ?? c.ticks)) * tickSeconds + tail;
      return { pose: "death", frame: Math.floor(since * fps) };
    }
    const attackActive = sinceAttack < attackFrames / attackRate;
    const recovering =
      attackData?.kind === "animation" &&
      attackData.contactFrame !== null &&
      Math.floor(sinceAttack * attackRate) > attackData.contactFrame;
    if (sinceHit < hitFrames / hitFps && (!attackActive || recovering))
      return { pose: "hit", frame: Math.floor(sinceHit * hitFps) };
    if (attackActive)
      return { pose: "attack", frame: Math.floor(sinceAttack * attackRate) };
    if (u.walking && !c.result) {
      const w = actor.sheetData("walk");
      const fps = w?.kind === "animation" ? w.fps : 8;
      const frames = w?.kind === "animation" ? w.frames : 1;
      // The art is paced at fps / 1.5 frames per arena unit walked.
      return {
        pose: "walk",
        frame: Math.floor(((stride / ARENA_SCALE) * fps) / 1.5) % frames,
      };
    }
    return { pose: "idle", frame: 0 };
  }

  const target = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const up = new THREE.Vector3();
  function bodyPoint(unit: number, position: { x: number; y: number }) {
    const height = actors[unit]?.billboard.bodyHeight;
    if (height === null || height === undefined) return null;
    up.set(0, 1, 0).applyQuaternion(world.camera.quaternion);
    return arenaPoint(position).addScaledVector(up, height);
  }
  function sync(reduced: boolean) {
    if (!combat) return;
    up.set(0, 1, 0).applyQuaternion(world.camera.quaternion);
    for (const a of actors) {
      const u = combat.units[a.unit]!;
      const before = previous.copy(a.billboard.group.position);
      a.billboard.group.position.lerp(arenaPoint(u, target), reduced ? 1 : 0.5);
      a.stride += before.distanceTo(a.billboard.group.position);
      const { pose: name, frame } = pose(
        u,
        combat,
        a.billboard,
        a.stride,
        reduced,
      );
      a.billboard.show(name, reduced && name !== "death" ? 0 : frame, u.facing);
      a.billboard.face(world.camera);
      const sinceRevival =
        a.revivedAt === null
          ? Infinity
          : (combat.ticks - a.revivedAt) * tickSeconds + carry + tail;
      a.billboard.flash(reduced ? 0 : Math.max(0, 1 - sinceRevival / 0.5));
      // The team ring leaves with a fallen fighter and returns when a revival restores it.
      if ((u.life.kind !== "alive") !== a.fallen) {
        a.fallen = u.life.kind !== "alive";
        a.billboard.ring(a.fallen ? null : teamRing(u.side));
      }
      a.bar.group.visible = u.life.kind === "alive";
      a.bar.group.position
        .copy(a.billboard.group.position)
        .addScaledVector(up, a.billboard.headroom + 0.08);
      a.bar.group.quaternion.copy(world.camera.quaternion);
      a.bar.set(u.health, u.maximumHealth, u.armor);
    }
  }

  return {
    /**
     * A sample fighter (ring, shadow and health bar), so these battle-only materials' shaders
     * compile and are first used before a battle; the textured sprite shader is already warm
     * from the idle troops on the island (call dispose when done).
     */
    sample() {
      const billboard = createBillboard("hoplite", world.upload, 1);
      billboard.ring("#8fe08a");
      const bar = healthBar("polis");
      const group = new THREE.Group();
      group.add(billboard.group, bar.group);
      // Shrunk out of sight (the bar ignores depth): scale changes no shader program, and the
      // warm-up draws with frustum culling off. Matters after a context restore, with no veil.
      group.scale.setScalar(0.001);
      return { group, dispose: () => billboard.dispose() };
    },
    get combat() {
      return combat;
    },
    get assetStatus(): "loading" | "ready" | "failed" {
      if (actors.some((a) => a.billboard.status === "failed")) return "failed";
      return actors.some((a) => a.billboard.status === "loading")
        ? "loading"
        : "ready";
    },
    uploadAssets() {
      for (const a of actors) a.billboard.upload();
    },
    retryAssets() {
      for (const a of actors) a.billboard.retry();
    },
    /** `originOf` places a fighter's building in the world, for the march-out. */
    start(
      encounter: Battle,
      originOf: (fighter: Fighter) => THREE.Vector3 | null = () => null,
    ) {
      clear();
      combat = createCombat(encounter);
      actors = combat.units.map((u, i) => {
        const chief =
          u.sprite === "aegeus" ||
          u.sprite === "atalanta" ||
          u.sprite === "lykaon";
        // Ring and shadow follow the source body (Big 0.375 vs Small 0.25), the sprite its art.
        const scale = chief ? 1.25 : 1;
        const billboard = createBillboard(
          u.sprite,
          world.upload,
          scale,
          Math.max(scale, bodyRadius(u.sprite) / 0.25),
        );
        billboard.ring(teamRing(u.side));
        const bar = healthBar(u.side);
        root.add(billboard.group, bar.group);
        const from = originOf(encounter.fighters[i]!);
        return {
          billboard,
          bar,
          unit: i,
          fallen: false,
          revivedAt: null,
          stride: 0,
          from,
        };
      });
      tail = 0;
      sync(true);
      return combat;
    },
    /** Loaded billboard frames and health bars, in the camera's fixed right/up axes. */
    framingPoints(spots: boolean, origins = false) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        world.camera.quaternion,
      );
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
        world.camera.quaternion,
      );
      const points: THREE.Vector3[] = [];
      const standing = spots
        ? actors
        : actors.filter((a) => {
            const u = combat!.units[a.unit]!;
            const death = a.billboard.sheetData("death");
            const duration =
              death?.kind === "animation" ? death.frames / death.fps : 0;
            return (
              u.life.kind === "alive" ||
              u.life.kind === "reviving" ||
              (u.deathAt !== null &&
                (combat!.ticks - u.deathAt) * tickSeconds + tail <= duration)
            );
          });
      for (const a of standing.length ? standing : actors) {
        const box = a.billboard.frameBounds;
        const feet = spots
          ? arenaPoint(combat!.units[a.unit]!)
          : a.billboard.group.position;
        const positions = origins && a.from ? [feet, a.from] : [feet];
        for (const p of positions)
          for (const x of [
            Math.min(box.left, -0.31),
            Math.max(box.right, 0.31),
          ])
            for (const y of [Math.min(box.bottom, 0), box.top + 0.16])
              points.push(
                p.clone().addScaledVector(right, x).addScaledVector(up, y),
              );
      }
      return points;
    },
    /** True when some fighter marches out from a building before the fight. */
    get marches() {
      return actors.some((a) => a.from);
    },
    /**
     * March-out before the first tick: each unit walks from its building to its formation spot
     * (progress 0..1, eased). Units without an origin wait in formation.
     */
    march(progress: number, time: number) {
      if (!combat) return;
      const t = progress * progress * (3 - 2 * progress);
      up.set(0, 1, 0).applyQuaternion(world.camera.quaternion);
      for (const a of actors) {
        const u = combat.units[a.unit]!;
        const spot = arenaPoint(u, target);
        const from = a.from;
        // Units wait at their building until the march begins, then walk to formation.
        const moving = from !== null && progress > 0 && progress < 1;
        if (from) a.billboard.group.position.lerpVectors(from, spot, t);
        else a.billboard.group.position.copy(spot);
        const walk = a.billboard.sheetData("walk");
        const fps = walk?.kind === "animation" ? walk.fps : 8;
        const frames = walk?.kind === "animation" ? walk.frames : 1;
        a.billboard.show(
          moving ? "walk" : "idle",
          moving ? Math.floor(time * fps) % frames : 0,
          moving ? Math.sign(spot.x - from.x) || u.facing : u.facing,
        );
        a.billboard.face(world.camera);
        a.bar.group.visible = !moving;
        a.bar.group.position
          .copy(a.billboard.group.position)
          .addScaledVector(up, a.billboard.headroom + 0.08);
        a.bar.group.quaternion.copy(world.camera.quaternion);
      }
    },
    /** Advance by real seconds at the given speed; returns new events. */
    step(seconds: number, speed: number, reduced: boolean): CombatEvent[] {
      if (!combat) return [];
      if (combat.result) tail += seconds;
      else if (reduced) while (!combat.result) combat.advance();
      else {
        let budget = seconds * speed + carry;
        while (budget >= tickSeconds && !combat.result) {
          combat.advance();
          budget -= tickSeconds;
        }
        carry = combat.result ? 0 : budget;
      }
      // The engine prunes old events, so new ones are found by id from the end, not by index.
      const events = combat.events;
      let start = events.length;
      while (start > 0 && events[start - 1]!.id > lastId) start--;
      const fresh = events.slice(start);
      if (fresh.length) lastId = fresh.at(-1)!.id;
      for (const event of fresh)
        if (
          !reduced &&
          event.kind === "revive" &&
          combat.units[event.unit]!.sprite === "elysian-champion"
        )
          actors[event.unit]!.revivedAt = event.tick;
      sync(reduced);
      for (const event of fresh)
        vfx.combat(
          event,
          (p) => arenaPoint(p),
          combat,
          bodyPoint,
          (unit) => actors[unit]?.billboard.projectileOrigin() ?? null,
        );
      // Release uses the source pose/facing actually drawn this frame, not the prior ticker.
      vfx.syncProjectiles();
      return fresh;
    },
    skip() {
      if (!combat) return;
      while (!combat.result) combat.advance();
      lastId = combat.events.at(-1)?.id ?? lastId;
      for (const actor of actors) actor.revivedAt = null;
      sync(true);
    },
    balance() {
      if (!combat) return [0, 0] as const;
      let polis = 0,
        opponent = 0;
      for (const u of combat.units) {
        if (u.side === "polis") polis += Math.max(0, u.health);
        else opponent += Math.max(0, u.health);
      }
      return [polis, opponent] as const;
    },
    clear,
  };
}
