import { appUrl } from "./urls.ts";
import { z } from "zod";
import type { Layout, TileId } from "./workshop.ts";
import type { Game } from "./game.ts";

type Scene = {
  season: Layout["season"];
  placements: {
    tile: TileId;
    sprite: string;
    level?: Game["placements"][number]["level"];
    troop?: string;
    troopCount?: number;
  }[];
  owned?: readonly TileId[];
};

const common = {
  id: z.string(),
  path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};
const render = {
  ...common,
  anchor: z.tuple([z.number(), z.number()]),
  pixelsPerUnit: z.number().positive(),
};
export const assetSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("icon") }),
  z.object({ ...common, kind: z.literal("background") }),
  z.object({ ...common, kind: z.literal("portrait") }),
  z.object({
    ...render,
    kind: z.literal("building"),
    frameWidth: z.number().int().positive(),
    frames: z.number().int().positive(),
  }),
  z.object({
    ...render,
    kind: z.literal("animation"),
    frameWidth: z.number().positive(),
    frames: z.number().int().positive(),
    fps: z.number().positive(),
    loop: z.boolean(),
    contactFrame: z.number().int().nonnegative().nullable(),
    groundedFromFrame: z.number().int().nonnegative().optional(),
  }),
]);
export type Sprite = {
  image: HTMLImageElement;
  data: Extract<
    z.infer<typeof assetSchema>,
    { kind: "building" | "animation" | "background" }
  >;
};

export async function catalogue() {
  const response = await fetch(appUrl("/art/manifest.json"));
  if (!response.ok) throw new Error("Art library could not be loaded");
  return z.array(assetSchema).parse(await response.json());
}

export async function sprites(
  entries?: z.infer<typeof assetSchema>[],
  wanted?: ReadonlySet<string>,
) {
  const loaded = entries ?? (await catalogue());
  const decoded = await Promise.all(
    loaded
      .filter(
        (x) =>
          x.kind === "building" ||
          x.kind === "animation" ||
          x.kind === "background",
      )
      .filter((x) => x.kind !== "background" || wanted?.has(x.id))
      .filter((x) => !wanted || wanted.has(x.id))
      .map(async (data): Promise<[string, Sprite] | null> => {
        const image = new Image();
        image.src = appUrl(data.path);
        try {
          await image.decode();
        } catch (error) {
          if (data.kind === "background") return null;
          throw error;
        }
        if (
          image.naturalWidth !== data.width ||
          image.naturalHeight !== data.height
        ) {
          if (data.kind === "background") return null;
          throw new Error("Invalid sprite dimensions: " + data.id);
        }
        return [data.id, { image, data }];
      }),
  );
  return new Map(decoded.filter((entry) => entry !== null));
}

export function point(q: number, r: number) {
  return {
    x: 480 + Math.sqrt(3) * 52 * (q + r / 2),
    y: 360 + 1.5 * 52 * r * 0.58,
  };
}

