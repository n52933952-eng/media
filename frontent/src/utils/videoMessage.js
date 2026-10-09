export function uidOf(v) {
  if (!v) return ''
  if (typeof v === 'string') return v
  return String(v._id || v)
}

export function otherParty(item, meId) {
  return uidOf(item?.sender) === String(meId) ? item?.receiver : item?.sender
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
