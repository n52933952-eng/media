import sharp from 'sharp'

const MAX_WIDTH_BY_FOLDER = {
  'profile-pics': 800,
  posts: 1920,
  messages: 1920,
  stories: 1920,
}

function maxWidthForFolder(folder) {
  const key = String(folder || '').replace(/^\/+|\/+$/g, '')
  return MAX_WIDTH_BY_FOLDER[key] || 1920
}

function isImageMimetype(mimetype) {
  return String(mimetype || '').toLowerCase().startsWith('image/')
}

/** Skip re-encoding animated GIF/WebP so motion still works in feed and stories. */
function isLikelyAnimated(mimetype, meta) {
  const mt = String(mimetype || '').toLowerCase()
  if (mt === 'image/gif') return true
  if (mt === 'image/webp' && (meta?.pages || 0) > 1) return true
  return false
}

/**
 * Resize + compress images on upload (replaces Cloudinary URL transforms).
 * Videos pass through unchanged.
 */
export async function prepareUploadBuffer(buffer, mimetype, folder) {
  if (!buffer?.length || !isImageMimetype(mimetype)) {
    return { buffer, mimetype }
  }

  try {
    const meta = await sharp(buffer, { animated: true }).metadata()
    if (isLikelyAnimated(mimetype, meta)) {
      return { buffer, mimetype }
    }

    const maxWidth = maxWidthForFolder(folder)
    let pipeline = sharp(buffer).rotate()

    if ((meta.width || 0) > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true })
    }

    const hasAlpha = meta.hasAlpha === true
    if (hasAlpha) {
      const out = await pipeline.webp({ quality: 82, effort: 4 }).toBuffer()
      return { buffer: out, mimetype: 'image/webp' }
    }

    const out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    return { buffer: out, mimetype: 'image/jpeg' }
  } catch (e) {
    console.warn('[imageOptimize] fallback to original:', e?.message || e)
    return { buffer, mimetype }
  }
}
