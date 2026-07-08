import { createPresignedUpload } from '../services/r2Presign.js'

/**
 * POST /api/media/presign
 * Body: { folder, mimetype } or { files: [{ folder, mimetype }, ...] }
 * Returns signed PUT URL(s) — client uploads directly to R2.
 */
export const createUploadUrl = async (req, res) => {
  try {
    const userId = req.user?._id
    const body = req.body || {}

    if (Array.isArray(body.files) && body.files.length) {
      if (body.files.length > 20) {
        return res.status(400).json({ error: 'Maximum 20 files per presign request' })
      }
      const uploads = await Promise.all(
        body.files.map((f) =>
          createPresignedUpload({
            folder: f.folder || body.folder || 'uploads',
            mimetype: f.mimetype || f.contentType || 'application/octet-stream',
            userId,
          }),
        ),
      )
      return res.status(200).json({ uploads })
    }

    const upload = await createPresignedUpload({
      folder: body.folder || 'uploads',
      mimetype: body.mimetype || body.contentType || 'application/octet-stream',
      userId,
    })
    return res.status(200).json(upload)
  } catch (error) {
    console.error('[media/presign]', error)
    if (error?.code === 'INVALID_FOLDER' || error?.code === 'INVALID_TYPE') {
      return res.status(400).json({ error: error.message, code: error.code })
    }
    return res.status(500).json({ error: error.message || 'Failed to create upload URL' })
  }
}
