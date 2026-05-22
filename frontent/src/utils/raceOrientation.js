/** Try to lock the device to landscape for the racing game (mobile web). */
export async function lockRaceLandscape() {
  try {
    const o = screen.orientation
    if (o?.lock) {
      await o.lock('landscape-primary').catch(() => o.lock('landscape').catch(() => {}))
    }
  } catch (_) {
    /* iOS / desktop may reject */
  }
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen()
      const o = screen.orientation
      if (o?.lock) await o.lock('landscape').catch(() => {})
    }
  } catch (_) {
    /* needs user gesture on some browsers */
  }
}

export function unlockRaceLandscape() {
  try {
    screen.orientation?.unlock?.()
  } catch (_) {
    /* ignore */
  }
  try {
    if (document.fullscreenElement) document.exitFullscreen?.()
  } catch (_) {
    /* ignore */
  }
}

export function isPortraitViewport() {
  return window.innerHeight > window.innerWidth
}
