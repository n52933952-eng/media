import { spawn } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

let ffmpegPath = null

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

/**
 * Remux/transcode so moov atom is at file start (fast playback) and size is mobile-friendly.
 * Cloudinary did this automatically; R2 stores raw uploads without it.
 */
export async function prepareVideoBuffer(buffer, mimetype) {
  if (!buffer?.length || !String(mimetype || '').toLowerCase().startsWith('video/')) {
    return { buffer, mimetype }
  }

  const bin = await getFfmpegPath()
  if (!bin) {
    console.warn('[videoOptimize] ffmpeg-static missing, uploading original video')
    return { buffer, mimetype }
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
    return { buffer: out, mimetype: 'video/mp4' }
  } catch (e) {
    console.warn('[videoOptimize] fallback to original:', e?.message || e)
    return { buffer, mimetype }
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}
