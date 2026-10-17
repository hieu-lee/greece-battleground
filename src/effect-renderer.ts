import { appUrl } from "./urls.ts";
import { battlePoint, battleView } from "./battle-view.ts";
import { projectileArc } from "./projectile-visual.ts";
import { z } from "zod";
import { effects } from "./effects.ts";
import type { EffectId } from "./effects.ts";
import type { createCombat } from "./combat.ts";

export const textureId = z.enum(["fire", "smoke", "spark", "ward", "kopis"]);
const textureManifest = z.array(
  z.object({
    id: textureId,
    path: z.string().regex(/^\/vfx\/[a-z-]+\.webp$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
);
export type EffectTextures = Map<z.infer<typeof textureId>, HTMLImageElement>;
type Point = { x: number; y: number };

export async function effectTextures(): Promise<EffectTextures> {
  const response = await fetch(appUrl("/vfx/manifest.json"));
  if (!response.ok) throw new Error("Effects library unavailable");
  const entries = textureManifest.parse(await response.json());
  if (
    entries.length !== textureId.options.length ||
    new Set(entries.map((e) => e.id)).size !== textureId.options.length
  )
    throw new Error("Incomplete effects library");
  const loaded = await Promise.all(
    entries.map(
      async (entry): Promise<[z.infer<typeof textureId>, HTMLImageElement]> => {
        const image = new Image();
        image.src = appUrl(entry.path);
        await image.decode();
        if (
          image.naturalWidth !== entry.width ||
          image.naturalHeight !== entry.height
        )
          throw new Error("Invalid effects texture: " + entry.id);
        return [entry.id, image];
      },
    ),
  );
  return new Map(loaded);
}
const random = (seed: number, i: number) => {
  let value = seed ^ Math.imul(i + 1, 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
};
function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
}
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  opacity: number,
) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.globalAlpha = opacity;
  ctx.fillStyle = gradient;
  circle(ctx, x, y, radius);
  ctx.fill();
  ctx.globalAlpha = 1;
}
function texture(
  ctx: CanvasRenderingContext2D,
  textures: EffectTextures,
  id: z.infer<typeof textureId>,
  x: number,
  y: number,
  size: number,
  alpha: number,
  rotation = 0,
  anchorX = 0.5,
  anchorY = 0.5,
) {
  const image = textures.get(id);
  if (!image) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha *= Math.max(0, alpha);
  ctx.drawImage(image, -size * anchorX, -size * anchorY, size, size);
  ctx.restore();
}
function particles(
  ctx: CanvasRenderingContext2D,
  target: Point,
  age: number,
  seed: number,
  color: string,
  count: number,
  force: number,
  gravity = 50,
) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const angle = random(seed, i) * Math.PI * 2;
    const speed = force * (0.3 + random(seed + 79, i));
    const x = target.x + Math.cos(angle) * speed * age;
    const y = target.y + Math.sin(angle) * speed * age + gravity * age * age;
    ctx.globalAlpha = Math.max(
      0,
      1 - age / (0.35 + random(seed + 23, i) * 0.5),
    );
    circle(ctx, x, y, 0.7 + random(seed + 31, i) * 1.5);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function paintEffect(
  ctx: CanvasRenderingContext2D,
  id: EffectId,
  source: Point,
  target: Point,
  age: number,
  seed: number,
  textures: EffectTextures,
  reduced: boolean,
) {
  if (age < 0 || age > effects[id].duration) return;
  const p = age / effects[id].duration;
  const color = effects[id].color;
  ctx.save();
  if (reduced && id !== "stun" && id !== "frost" && id !== "haste") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55 * (1 - p);
    circle(ctx, target.x, target.y, 15);
    ctx.stroke();
    ctx.restore();
    return;
  }
  switch (id) {
    case "lightning": {
      const strike = Math.max(0, 1 - age / 0.22);
      const cloud = { x: target.x - 25, y: target.y - 260 };
      if (strike > 0) {
        const path = new Path2D();
        path.moveTo(cloud.x, cloud.y);
        let previous = cloud;
        for (let i = 1; i <= 11; i++) {
          const next = {
            x: target.x + (random(seed, i) - 0.5) * 32 * (1 - i / 12),
            y: cloud.y + (i * 260) / 11,
          };
          path.lineTo(next.x, next.y);
          if (i === 4 || i === 7) {
            path.moveTo(previous.x, previous.y);
            path.lineTo(previous.x + (i === 4 ? -28 : 35), previous.y + 25);
            path.lineTo(previous.x + (i === 4 ? -15 : 48), previous.y + 47);
            path.moveTo(next.x, next.y);
          }
          previous = next;
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = strike;
        ctx.strokeStyle = "#55aaff";
        ctx.lineWidth = 6;
        ctx.shadowColor = "#5dacff";
        ctx.shadowBlur = 16;
        ctx.stroke(path);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#e8faff";
        ctx.lineWidth = 2;
        ctx.stroke(path);
        glow(ctx, target.x, target.y + 12, 50, "#8edbff", strike * 0.45);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      texture(
        ctx,
        textures,
        "spark",
        target.x,
        target.y,
        95 * (1 + p),
        Math.max(0, 1 - age / 0.4),
      );
      ctx.strokeStyle = "#94d8f7";
      ctx.globalAlpha = (1 - p) * 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(
        target.x,
        target.y + 20,
        12 + p * 65,
        4 + p * 17,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
      particles(ctx, target, age, seed, "#bcf0ff", 16, 70);
      texture(
        ctx,
        textures,
        "smoke",
        target.x,
        target.y - age * 25,
        35 + age * 35,
        (1 - p) * 0.35,
      );
      break;
    }
    case "fire": {
      const dx = target.x - source.x,
        dy = target.y - source.y;
      const reach = Math.hypot(dx, dy);
      const strength = Math.sin(Math.PI * Math.min(1, age / 0.85));
      const flame = textures.get("fire");
      if (flame && strength > 0) {
        ctx.save();
        ctx.translate(source.x, source.y);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.globalAlpha = strength;
        ctx.drawImage(
          flame,
          -reach * 0.13,
          -reach * 0.27,
          reach * 1.2,
          reach * 0.54,
        );
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = strength * 0.22;
        ctx.drawImage(
          flame,
          -reach * 0.13,
          -reach * 0.22,
          reach * 1.2,
          reach * 0.44,
        );
        ctx.restore();
      }
      glow(ctx, target.x, target.y + 10, 45, "#ffb03f", (1 - p) * 0.38);
      particles(ctx, target, age, seed, "#ffcc79", 18, 80, -15);
      texture(
        ctx,
        textures,
        "smoke",
        target.x,
        target.y - age * 30,
        30 + age * 65,
        Math.sin(Math.PI * p) * 0.55,
      );
      break;
    }
    case "ward":
      glow(ctx, target.x, target.y, 40, "#a1f3ed", (1 - p) * 0.25);
      texture(
        ctx,
        textures,
        "ward",
        target.x,
        target.y,
        62 + p * 24,
        (1 - p) * 0.9,
        age * 0.1,
      );
      particles(ctx, target, age, seed, "#e3efba", 12, 48, -12);
      break;
    case "kopis": {
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      if (textures.has("kopis"))
        texture(
          ctx,
          textures,
          "kopis",
          target.x,
          target.y,
          68,
          1 - p,
          angle,
          0.727,
          0.507,
        );
      else {
        ctx.save();
        ctx.translate(target.x, target.y);
        ctx.rotate(angle);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 * (1 - p);
        ctx.globalAlpha = 1 - p;
        ctx.beginPath();
        ctx.arc(-8, 0, 22, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        ctx.restore();
      }
      particles(ctx, target, age, seed, color, 5, 48);
      break;
    }
    case "spear":
    case "arrow":
    case "armor":
    case "critical": {
      const size = id === "critical" ? 76 : id === "armor" ? 40 : 48;
      texture(
        ctx,
        textures,
        "spark",
        target.x,
        target.y,
        size * (1 + p * 0.4),
        1 - p,
        random(seed, 4),
      );
      if (id === "spear" && age < 0.15) {
        ctx.globalAlpha = 1 - age / 0.15;
        ctx.strokeStyle = "#fff5d9";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const direction = target.x >= source.x ? 1 : -1;
        ctx.moveTo(target.x - direction * 23, target.y - 16);
        ctx.quadraticCurveTo(
          target.x + direction * 21,
          target.y - 15,
          target.x + direction * 8,
          target.y + 16,
        );
        ctx.stroke();
      }
      if (id === "arrow" && age < 0.1) {
        ctx.strokeStyle = "#ffe3a6";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1 - age / 0.1;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      particles(
        ctx,
        target,
        age,
        seed,
        color,
        id === "critical" ? 18 : 8,
        id === "critical" ? 95 : 55,
      );
      break;
    }
    case "heal":
    case "fate":
    case "upgrade":
    case "victory": {
      const life = Math.min(effects[id].duration, 1.2);
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI * 2) / 10 + age * 1.5;
        const r = 18 * (1 - age / life);
        const x = target.x + Math.cos(a) * r,
          y = target.y + Math.sin(a) * 6 - age * 40;
        glow(ctx, x, y, 5, color, Math.max(0, 1 - age / life));
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(
        target.x,
        target.y + 20,
        15 + p * 22,
        6 + p * 7,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    }
    case "stun":
      ctx.fillStyle = color;
      ctx.globalAlpha = 1 - p;
      ctx.font = "bold 20px system-ui";
      ctx.textAlign = "center";
      for (let i = 0; i < (reduced ? 1 : 3); i++) {
        const angle = (i * Math.PI * 2) / 3 + (reduced ? 0 : age * 4);
        ctx.fillText(
          "✦",
          target.x + Math.cos(angle) * 18,
          target.y - 25 + Math.sin(angle) * 6,
        );
      }
      ctx.font = "bold 12px system-ui";
      ctx.fillText("STUN", target.x, target.y - 44);
      break;
    case "frost":
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1 - p;
      ctx.translate(target.x, target.y - 25);
      ctx.rotate(reduced ? 0 : age * 0.8);
      for (let arm = 0; arm < 6; arm++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -20);
        ctx.moveTo(-6, -13);
        ctx.lineTo(0, -8);
        ctx.lineTo(6, -13);
        ctx.stroke();
      }
      break;
    case "haste":
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 2; i++) {
        const y = target.y - 18 - i * 13 - (reduced ? 0 : p * 18);
        ctx.beginPath();
        ctx.moveTo(target.x - 12, y);
        ctx.lineTo(target.x, y - 11);
        ctx.lineTo(target.x + 12, y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("HASTE", target.x, target.y - 55);
      break;
    case "poison":
      ctx.strokeStyle = color;
      ctx.fillStyle = "#154b45";
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI * 2) / 6 + random(seed, 1);
        const radius = 9 + p * 18;
        const x = target.x + Math.cos(angle) * radius;
        const y = target.y + Math.sin(angle) * radius * 0.65 + p * 9;
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.bezierCurveTo(x + 7, y + 1, x + 4, y + 6, x, y + 6);
        ctx.bezierCurveTo(x - 4, y + 6, x - 7, y + 1, x, y - 5);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case "burn":
      glow(ctx, target.x, target.y + 15, 24, color, (1 - p) * 0.25);
      particles(ctx, target, age, seed, color, 9, 20, -55);
      break;
    case "death":
    case "build":
    case "footstep":
      texture(
        ctx,
        textures,
        "smoke",
        target.x,
        target.y + 22 - age * 12,
        (id === "footstep" ? 14 : 30) + age * 35,
        (1 - p) * (id === "death" ? 0.4 : 0.2),
      );
      break;
    case "purchase":
    case "select":
    case "reroll":
    case "error":
    case "defeat":
      ctx.globalAlpha = (1 - p) * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      circle(ctx, target.x, target.y, 7 + p * 24);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

export function paintCombatEffects(
  ctx: CanvasRenderingContext2D,
  combat: ReturnType<typeof createCombat>,
  textures: EffectTextures,
  reduced: boolean,
  tailSeconds: number,
) {
  const screen = (p: Point) => battlePoint(p, battleView.chestHeight);
  const time = combat.ticks * 0.05 + tailSeconds;
  const landed = new Set(
    combat.events.flatMap((event) =>
      event.kind === "impact" && event.from === null
        ? [event.projectileId]
        : [],
    ),
  );
  for (const u of combat.units) {
    if (u.life.kind !== "alive" || combat.result) continue;
    const target = screen(u);
    if (u.ward > 0)
      texture(
        ctx,
        textures,
        "ward",
        target.x,
        target.y,
        53,
        reduced ? 0.22 : 0.25 + Math.sin(time * 2 + u.id) * 0.03,
      );
    if (u.poisoned > 0) {
      ctx.save();
      ctx.strokeStyle = effects.poison.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 3; i++) {
        circle(
          ctx,
          target.x + (i - 1) * 9,
          target.y + 19 - (reduced ? 0 : Math.sin(time * 2 + i) * 2),
          2.5,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
    if (u.burning > 0 && !reduced) {
      const phase = (time * 2 + u.id * 0.17) % 1;
      glow(ctx, target.x, target.y + 17, 19, "#ff882b", 0.18);
      particles(
        ctx,
        { x: target.x, y: target.y + 15 },
        phase * 0.6,
        u.id,
        "#ffc36c",
        4,
        12,
        -60,
      );
    }
  }
  if (!reduced && !combat.result) {
    const launches = new Map(
      combat.events.flatMap((event) =>
        event.kind === "launch" ? [[event.projectileId, event] as const] : [],
      ),
    );
    for (const shot of combat.projectiles) {
      const unit = combat.units[shot.from];
      const target = combat.units[shot.to];
      if (!unit || !target) continue;
      const source = screen(unit);
      const end = screen(target);
      const at = shot.kind === "held" ? source : screen(shot.position);
      if (shot.kind === "flight") {
        const launch = launches.get(shot.id);
        if (launch) {
          const distance = Math.hypot(
            launch.target.x - launch.source.x,
            launch.target.y - launch.source.y,
          );
          at.y -=
            projectileArc(shot.progress) *
            distance *
            shot.heightPerDistance *
            battleView.yStep;
        }
      }
      ctx.save();
      ctx.translate(at.x, at.y);
      if (unit.sprite === "drakon") {
        ctx.fillStyle = "#ffb24a";
        circle(ctx, 0, 0, 4);
        ctx.fill();
      } else {
        ctx.rotate(Math.atan2(end.y - at.y, end.x - at.x));
        ctx.strokeStyle = "#ffe1a6";
        ctx.lineWidth = unit.sprite === "tracker" ? 1.5 : 2;
        ctx.beginPath();
        ctx.moveTo(unit.sprite === "tracker" ? -12 : -18, 0);
        ctx.lineTo(3, 0);
        ctx.moveTo(0, -3);
        ctx.lineTo(3, 0);
        ctx.lineTo(0, 3);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  for (const event of combat.events
    .filter((e) => e.kind !== "footstep" && e.kind !== "launch")
    .slice(-96)) {
    const age = time - event.tick * 0.05;
    const target = screen(event.target);
    if (event.kind === "attack") {
      if (event.from !== null) continue;
      const recipient = combat.units[event.to];
      if (
        !recipient ||
        combat.result ||
        recipient.life.kind === "dead" ||
        reduced ||
        event.effect !== "arrow" ||
        landed.has(event.projectileId)
      )
        continue;
      const source = screen(event.source);
      const end = screen(recipient);
      const flight = Math.min(
        1,
        (age * 7.5) /
          Math.max(
            0.001,
            Math.hypot(
              recipient.x - event.source.x,
              recipient.y - event.source.y,
            ),
          ),
      );
      const x = source.x + (end.x - source.x) * flight,
        y =
          source.y +
          (end.y - source.y) * flight -
          Math.sin(flight * Math.PI) * 12;
      const angle = Math.atan2(end.y - source.y, end.x - source.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.strokeStyle = "#ffe1a6";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(3, 0);
      ctx.moveTo(0, -3);
      ctx.lineTo(3, 0);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.restore();
    } else if (event.kind === "impact") {
      paintEffect(
        ctx,
        event.blocked ? "ward" : event.effect,
        screen(event.source),
        target,
        age,
        event.id,
        textures,
        reduced,
      );
      if (!event.blocked && event.armorDamage > 0)
        paintEffect(
          ctx,
          "armor",
          target,
          target,
          age,
          event.id,
          textures,
          reduced,
        );
      if (!event.blocked && event.critical)
        paintEffect(
          ctx,
          "critical",
          target,
          target,
          age,
          event.id,
          textures,
          reduced,
        );
      if (age <= 0.7) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 0.7);
        ctx.font = event.critical ? "bold 16px system-ui" : "13px system-ui";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#18303b";
        ctx.lineWidth = 3;
        ctx.fillStyle = event.blocked
          ? "#cefff2"
          : event.critical
            ? "#ffdc6d"
            : "#fff1dc";
        const text = event.blocked
          ? "WARD"
          : `${event.critical ? "✦ " : ""}${Math.round(event.damage)}`;
        const y = target.y - 42 - (reduced ? 0 : age * 20);
        ctx.strokeText(text, target.x, y);
        ctx.fillText(text, target.x, y);
        ctx.restore();
      }
    } else if (event.kind === "insight") {
      paintEffect(
        ctx,
        "fate",
        target,
        target,
        age,
        event.id,
        textures,
        reduced,
      );
      if (age >= 0 && age <= 1.4) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1.4 - age) * 4);
        ctx.font = "bold 13px system-ui";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#18303b";
        ctx.lineWidth = 3;
        ctx.fillStyle = "#71c8ff";
        const text = `+${event.amount} YOUR INSIGHT`;
        const y = target.y - 56 - (reduced ? 0 : age * 20);
        ctx.strokeText(text, target.x, y);
        ctx.fillText(text, target.x, y);
        ctx.restore();
      }
    } else {
      paintEffect(
        ctx,
        (event.kind === "burn" || event.kind === "poison") && event.blocked
          ? "ward"
          : event.kind === "revive"
            ? "heal"
            : event.kind,
        target,
        target,
        age,
        event.id,
        textures,
        reduced,
      );
      if (event.kind === "frost" && age >= 0 && age <= 0.7) {
        ctx.save();
        ctx.globalAlpha = 1 - age / 0.7;
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#102d3b";
        ctx.lineWidth = 3;
        ctx.fillStyle = effects.frost.color;
        const text = event.frozen ? "FREEZE" : `FROST +${event.amount}`;
        const y = target.y - 48 - (reduced ? 0 : age * 15);
        ctx.strokeText(text, target.x, y);
        ctx.fillText(text, target.x, y);
        ctx.restore();
      }
      if (event.kind === "poison" && !event.blocked && age >= 0 && age <= 0.7) {
        ctx.save();
        ctx.globalAlpha = 1 - age / 0.7;
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#102d2b";
        ctx.lineWidth = 3;
        ctx.fillStyle = effects.poison.color;
        const text = `POISON ${Math.round(event.amount)}`;
        const y = target.y - 42 - (reduced ? 0 : age * 15);
        ctx.strokeText(text, target.x, y);
        ctx.fillText(text, target.x, y);
        ctx.restore();
      }
      if ((event.kind === "heal" || event.kind === "revive") && age <= 0.7) {
        ctx.save();
        ctx.globalAlpha = 1 - age / 0.7;
        ctx.fillStyle = "#b5fac0";
        ctx.font = "12px system-ui";
        ctx.fillText(
          `+${Math.round(event.amount)}`,
          target.x - 10,
          target.y - 40 - (reduced ? 0 : age * 15),
        );
        ctx.restore();
      }
    }
  }
}
