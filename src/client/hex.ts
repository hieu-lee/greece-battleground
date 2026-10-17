// World units: one hex has circumradius 1. Pointy-top axial layout, matching the engine's (q, r).
const SQRT3 = Math.sqrt(3);
const HEX = 1;
// The player's polis sits left of the arena, the opponent's is mirrored on the right.
export const ISLAND_OFFSET = 10.4;

export type Side = "polis" | "opponent";

export function hexToWorld(q: number, r: number, side: Side = "polis") {
  const x = SQRT3 * HEX * (q + r / 2);
  const z = 1.5 * HEX * r;
  return side === "polis"
    ? { x: x - ISLAND_OFFSET, z }
    : { x: ISLAND_OFFSET - x, z };
}

export function worldToHex(x: number, z: number, side: Side = "polis") {
  const lx = side === "polis" ? x + ISLAND_OFFSET : ISLAND_OFFSET - x;
  const fq = ((SQRT3 / 3) * lx - z / 3) / HEX;
  const fr = ((2 / 3) * z) / HEX;
  return roundHex(fq, fr);
}

function roundHex(fq: number, fr: number) {
  const fs = -fq - fr;
  let q = Math.round(fq),
    r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq),
    dr = Math.abs(r - fr),
    ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexCorners(cx: number, cz: number, radius = HEX) {
  const corners: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    corners.push([cx + radius * Math.cos(a), cz + radius * Math.sin(a)]);
  }
  return corners;
}

export const neighbours = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

// Corner i and i+1 bound the edge shared with neighbours[edgeNeighbour[i]].
// Corners are at angles -30, 30, 90, 150, 210, 270 degrees (z grows downward on screen).
export const edgeNeighbour = [0, 5, 4, 3, 2, 1] as const;
