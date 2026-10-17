import * as THREE from "three";
import { hexToWorld } from "./hex.ts";
import type { Side } from "./hex.ts";
import { createCoast } from "./coast.ts";
import { createFlora } from "./flora.ts";
import {
  createGround,
  createOccupancyMask,
  createWater,
  fieldTexture,
  paintGround,
} from "./terrain.ts";
import type { Settlement } from "./terrain.ts";
import type { World } from "./world.ts";

export type Occupied = { side: Side; q: number; r: number };

// Static landscape: ground, coast, sea and flora. The mesh is rebuilt only when the hex layout
// changes; a tile whose terrain changes (revealed from the fog) is repainted and re-scattered in
// place, and structures just repaint the trodden-earth mask and hide props.
export function createIsland(world: World) {
  const field = fieldTexture();
  const water = createWater(field);
  const coast = createCoast();
  const mask = createOccupancyMask();
  world.scene.add(water, coast);
  let ground: THREE.Mesh | null = null;
  let flora: ReturnType<typeof createFlora> | null = null;
  let layoutKey = "";
  let current: Record<Side, Settlement | null> = {
    polis: null,
    opponent: null,
  };
  let occupiedKey = "";
  let occupied: readonly Occupied[] = [];
  let fogged: ReadonlySet<string> = new Set();
  function apply() {
    mask.paint(occupied.map((o) => hexToWorld(o.q, o.r, o.side)));
    flora?.setHidden(
      new Set(occupied.map((o) => `${o.side}:${o.q},${o.r}`)),
      fogged,
    );
    world.invalidateShadows();
  }
  return {
    build(settlements: Record<Side, Settlement | null>) {
      const layout = JSON.stringify(
        (["polis", "opponent"] as const).map((side) =>
          settlements[side]?.tiles.map((t) => [t.q, t.r]),
        ),
      );
      const changed = (["polis", "opponent"] as const).flatMap((side) =>
        (settlements[side]?.tiles ?? []).flatMap((tile, i) =>
          current[side]?.tiles[i]?.terrain === tile.terrain
            ? []
            : [{ side, tile }],
        ),
      );
      current = settlements;
      if (layout === layoutKey && ground && flora) {
        if (!changed.length) return;
        if (
          changed.every(({ side, tile }) =>
            flora?.retile(tile, side, settlements),
          )
        ) {
          paintGround(
            ground.geometry,
            settlements,
            changed.map(({ side, tile }) => hexToWorld(tile.q, tile.r, side)),
          );
          apply();
          return;
        }
      }
      layoutKey = layout;
      if (ground) {
        world.scene.remove(ground);
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
      }
      if (flora) {
        world.scene.remove(flora.group);
        flora.dispose();
      }
      ground = createGround(settlements, mask);
      flora = createFlora(settlements);
      world.scene.add(ground, flora.group);
      apply();
    },
    setOccupied(next: readonly Occupied[]) {
      const key = JSON.stringify(next);
      if (key === occupiedKey) return;
      occupiedKey = key;
      occupied = next;
      apply();
    },
    /** Tiles hidden by the fog ("side:q,r" keys) lose their props. */
    setFogged(next: ReadonlySet<string>) {
      if (
        next.size === fogged.size &&
        [...next].every((key) => fogged.has(key))
      )
        return;
      fogged = next;
      apply();
    },
  };
}
