import { appUrl } from "../urls.ts";
import * as THREE from "three";
import { z } from "zod";
import { assetSchema } from "../scene.ts";

type Entry = z.infer<typeof assetSchema>;
type SheetData = Extract<Entry, { kind: "building" | "animation" }>;
export type Sheet = { texture: THREE.Texture; data: SheetData };

let catalogue: Promise<Map<string, SheetData>> | null = null;
const loader = new THREE.TextureLoader();
const textures = new Map<string, Promise<Sheet>>();

function manifest() {
  catalogue ??= fetch(appUrl("/art/manifest.json"))
    .then((r) => {
      if (!r.ok) throw new Error("Art library could not be loaded");
      return r.json();
    })
    .then((json) => {
      const map = new Map<string, SheetData>();
      for (const entry of z.array(assetSchema).parse(json))
        if (entry.kind === "building" || entry.kind === "animation")
          map.set(entry.id, entry);
      return map;
    })
    .catch((error: unknown) => {
      // A failed load (e.g. a network blip) is retried by the next request.
      catalogue = null;
      throw error;
    });
  return catalogue;
}

// Loads a sprite sheet once; every frame shares the texture through UV offsets.
export function sheet(id: string) {
  let pending = textures.get(id);
  if (!pending) {
    pending = manifest().then(async (map) => {
      const data = map.get(id);
      if (!data) throw new Error("Unknown sprite " + id);
      const texture = await loader.loadAsync(appUrl(data.path));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return { texture, data };
    });
    pending.catch(() => textures.delete(id));
    textures.set(id, pending);
  }
  return pending;
}

export function frameCount(data: SheetData) {
  return Math.max(1, Math.round(data.width / data.frameWidth));
}
