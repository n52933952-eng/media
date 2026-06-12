import multer from 'multer'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

/** Keep uploads small on Render (512MB RAM). Override with MAX_UPLOAD_MB env if you upgrade the plan. */
export const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 100) * 1024 * 1024

// Disk storage — avoids holding entire video in RAM (memoryStorage caused OOM on large uploads).
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpdir()),
  filename: (_req, file, cb) => {
    const mt = String(file.mimetype || '').toLowerCase()
    let ext = 'bin'
    if (mt.startsWith('video/')) ext = mt.includes('quicktime') ? 'mov' : 'mp4'
    else if (mt.startsWith('image/')) ext = mt.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
    cb(null, `upload-${randomUUID()}.${ext}`)
  },
})

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true)
  } else {
    cb(new Error('Only images and videos are allowed'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
  },
})

export default upload
