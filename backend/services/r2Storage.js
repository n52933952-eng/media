import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { randomUUID } from 'crypto'

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogg',
  'video/quicktime': 'mov',
}

function publicBaseUrl() {
  return String(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
}

export function bucketName() {
  return process.env.R2_BUCKET_NAME || 'playsocial-media'
}

function s3Endpoint() {
  const accountId = process.env.R2_ACCOUNT_ID
  if (!accountId) throw new Error('R2_ACCOUNT_ID is not configured')
  return `https://${accountId}.r2.cloudflarestorage.com`
}

let client = null

export function getClient() {
  if (client) return client
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not configured')
  }
  client = new S3Client({
    region: 'auto',
    endpoint: s3Endpoint(),
    credentials: { accessKeyId, secretAccessKey },
  })
  return client
}

export function extFromMimetype(mimetype) {
  const mt = String(mimetype || '').toLowerCase()
  if (MIME_EXT[mt]) return MIME_EXT[mt]
  const sub = mt.split('/')[1]
  if (sub) return sub.replace(/[^a-z0-9]/gi, '') || 'bin'
  return 'bin'
}

function isKnownMediaHost(hostname) {
  if (!hostname) return false
  if (hostname.endsWith('.r2.dev')) return true
  const extra = String(process.env.R2_MEDIA_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (extra.includes(hostname.toLowerCase())) return true
  try {
    const baseHost = new URL(publicBaseUrl()).hostname
    if (baseHost && hostname.toLowerCase() === baseHost.toLowerCase()) return true
  } catch {
    /* ignore */
  }
  return false
}

export function isR2Url(url) {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  const base = publicBaseUrl()
  if (base && trimmed.startsWith(`${base}/`)) return true
  try {
    return isKnownMediaHost(new URL(trimmed).hostname)
  } catch {
    return false
  }
}

export function extractKeyFromUrl(url) {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  const base = publicBaseUrl()
  if (base && trimmed.startsWith(`${base}/`)) {
    return decodeURIComponent(trimmed.slice(base.length + 1))
  }
  try {
    const u = new URL(trimmed)
    if (isKnownMediaHost(u.hostname)) {
      return decodeURIComponent(u.pathname.replace(/^\//, ''))
    }
  } catch {
    /* ignore */
  }
  return ''
}

export function buildPublicUrl(key) {
  const base = publicBaseUrl()
  if (!base) throw new Error('R2_PUBLIC_URL is not configured')
  return `${base}/${String(key).replace(/^\//, '')}`
}

export async function uploadBuffer(buffer, mimetype, folder = 'uploads') {
  if (!buffer?.length) throw new Error('Empty upload buffer')
  const safeFolder = String(folder || 'uploads').replace(/^\/+|\/+$/g, '')
  const key = `${safeFolder}/${Date.now()}-${randomUUID()}.${extFromMimetype(mimetype)}`
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: buffer,
      ContentType: mimetype || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )
  const url = buildPublicUrl(key)
  return { url, key }
}

/** Stream a file from disk to R2 (low RAM — safe for videos on small Render instances). */
export async function uploadFromPath(filePath, mimetype, folder = 'uploads') {
  if (!filePath) throw new Error('Empty upload path')
  const info = await stat(filePath)
  if (!info.isFile() || info.size <= 0) throw new Error('Empty upload file')

  const safeFolder = String(folder || 'uploads').replace(/^\/+|\/+$/g, '')
  const key = `${safeFolder}/${Date.now()}-${randomUUID()}.${extFromMimetype(mimetype)}`
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: info.size,
      ContentType: mimetype || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )
  const url = buildPublicUrl(key)
  return { url, key }
}

export async function deleteByKey(key) {
  if (!key) return false
  try {
    await getClient().send(
      new DeleteObjectCommand({
        Bucket: bucketName(),
        Key: String(key).replace(/^\//, ''),
      })
    )
    return true
  } catch (e) {
    console.warn('[r2] deleteByKey failed:', key, e?.message || e)
    return false
  }
}

export async function deleteByUrl(url) {
  const key = extractKeyFromUrl(url)
  if (!key) return false
  return deleteByKey(key)
}
