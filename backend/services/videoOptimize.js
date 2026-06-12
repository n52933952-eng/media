import { spawn } from 'child_process'
import { writeFile, readFile, unlink, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

/** Default max length for post/message videos (10 minutes). Stories use a shorter limit in mediaStorage. */
export const DEFAULT_MAX_VIDEO_DURATION_SEC = Number(process.env.MAX_VIDEO_DURATION_SEC) || 600

/** Above this size, only faststart remux (no heavy transcode) to stay within Render RAM. */
const LARGE_VIDEO_BYTES = (Number(process.env.LARGE_VIDEO_MB) || 35) * 1024 * 1024

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

async function ffmpegProbeStderr(inPath) {
  const bin = await getFfmpegPath()
  if (!bin) return null
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-i', inPath], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    child.on('error', reject)
    child.on('close', () => resolve(err))
  })
}

/** Read video length in seconds from a file on disk. */
export async function probeVideoDurationFromPath(inPath) {
  if (!inPath) return null
  try {
    const stderr = await ffmpegProbeStderr(inPath)
    return parseDurationFromFfmpegStderr(stderr)
  } catch {
    return null
  }
}

/** Read video length in seconds from a buffer (legacy — prefer disk path on server). */
export async function probeVideoDurationSeconds(buffer, mimetype) {
  if (!buffer?.length || !String(mimetype || '').toLowerCase().startsWith('video/')) {
    return null
  }
  const inPath = join(tmpdir(), `vid-probe-${randomUUID()}.${extForMimetype(mimetype)}`)
  try {
    await writeFile(inPath, buffer)
    return await probeVideoDurationFromPath(inPath)
  } finally {
    await unlink(inPath).catch(() => {})
  }
}

/** Throws VideoTooLongError when duration exceeds maxDurationSec. Returns probed duration. */
export async function assertVideoDurationWithinLimit(inPath, maxDurationSec) {
  const duration = await probeVideoDurationFromPath(inPath)
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
 * Process video on disk (low RAM). Returns path to upload + temp paths to delete after.
 */
export async function prepareVideoFromPath(inPath, mimetype, options = {}) {
  const maxDurationSec = options.maxDurationSec
  let durationSec = null
  if (maxDurationSec != null && maxDurationSec > 0) {
    durationSec = await assertVideoDurationWithinLimit(inPath, maxDurationSec)
  } else {
    durationSec = await probeVideoDurationFromPath(inPath)
  }

  const fileSize = (await stat(inPath)).size
  const largeFile = fileSize > LARGE_VIDEO_BYTES
  const bin = await getFfmpegPath()
  if (!bin) {
    return {
      filePath: inPath,
      mimetype,
      durationSec: durationSec ?? undefined,
      cleanupPaths: [],
    }
  }

  const outPath = join(tmpdir(), `vid-out-${randomUUID()}.mp4`)
  try {
    if (largeFile) {
      await runFfmpeg([bin, '-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath])
      return {
        filePath: outPath,
        mimetype: 'video/mp4',
        durationSec: durationSec ?? undefined,
        cleanupPaths: [inPath, outPath],
      }
    }

    try {
      await runFfmpeg([bin, '-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', outPath])
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

    return {
      filePath: outPath,
      mimetype: 'video/mp4',
      durationSec: durationSec ?? undefined,
      cleanupPaths: [inPath, outPath],
    }
  } catch (e) {
    console.warn('[videoOptimize] ffmpeg failed, uploading original:', e?.message || e)
    await unlink(outPath).catch(() => {})
    return {
      filePath: inPath,
      mimetype,
      durationSec: durationSec ?? undefined,
      cleanupPaths: [inPath],
    }
  }
}

/**
 * Legacy buffer path — writes to disk immediately then uses prepareVideoFromPath.
 */
export async function prepareVideoBuffer(buffer, mimetype, options = {}) {
  if (!buffer?.length || !String(mimetype || '').toLowerCase().startsWith('video/')) {
    return { buffer, mimetype }
  }

  const inPath = join(tmpdir(), `vid-in-${randomUUID()}.${extForMimetype(mimetype)}`)
  await writeFile(inPath, buffer)
  const prepared = await prepareVideoFromPath(inPath, mimetype, options)
  const out = await readFile(prepared.filePath)
  for (const p of prepared.cleanupPaths || []) {
    await unlink(p).catch(() => {})
  }
  return {
    buffer: out,
    mimetype: prepared.mimetype,
    durationSec: prepared.durationSec,
  }
}
