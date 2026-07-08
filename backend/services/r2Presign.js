import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { getClient, bucketName, buildPublicUrl, extFromMimetype, isR2Url } from './r2Storage.js'

const ALLOWED_FOLDERS = new Set([
  'posts',
  'messages',
  'stories',
  'profile-pics',
  'uploads',
])

const PRESIGN_EXPIRES_SEC = 15 * 60
const MAX_CONTENT_LENGTH = (Number(process.env.MAX_UPLOAD_MB) || 100) * 1024 * 1024

/** Re-export helpers clients need for validation after direct upload. */
export { isR2Url, buildPublicUrl }

/**
 * Create a short-lived PUT URL so the client uploads straight to R2.
 * API never sees the file bytes.
 */
export async function createPresignedUpload({
  folder = 'uploads',
  mimetype = 'application/octet-stream',
  userId = '',
}) {
  const safeFolder = String(folder || 'uploads').replace(/^\/+|\/+$/g, '')
  if (!ALLOWED_FOLDERS.has(safeFolder)) {
    const err = new Error(`Invalid upload folder: ${safeFolder}`)
    err.code = 'INVALID_FOLDER'
    throw err
  }

  const mt = String(mimetype || '').toLowerCase()
  if (
    !mt.startsWith('image/') &&
    !mt.startsWith('video/') &&
    !mt.startsWith('audio/')
  ) {
    const err = new Error('Only images, videos, and audio are allowed')
    err.code = 'INVALID_TYPE'
    throw err
  }

  const uid = userId ? String(userId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) : 'anon'
  const key = `${safeFolder}/${uid}/${Date.now()}-${randomUUID()}.${extFromMimetype(mt)}`

  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ContentType: mt,
    CacheControl: 'public, max-age=31536000, immutable',
  })

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRES_SEC,
  })

  return {
    uploadUrl,
    publicUrl: buildPublicUrl(key),
    key,
    mimetype: mt,
    expiresIn: PRESIGN_EXPIRES_SEC,
    maxBytes: MAX_CONTENT_LENGTH,
  }
}

/** Accept one URL or array; reject anything that is not our R2 public URL. */
export function assertManagedMediaUrls(urls, { optional = false } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls])
    .map((u) => (u != null ? String(u).trim() : ''))
    .filter(Boolean)

  if (!list.length) {
    if (optional) return []
    const err = new Error('Media URL is required')
    err.code = 'MEDIA_REQUIRED'
    throw err
  }

  for (const url of list) {
    if (!isR2Url(url)) {
      const err = new Error('Invalid media URL — must be uploaded to our storage')
      err.code = 'INVALID_MEDIA_URL'
      throw err
    }
  }
  return list
}
