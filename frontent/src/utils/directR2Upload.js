import API_BASE_URL from '../config/api'

/**
 * Browser direct upload: optional canvas compress → POST /api/media/presign → PUT to R2 → public URL.
 * API never receives file bytes.
 */

async function compressImageFile(file) {
  if (!file?.type?.startsWith('image/') || file.type.includes('gif')) {
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1920
    let { width, height } = bitmap
    if (width <= max && height <= max && file.size < 900_000) {
      bitmap.close?.()
      return file
    }
    const scale = Math.min(1, max / Math.max(width, height))
    width = Math.round(width * scale)
    height = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    )
    if (!blob) return file
    return new File([blob], (file.name || 'image').replace(/\.\w+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch (e) {
    console.warn('[directR2Upload] compress failed, using original', e)
    return file
  }
}

async function presignOne(folder, mimetype) {
  const res = await fetch(`${API_BASE_URL}/api/media/presign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, mimetype }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.uploadUrl || !data?.publicUrl) {
    throw new Error(data.error || 'Failed to get upload URL')
  }
  return data
}

async function presignMany(files) {
  const res = await fetch(`${API_BASE_URL}/api/media/presign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  const data = await res.json().catch(() => ({}))
  const uploads = data?.uploads
  if (!res.ok || !Array.isArray(uploads) || uploads.length !== files.length) {
    throw new Error(data.error || 'Failed to get upload URLs')
  }
  return uploads
}

async function putToR2(uploadUrl, file, mime) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: file,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 upload failed (${res.status}): ${text || res.statusText}`)
  }
}

/**
 * @param {File|Blob} file
 * @param {'posts'|'messages'|'stories'|'profile-pics'|'uploads'} folder
 * @param {{ skipCompress?: boolean }} [opts]
 * @returns {Promise<string>} public URL
 */
export async function uploadMediaToR2(file, folder, opts = {}) {
  if (!file) throw new Error('No file to upload')
  const prepared =
    opts.skipCompress || !String(file.type || '').startsWith('image/')
      ? file
      : await compressImageFile(file)
  const mime = prepared.type || file.type || 'application/octet-stream'
  const signed = await presignOne(folder, mime)
  await putToR2(signed.uploadUrl, prepared, mime)
  return signed.publicUrl
}

/**
 * @param {(File|Blob)[]} files
 * @param {'posts'|'messages'|'stories'|'profile-pics'|'uploads'} folder
 * @param {{ skipCompress?: boolean }} [opts]
 * @returns {Promise<string[]>}
 */
export async function uploadManyMediaToR2(files, folder, opts = {}) {
  if (!files?.length) return []
  const prepared = await Promise.all(
    files.map((f) =>
      opts.skipCompress || !String(f.type || '').startsWith('image/')
        ? f
        : compressImageFile(f),
    ),
  )
  const signed = await presignMany(
    prepared.map((p) => ({
      folder,
      mimetype: p.type || 'application/octet-stream',
    })),
  )
  await Promise.all(
    prepared.map((p, i) =>
      putToR2(signed[i].uploadUrl, p, p.type || 'application/octet-stream'),
    ),
  )
  return signed.map((s) => s.publicUrl)
}
