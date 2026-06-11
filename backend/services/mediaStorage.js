import * as r2 from './r2Storage.js'

/** Upload a Multer memory file to R2. */
export async function uploadMulterFile(file, folder) {
  const result = await r2.uploadBuffer(file.buffer, file.mimetype, folder)
  return {
    url: result.url,
    key: result.key,
    secure_url: result.url,
    public_id: result.key,
    publicId: result.key,
    duration: 0,
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
