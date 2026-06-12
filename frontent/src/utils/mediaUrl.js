/** True when URL points at a video file (R2, legacy Cloudinary, or direct file link). */
export function isVideoUrl(url) {
  if (!url) return false
  const u = String(url)
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(u) || u.includes('/video/upload/')
}

/** Display URL as stored by the backend (R2 public URL). */
export function mediaDisplayUrl(url) {
  return String(url || '').trim()
}
