/** True when URL points at a video file (R2, legacy Cloudinary, or direct file link). */
export function isVideoUrl(url) {
  if (!url) return false
  const u = String(url)
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(u) || u.includes('/video/upload/')
}

/** Chat list preview label for an attachment-only message. */
export function mediaPreviewLabel(img) {
  const url = String(img || '').trim()
  if (!url) return ''
  return isVideoUrl(url) ? '🎥 Video' : '📷 Image'
}

function isMediaUrl(value) {
  if (!value) return false
  if (isVideoUrl(value)) return true
  if (/\.(jpe?g|png|gif|webp|heic|bmp|avif)(\?.*)?$/i.test(value)) return true
  return /^https?:\/\/\S+$/i.test(value)
}

/** Reply quote: show Video/Image, never the raw media URL. */
export function replyPreviewLabel(text, img) {
  const attachment = String(img || '').trim()
  const raw = String(text || '').trim()
  const candidate = attachment || raw
  if (candidate && (attachment || isMediaUrl(candidate))) {
    return mediaPreviewLabel(candidate) || raw
  }
  return raw
}

/** Media URL for a WhatsApp-style reply thumbnail. */
export function replyMediaUrl(text, img) {
  const attachment = String(img || '').trim()
  const raw = String(text || '').trim()
  const candidate = attachment || raw
  if (candidate && (attachment || isMediaUrl(candidate))) {
    return mediaDisplayUrl(candidate)
  }
  return ''
}

/** Display URL as stored by the backend (R2 public URL). */
export function mediaDisplayUrl(url) {
  return String(url || '').trim()
}
