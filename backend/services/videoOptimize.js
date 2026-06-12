import { spawn } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

/** Default max length for post/message videos (10 minutes). Stories use a shorter limit in mediaStorage. */
export const DEFAULT_MAX_VIDEO_DURATION_SEC = Number(process.env.MAX_VIDEO_DURATION_SEC) || 600

let ffmpegPath = null

export class VideoTooLongError extends Error {
  constructor(durationSec, maxSec) {
    const maxLabel = formatMaxDurationLabel(maxSec)
    super(`Video is too long. Maximum allowed length is ${maxLabel}.`)
    this.name = 'VideoTooLongError'
    this.code = 'VIDEO_TOO_LONG'
    this.statusCode = 400
    this.durationSec = durationSec
    this.maxDurationSec = maxSec
  }
}

function formatMaxDurationLabel(seconds) {
  const s = Math.round(Number(seconds) || 0)
  if (s >= 60 && s % 60 === 0) {
    const mins = s / 60
    return `${mins} minute${mins === 1 ? '' : 's'}`
  }
  return `${s} seconds`
}

function parseDurationFromFfmpegStderr(stderr) {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(stderr || ''))
  if (!match) return null
  return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3])
}

async function getFfmpegPath() {
  if (ffmpegPath) return ffmpegPath
  try {
    const mod = await import('ffmpeg-static')
    ffmpegPath = mod.default || mod
    return ffmpegPath
  } catch {
    return null
  }
}

function extForMimetype(mimetype) {
  const mt = String(mimetype || '').toLowerCase()
  if (mt.includes('webm')) return 'webm'
  if (mt.includes('quicktime') || mt.includes('mov')) return 'mov'
  return 'mp4'
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`))
    })
  })
}

async function writeTempVideo(buffer, mimetype, prefix) {
  const id = randomUUID()
  const inPath = join(tmpdir(), `${prefix}-${id}.${extForMimetype(mimetype)}`)
  await writeFile(inPath, buffer)
  return inPath
}

/** Read video length in seconds (null if ffmpeg cannot probe). */
export async function probeVideoDurationSeconds(buffer, mimetype) {
  if (!buffer?.length || !String(mimetype || '').toLowerCase().startsWith('video/')) {
    return null
  }

  const bin = await getFfmpegPath()
  if (!bin) return null

  const inPath = await writeTempVideo(buffer, mimetype, 'vid-probe')
  try {
    const stderr = await new Promise((resolve, reject) => {
      const child = spawn(bin, ['-i', inPath], { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      child.stderr.on('data', (d) => {
        err += String(d)
      })
      child.on('error', reject)
      child.on('close', () => resolve(err))
    })
    return parseDurationFromFfmpegStderr(stderr)
  } finally {
    await unlink(inPath).catch(() => {})
  }
}

/** Throws VideoTooLongError when duration exceeds maxDurationSec. Returns probed duration. */
export async function assertVideoDurationWithinLimit(buffer, mimetype, maxDurationSec) {
  const duration = await probeVideoDurationSeconds(buffer, mimetype)
  if (duration == null) {
    console.warn('[videoOptimize] could not probe video duration, allowing upload')
    return null
  }
  if (duration > maxDurationSec + 0.5) {
    throw new VideoTooLongError(duration, maxDurationSec)
  }
  return duration
}

/**
 * Remux/transcode so moov atom is at file start (fast playback) and size is mobile-friendly.
 * Cloudinary did this automatically; R2 stores raw uploads without it.
 */
export async function prepareVideoBuffer(buffer, mimetype, options = {}) {
  if (!buffer?.length || !String(mimetype || '').toLowerCase().startsWith('video/')) {
    return { buffer, mimetype }
  }

  const maxDurationSec = options.maxDurationSec
  let durationSec = null
  if (maxDurationSec != null && maxDurationSec > 0) {
    durationSec = await assertVideoDurationWithinLimit(buffer, mimetype, maxDurationSec)
  } else {
    durationSec = await probeVideoDurationSeconds(buffer, mimetype)
  }

  const bin = await getFfmpegPath()
  if (!bin) {
    console.warn('[videoOptimize] ffmpeg-static missing, uploading original video')
    return { buffer, mimetype, durationSec: durationSec ?? undefined }
  }

  const id = randomUUID()
  const inPath = join(tmpdir(), `vid-in-${id}.${extForMimetype(mimetype)}`)
  const outPath = join(tmpdir(), `vid-out-${id}.mp4`)

  try {
    await writeFile(inPath, buffer)

    // Fast remux when possible; otherwise compress to 1080p H.264 MP4.
    try {
      await runFfmpeg([
        bin,
        '-y',
        '-i',
        inPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outPath,
      ])
    } catch {
      await runFfmpeg([
        bin,
        '-y',
        '-i',
        inPath,
        '-vf',
        "scale='min(1920,iw)':-2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outPath,
      ])
    }

    const out = await readFile(outPath)
    if (!out?.length) throw new Error('empty ffmpeg output')
    return { buffer: out, mimetype: 'video/mp4', durationSec: durationSec ?? undefined }
  } catch (e) {
    console.warn('[videoOptimize] fallback to original:', e?.message || e)
    return { buffer, mimetype, durationSec: durationSec ?? undefined }
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}
