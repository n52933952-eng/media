import * as r2 from './r2Storage.js'
import { prepareUploadBuffer } from './imageOptimize.js'
import { prepareVideoBuffer, DEFAULT_MAX_VIDEO_DURATION_SEC } from './videoOptimize.js'

const STORY_MAX_VIDEO_SEC = 20

function maxVideoDurationForFolder(folder) {
  if (folder === 'stories') return STORY_MAX_VIDEO_SEC
  return DEFAULT_MAX_VIDEO_DURATION_SEC
}

/** Map upload errors (e.g. video too long) to HTTP responses for controllers. */
export function respondToUploadError(res, err, fallback = 'Failed to upload file') {
  if (err?.code === 'VIDEO_TOO_LONG') {
    return res.status(400).json({
      error: err.message,
      code: 'VIDEO_TOO_LONG',
      maxDurationSec: err.maxDurationSec,
    })
  }
  return res.status(500).json({ error: fallback, details: err.message })
}

/** Upload a Multer memory file to R2 (images/videos optimized on upload). */
export async function uploadMulterFile(file, folder) {
  const isVideo = String(file.mimetype || '').toLowerCase().startsWith('video/')
  const prepared = isVideo
    ? await prepareVideoBuffer(file.buffer, file.mimetype, {
        maxDurationSec: maxVideoDurationForFolder(folder),
      })
    : await prepareUploadBuffer(file.buffer, file.mimetype, folder)
  const result = await r2.uploadBuffer(prepared.buffer, prepared.mimetype, folder)
  return {
    url: result.url,
    key: result.key,
    secure_url: result.url,
    public_id: result.key,
    publicId: result.key,
    duration: isVideo ? (prepared.durationSec ?? 0) : 0,
  }
}

/** Delete R2 object referenced by URL or storage key. */
export async function deleteMediaAsset(url, publicId) {
  const urlStr = url != null ? String(url).trim() : ''
  const keyStr = publicId != null ? String(publicId).trim() : ''

  if (keyStr && !keyStr.startsWith('http')) {
    await r2.deleteByKey(keyStr)
  }
  if (urlStr && r2.isR2Url(urlStr)) {
    await r2.deleteByUrl(urlStr)
  }
}

export function isManagedMediaUrl(url) {
  if (!url) return false
  return r2.isR2Url(url)
}
