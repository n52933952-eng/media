import * as r2 from './r2Storage.js'

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
