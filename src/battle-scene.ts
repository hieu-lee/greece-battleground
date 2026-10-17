import { battlePoint, battleView } from "./battle-view.ts";
import { paintCombatEffects } from "./effect-renderer.ts";
import type { EffectTextures } from "./effect-renderer.ts";
import { arenaPerSource, createCombat, tickSeconds } from "./combat.ts";
import { paintSprite } from "./scene.ts";
import type { Sprite } from "./scene.ts";
import type { Season } from "./workshop.ts";

export function paintBattle(
  ctx: CanvasRenderingContext2D,
  combat: ReturnType<typeof createCombat>,
  assets: Map<string, Sprite>,
  season: Season,
  reduced: boolean,
  tailSeconds = 0,
  zoom = 1,
  textures: EffectTextures = new Map(),
) {
  const winter = season === "winter";
  ctx.fillStyle = winter ? "#acbdbb" : "#677c59";
  ctx.fillRect(0, 0, 960, 640);
  ctx.save();
  ctx.translate(480, 410);
  ctx.scale(zoom, zoom);
  ctx.translate(-480, -410);
  const background = assets.get(`battleground-${season}`);
  if (background?.data.kind === "background")
    ctx.drawImage(background.image, 0, 0, 960, 640);
  for (const u of [...combat.units].sort((a, b) => a.y - b.y || a.id - b.id)) {
    const { x, y } = battlePoint(u);
    const elapsedAttack =
      u.attackAt === null
        ? Infinity
        : (combat.ticks - u.attackAt) * tickSeconds + tailSeconds;
    const elapsedHit =
      u.hitAt === null
        ? Infinity
        : (combat.ticks - u.hitAt) * tickSeconds + tailSeconds;
    const attack = assets.get(`${u.sprite}-attack`);
    const hit = assets.get(`${u.sprite}-hit`);
    const attackRate =
      attack?.data.kind === "animation" &&
      attack.data.contactFrame !== null &&
      u.windupSeconds > 0
        ? attack.data.contactFrame / u.windupSeconds
        : 8;
    const attackActive =
      attack?.data.kind === "animation" &&
      elapsedAttack < attack.data.frames / attackRate;
    const hitActive =
      hit?.data.kind === "animation" &&
      elapsedHit < hit.data.frames / hit.data.fps;
    const recovering =
      attack?.data.kind === "animation" &&
      attack.data.contactFrame !== null &&
      Math.floor(elapsedAttack * attackRate) > attack.data.contactFrame;
    const rising = assets.get(`${u.sprite}-revive`);
    let elapsedRevive = -1;
    if (
      !reduced &&
      !combat.result &&
      u.life.kind === "reviving" &&
      rising?.data.kind === "animation"
    ) {
      const start =
        u.life.restoreAt - rising.data.frames / (rising.data.fps * tickSeconds);
      elapsedRevive = (combat.ticks - start) * tickSeconds + tailSeconds;
    }
    const animation =
      u.life.kind !== "alive"
        ? elapsedRevive >= 0
          ? "revive"
          : "death"
        : hitActive && (!attackActive || recovering)
          ? "hit"
          : attackActive
            ? "attack"
            : u.walking && !combat.result
              ? "walk"
              : "idle";
    const sprite = assets.get(`${u.sprite}-${animation}`);
    if (!sprite) continue;
    const elapsed =
      animation === "revive"
        ? elapsedRevive
        : animation === "death"
          ? (combat.ticks - (u.deathAt ?? combat.ticks)) * tickSeconds +
            tailSeconds
          : animation === "attack"
            ? elapsedAttack
            : animation === "hit"
              ? elapsedHit
              : combat.ticks * tickSeconds;
    let frame = 0;
    if (sprite.data.kind === "animation" && !reduced) {
      const rate =
        animation === "walk"
          ? (sprite.data.fps * u.movement * arenaPerSource) / 1.5
          : animation === "attack"
            ? attackRate
            : sprite.data.fps;
      frame = Math.floor(elapsed * rate);
      if (sprite.data.loop) frame %= sprite.data.frames;
      else frame = Math.min(sprite.data.frames - 1, frame);
    } else if (animation === "death" && sprite.data.kind === "animation")
      frame = sprite.data.frames - 1;
    if (
      animation === "death" &&
      combat.result &&
      u.life.kind === "reviving" &&
      sprite.data.kind === "animation"
    )
      frame = sprite.data.frames - 1;
    if (u.life.kind === "alive") {
      ctx.fillStyle = u.side === "polis" ? "#9bde9e65" : "#db8b7c65";
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(u.facing, 1);
    paintSprite(ctx, sprite, frame, 0, 0, battleView.troopPixels);
    ctx.restore();
    if (u.life.kind !== "alive") continue;
    ctx.fillStyle = "#0c2630";
    ctx.fillRect(x - 19, y - 68, 38, 5);
    ctx.fillStyle = u.side === "polis" ? "#85d892" : "#e7977b";
    ctx.fillRect(
      x - 18,
      y - 67,
      u.maximumHealth > 0
        ? 36 * Math.max(0, Math.min(1, u.health / u.maximumHealth))
        : 0,
      3,
    );
    if (u.armor > 0) {
      ctx.fillStyle = "#70bfd2";
      ctx.fillRect(
        x - 18,
        y - 71,
        u.maximumHealth > 0
          ? 36 * Math.max(0, Math.min(1, u.armor / u.maximumHealth))
          : 0,
        2,
      );
    }
    if (u.burning > 0) {
      ctx.fillStyle = "#fcb456";
      ctx.font = "11px system-ui";
      ctx.fillText("Burn " + Math.ceil(u.burning), x - 14, y - 77);
    }
  }
  paintCombatEffects(ctx, combat, textures, reduced, tailSeconds);
  ctx.restore();
  if (winter && !reduced) {
    ctx.fillStyle = "#edf8f0aa";
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.ellipse(
        (i * 157 + combat.ticks * 0.7) % 960,
        (i * 83 + combat.ticks * 1.1) % 640,
        2,
        2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}
