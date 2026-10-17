import type { TroopPose } from "../troop-poses.ts";

type Socket = readonly [number, number];
type Poses = Partial<Record<TroopPose, readonly Socket[]>>;

// Normalized current exported artwork: mouth, bow grip, or javelin hand, not body centroids.
// Pixel marks and strip hashes: evidence/projectile-release-2026-10-16/sockets.json.
export const projectileSockets: Readonly<Record<string, Poses>> = {
  drakon: {
    attack: [
      [302 / 384, 42 / 320],
      [282 / 384, 111 / 320],
      [313 / 384, 62 / 320],
    ],
    hit: [
      [316 / 384, 63 / 320],
      [316 / 384, 63 / 320],
      [326 / 384, 89 / 320],
    ],
    idle: [[326 / 384, 89 / 320]],
  },
  tracker: {
    attack: [
      [254 / 384, 140 / 320],
      [259 / 384, 112 / 320],
      [280 / 384, 77 / 320],
      [282 / 384, 79 / 320],
      [254 / 384, 140 / 320],
    ],
    hit: [
      [254 / 384, 140 / 320],
      [254 / 384, 140 / 320],
      [254 / 384, 140 / 320],
    ],
    idle: [[254 / 384, 140 / 320]],
  },
  peltast: {
    attack: [
      [138 / 384, 63 / 320],
      [213 / 384, 93 / 320],
      [234 / 384, 171 / 320],
    ],
    hit: [
      [164 / 384, 146 / 320],
      [164 / 384, 146 / 320],
      [162 / 384, 113 / 320],
    ],
    idle: [[162 / 384, 113 / 320]],
  },
};
