/** Ask for mic/camera before LiveKit joins, so the room does not start muted. */
export async function warmupUserMedia({ video = true, audio = true } = {}) {
  try {
    if (!navigator?.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch (_) {}
    });
  } catch (_) {
    // Silent: fallback is the normal LiveKit publish flow.
  }
}
