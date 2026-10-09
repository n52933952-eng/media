export function uidOf(v) {
  if (!v) return ''
  if (typeof v === 'string') return v
  return String(v._id || v)
}

export function otherParty(item, meId) {
  return uidOf(item?.sender) === String(meId) ? item?.receiver : item?.sender
}

/** Grab one jpeg frame so the inbox can show a picture, not a blank row. */
export async function captureVideoThumb(file) {
  if (!file) return null
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = url
  try {
    await new Promise((resolve, reject) => {
      v.onloadeddata = () => resolve()
      v.onerror = () => reject(new Error('thumb'))
    })
    const at = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(0.6, v.duration * 0.08) : 0.2
    await new Promise((resolve) => {
      const done = () => resolve()
      v.onseeked = done
      try {
        v.currentTime = at
      } catch {
        done()
      }
    })
    const canvas = document.createElement('canvas')
    const vw = v.videoWidth || 360
    const vh = v.videoHeight || 480
    const w = 360
    canvas.width = w
    canvas.height = Math.max(180, Math.round(w * (vh / vw)))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
    if (!blob) return null
    return new File([blob], 'thumb.jpg', { type: 'image/jpeg' })
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Shrink a video-message file so it streams on normal internet. Falls back to original. */
export async function prepareLightVideo(file, kind = 'main') {
  if (!file) return file
  const sizeMb = file.size / (1024 * 1024)
  if (kind === 'main' && sizeMb < 4) return file
  if (kind === 'note' && sizeMb < 1.5) return file
  try {
    const { compressVideo } = await import('./videoCompress.js')
    return await compressVideo(file, {
      quality: kind === 'note' ? 'note' : 'message',
      maxSizeMB: kind === 'note' ? 6 : 16,
      timeout: 80000,
    })
  } catch (e) {
    console.warn('[videoMessage] compress skipped', e?.message || e)
    return file
  }
}
