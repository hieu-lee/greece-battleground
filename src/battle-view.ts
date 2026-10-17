export const battleView = {
  originX: 480,
  feetY: 400,
  xStep: 42,
  yStep: 24,
  troopPixels: 24,
  chestHeight: 26,
};

export function battlePoint(position: { x: number; y: number }, height = 0) {
  return {
    x: battleView.originX + position.x * battleView.xStep,
    y: battleView.feetY + position.y * battleView.yStep - height,
  };
}
