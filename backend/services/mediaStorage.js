import { readFile, unlink } from 'fs/promises'
import * as r2 from './r2Storage.js'
import { prepareUploadBuffer } from './imageOptimize.js'
import { prepareVideoFromPath, DEFAULT_MAX_VIDEO_DURATION_SEC } from './videoOptimize.js'

const STORY_MAX_VIDEO_SEC = 20

function maxVideoDurationForFolder(folder) {
  if (folder === 'stories') return STORY_MAX_VIDEO_SEC
  return DEFAULT_MAX_VIDEO_DURATION_SEC
}

async function deleteTempPaths(paths) {
  const seen = new Set()
  for (const p of paths) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    await unlink(p).catch(() => {})
  }
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
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File is too large. Maximum upload size is 100MB.',
      code: 'FILE_TOO_LARGE',
    })
  }
  return res.status(500).json({ error: fallback, details: err.message })
}

/** Upload a Multer file to R2 (images/videos optimized on upload). */
export async function uploadMulterFile(file, folder) {
  const isVideo = String(file.mimetype || '').toLowerCase().startsWith('video/')
  const diskPath = file.path || null
  const tempPaths = diskPath ? [diskPath] : []

  try {
    if (isVideo && diskPath) {
      const prepared = await prepareVideoFromPath(diskPath, file.mimetype, {
        maxDurationSec: maxVideoDurationForFolder(folder),
      })
      tempPaths.push(...(prepared.cleanupPaths || []), prepared.filePath)

      const result = await r2.uploadFromPath(prepared.filePath, prepared.mimetype, folder)
      return {
        url: result.url,
        key: result.key,
        secure_url: result.url,
        public_id: result.key,
        publicId: result.key,
        duration: prepared.durationSec ?? 0,
      }
    }

    const buffer = file.buffer ?? (diskPath ? await readFile(diskPath) : null)
    if (!buffer?.length) throw new Error('Empty upload file')

    const prepared = isVideo
      ? await (async () => {
          const { prepareVideoBuffer } = await import('./videoOptimize.js')
          return prepareVideoBuffer(buffer, file.mimetype, {
            maxDurationSec: maxVideoDurationForFolder(folder),
          })
        })()
      : await prepareUploadBuffer(buffer, file.mimetype, folder)

    const result = await r2.uploadBuffer(prepared.buffer, prepared.mimetype, folder)
    return {
      url: result.url,
      key: result.key,
      secure_url: result.url,
      public_id: result.key,
      publicId: result.key,
      duration: isVideo ? (prepared.durationSec ?? 0) : 0,
    }
  } finally {
    await deleteTempPaths(tempPaths)
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

/** All unique R2 URLs attached to a post (carousel, collab, audio, legacy img). */
export function collectPostMediaUrls(post) {
  const urls = new Set()
  if (!post) return []

  const add = (u) => {
    const s = u != null ? String(u).trim() : ''
    if (s) urls.add(s)
  }

  add(post.img)
  add(post.audio)
  for (const u of post.images || []) add(u)
  for (const row of post.collaboratorImages || []) add(row?.img)
  add(post.thumbnail)
  add(post.videoThumbnail)
  add(post.thumb)
  add(post.thumbnailUrl)

  return [...urls]
}

/** Delete every managed media file for a post (used on post delete). */
export async function deleteAllPostMedia(post) {
  const urls = collectPostMediaUrls(post).filter(isManagedMediaUrl)
  await Promise.allSettled(urls.map((url) => deleteMediaAsset(url)))
}
