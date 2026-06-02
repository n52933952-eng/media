/** Navigation hooks filled by App.jsx when the router is ready. */
export const liveBroadcastNav = {
  minimize: null,
  returnToLive: null,
  /** Set briefly while routing to /live/broadcast so game pages do not end the match. */
  returningToLive: false,
};

export function isLiveBroadcastPath(path) {
  return path === '/live/broadcast' || (typeof path === 'string' && path.startsWith('/live/broadcast'));
}

/** Skip chess/card/race exit when the host is only returning to live controls. */
export function shouldSkipGameExitForLive(path) {
  return liveBroadcastNav.returningToLive || isLiveBroadcastPath(path);
}
