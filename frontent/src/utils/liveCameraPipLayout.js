export const PIP_SIZE_STEPS = [
  { w: 90, h: 120 },
  { w: 120, h: 160 },
  { w: 160, h: 213 },
  { w: 200, h: 267 },
];

export const PIP_DEFAULT_SIZE_INDEX = 1;

export function clampPipPosition(x, y, pipW, pipH, winW, winH, topMin = 72) {
  const edge = 8;
  return {
    x: Math.min(Math.max(edge, x), winW - pipW - edge),
    y: Math.min(Math.max(topMin, y), winH - pipH - edge),
  };
}
