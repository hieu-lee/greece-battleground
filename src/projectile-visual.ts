const peak = 0.49931973218917847;

// Unweighted authored keys; this Hermite presentation does not claim Unity frame parity.
export function projectileArc(progress: number) {
  const first = progress <= peak;
  const span = first ? peak : 1 - peak;
  const t = first ? progress / span : (progress - peak) / span;
  const start = first ? 0 : 1;
  const end = first ? 1 : 0;
  const out = first ? 4.894561767578125 : 0.002721130847930908;
  const incoming = first ? 0.002721130847930908 : -5.431606769561768;
  return (
    (2 * t ** 3 - 3 * t ** 2 + 1) * start +
    (t ** 3 - 2 * t ** 2 + t) * span * out +
    (-2 * t ** 3 + 3 * t ** 2) * end +
    (t ** 3 - t ** 2) * span * incoming
  );
}
