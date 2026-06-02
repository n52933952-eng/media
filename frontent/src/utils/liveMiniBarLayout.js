const EDGE = 8;

export function clampMiniBarPosition(x, y, barW, barH, winW, winH, topMin = 56) {
  return {
    x: Math.min(Math.max(EDGE, x), winW - barW - EDGE),
    y: Math.min(Math.max(topMin, y), winH - barH - EDGE),
  };
}

export const LIVE_MINI_BAR_STORAGE_KEY = 'liveMiniBarPos';

export function loadSavedMiniBarPos() {
  try {
    const raw = sessionStorage.getItem(LIVE_MINI_BAR_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
  } catch (_) { /* ignore */ }
  return null;
}

export function saveMiniBarPos(pos) {
  try {
    sessionStorage.setItem(LIVE_MINI_BAR_STORAGE_KEY, JSON.stringify(pos));
  } catch (_) { /* ignore */ }
}