export function paintSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  frame: number,
  x: number,
  y: number,
  pixelsPerUnit = 12,
) {
  const { data, image } = sprite;
  if (data.kind === "background") return;
  const scale = pixelsPerUnit / data.pixelsPerUnit;
  const width = data.frameWidth;
  const index =
    data.kind === "building"
      ? Math.max(0, Math.min(data.frames - 1, frame))
      : frame;
  const height = image.naturalHeight;
  ctx.drawImage(
    image,
    index * width,
    0,
    width,
    height,
    x - data.anchor[0] * scale,
    y - data.anchor[1] * scale,
    width * scale,
    height * scale,
  );
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  layout: Scene,
  grid: readonly {
    id: TileId;
    q: number;
    r: number;
    terrain: string | null;
    feature?: string | null;
  }[],
  assets: Map<string, Sprite>,
  selected: TileId | null,
  time: number,
  reduced: boolean,
) {
  ctx.clearRect(0, 0, 960, 640);
  const gradient = ctx.createLinearGradient(0, 0, 0, 640);
  gradient.addColorStop(0, layout.season === "winter" ? "#183947" : "#204a53");
  gradient.addColorStop(1, "#102f40");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 960, 640);
  ctx.fillStyle = "#ffffff09";
  for (let i = 0; i < 9; i++) {
    const drift = reduced ? 0 : (time * 0.0008) % 160;
    ctx.beginPath();
    ctx.ellipse(
      120 + i * 90 + drift,
      95 + (i % 3) * 20,
      120,
      8,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const palette: Record<string, string> = {
    plains: "#64804b",
    fertile: "#899052",
    rocky: "#858a77",
    wildland: "#76804f",
    forest: "#3f664b",
  };
  for (const tile of grid) {
    const { x, y } = point(tile.q, tile.r);
    ctx.beginPath();
    for (let vertex = 0; vertex < 6; vertex++) {
      const a = ((30 + vertex * 60) * Math.PI) / 180;
      const px = x + Math.cos(a) * 52;
      const py = y + Math.sin(a) * 52 * 0.58;
      if (vertex === 0) ctx.moveTo(px, py + 9);
      else ctx.lineTo(px, py + 9);
    }
    ctx.closePath();
    ctx.fillStyle = "#353f2b";
    ctx.fill();
    ctx.beginPath();
    for (let vertex = 0; vertex < 6; vertex++) {
      const a = ((30 + vertex * 60) * Math.PI) / 180;
      const px = x + Math.cos(a) * 51;
      const py = y + Math.sin(a) * 51 * 0.58;
      if (vertex === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle =
      layout.season === "winter"
        ? "#c7d6ce"
        : (palette[tile.terrain ?? "plains"] ?? "#64804b");
    ctx.fill();
    if (layout.owned && !layout.owned.includes(tile.id)) {
      ctx.fillStyle = "#061622a0";
      ctx.fill();
    }
    ctx.strokeStyle = tile.id === selected ? "#f8db83" : "#ecdfaa24";
    ctx.lineWidth = tile.id === selected ? 2.5 : 1;
    ctx.stroke();
    ctx.fillStyle = layout.season === "winter" ? "#ffffff50" : "#d8dda427";
    for (let i = 0; i < 8; i++)
      ctx.fillRect(
        x - 32 + ((tile.id * 17 + i * 21) % 64),
        y - 18 + ((tile.id * 13 + i * 11) % 36),
        2,
        1,
      );
    // Map features occupy their tile: draw a simple marker so they never read as empty land.
    if (tile.feature === "mountain") {
      ctx.fillStyle = "#5d6157";
      ctx.beginPath();
      ctx.moveTo(x - 24, y + 10);
      ctx.lineTo(x, y - 26);
      ctx.lineTo(x + 24, y + 10);
      ctx.fill();
    } else if (tile.feature === "forest") {
      ctx.fillStyle = "#2b4d36";
      for (const dx of [-16, 0, 16]) {
        ctx.beginPath();
        ctx.moveTo(x + dx - 9, y + 8);
        ctx.lineTo(x + dx, y - 18);
        ctx.lineTo(x + dx + 9, y + 8);
        ctx.fill();
      }
    } else if (tile.feature === "circle-of-stone") {
      ctx.fillStyle = "#b9b6a4";
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.fillRect(x + Math.cos(a) * 22 - 3, y + Math.sin(a) * 12 - 8, 6, 9);
      }
    }
  }
  const placed = layout.placements
    .map((p) => ({ placement: p, tile: grid.find((t) => t.id === p.tile) }))
    .filter((x) => x.tile !== undefined)
    .sort((a, b) => {
      if (!a.tile || !b.tile) return 0;
      return point(a.tile.q, a.tile.r).y - point(b.tile.q, b.tile.r).y;
    });
  for (const { placement, tile } of placed) {
    if (!tile) continue;
    const { x, y } = point(tile.q, tile.r);
    paint(placement.sprite, x, y, (placement.level ?? 1) - 1);
    const action = placement.troop;
    if (action) {
      const sprite = assets.get(action);
      const frames = sprite?.data.kind === "animation" ? sprite.data.frames : 1;
      const frame = reduced ? 0 : Math.floor(time * 0.008) % frames;
      for (let i = 0; i < (placement.troopCount ?? 1); i++)
        paint(action, x + 30 + i * 9, y + 18 - i * 4, frame);
    }
  }
  if (!reduced && (layout.season === "winter" || layout.season === "autumn")) {
    const snow = layout.season === "winter";
    ctx.fillStyle = snow ? "#edf8f0b0" : "#d3a35490";
    for (let i = 0; i < 52; i++) {
      const x = ((i * 157 + time * (snow ? 0.014 : 0.027)) % 1000) - 20;
      const y = ((i * 83 + time * 0.022) % 650) - 10;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        snow ? 1.8 : 3,
        snow ? 1.8 : 1.2,
        snow ? 0 : i,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  function paint(id: string, x: number, y: number, frame: number) {
    const sprite = assets.get(id);
    if (!sprite) return;
    paintSprite(ctx, sprite, frame, x, y);
  }
}
