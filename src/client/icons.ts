// Small inline SVG glyphs used by the HUD. Painted art lives in /art; these are interface marks.
const svg = (body: string, view = "0 0 24 24") =>
  `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  gear: svg(
    '<path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
    "1 0 24 24",
  ),
  reroll: svg(
    '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M19 8a8 8 0 0 0-14 1M5 16a8 8 0 0 0 14-1"/><path fill="currentColor" d="M20.5 3.5v6h-6zM3.5 20.5v-6h6z"/>',
  ),
  next: svg('<path fill="currentColor" d="M6 3.5 20 12 6 20.5l3.2-8.5z"/>'),
  helmet: svg(
    '<path fill="currentColor" d="M12 2c-4.4 0-8 3.4-8 8v6.5l3 3.5h2.5v-7H7.5V11h9v2h-2v7H17l3-3.5V10c0-4.6-3.6-8-8-8zm-1 9V4.2h2V11z"/>',
  ),
  crown: svg(
    '<path fill="currentColor" d="M3 8l4.5 3.5L12 4l4.5 7.5L21 8l-2 10H5zm2.5 11.5h13V21h-13z"/>',
  ),
  info: svg(
    '<circle cx="12" cy="12" r="10" fill="currentColor"/><path fill="#0d1520" d="M11 10h2v8h-2zm0-4h2v2h-2z"/>',
  ),
  mouseLeft: svg(
    '<rect x="6" y="3" width="12" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M12 3a6 6 0 0 0-6 6v1h6z"/>',
  ),
  mouseRight: svg(
    '<rect x="6" y="3" width="12" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M12 3a6 6 0 0 1 6 6v1h-6z"/>',
  ),
  mouseWheel: svg(
    '<rect x="6" y="3" width="12" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="11" y="6" width="2" height="5" rx="1" fill="currentColor"/>',
  ),
  worker: svg(
    '<circle cx="12" cy="7" r="4" fill="currentColor"/><path fill="currentColor" d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/>',
  ),
  close: svg(
    '<path stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>',
  ),
  pause: svg('<path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"/>'),
  speed1: svg('<path fill="currentColor" d="M8 4l10 8-10 8z"/>'),
  speed2: svg('<path fill="currentColor" d="M3 4l9 8-9 8zm9 0 9 8-9 8z"/>'),
  speed3: svg(
    '<path fill="currentColor" d="M1 5l7 7-7 7zm7.5 0 7 7-7 7zm7.5 0 7 7-7 7z"/>',
  ),
  swords: svg(
    '<g fill="currentColor" stroke="#172430" stroke-width=".8" stroke-linejoin="round"><path d="M12 1 14 4v10h3v2h-4v5h1v2h-4v-2h1v-5H7v-2h3V4z" transform="rotate(-45 12 12)"/><path d="M12 1 14 4v10h3v2h-4v5h1v2h-4v-2h1v-5H7v-2h3V4z" transform="rotate(45 12 12)"/></g>',
  ),
  claws: svg(
    '<path fill="currentColor" d="M5 2c3 4 5 10 4 20C7 15 5 9 5 2zm6.5-1c3 5 4 12 2.5 21-1.5-8-2.5-14-2.5-21zM18 2c2 5 2 11-.5 20 0-8-.5-14 .5-20z"/>',
  ),
  eye: svg(
    '<path fill="none" stroke="currentColor" stroke-width="2" d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  ),
  // Troop statistics in building tooltips.
  stat: {
    damage: svg(
      '<path fill="currentColor" d="M20 2h2v2l-9.5 9.5-2-2zM4.5 13.5l2-2 6 6-2 2-1.5-1.5L5 21l-2-2 3-4z"/>',
    ),
    health: svg(
      '<path fill="currentColor" d="M12 21 3.6 12.8A5 5 0 0 1 12 6a5 5 0 0 1 8.4 6.8z"/>',
    ),
    speed: svg(
      '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
    ),
    range: svg(
      '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 20 19 5M13 5h6v6"/>',
    ),
    armor: svg(
      '<path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/>',
    ),
    crit: svg(
      '<path fill="currentColor" d="m12 2 2.6 6.9L22 9.3l-5.8 4.6 2 7.1L12 17l-6.2 4 2-7.1L2 9.3l7.4-.4z"/>',
    ),
    burn: svg(
      '<path fill="currentColor" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
    ),
    poison: svg(
      '<path fill="currentColor" d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/>',
    ),
    healing: svg(
      '<path fill="currentColor" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    ),
  },
};
