import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { uploadFromPath } from './r2Storage.js'

const MAX_FILE_BYTES = 80 * 1024 * 1024
const MAX_REPLIES = 30
const MAX_REACTIONS = 60
const OUT_W = 540
const OUT_H = 960

const jobs = new Map()

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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(err)
      else reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`))
    })
  })
}

function parseDuration(stderr) {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(stderr || ''))
  if (!match) return 0
  return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3])
}

function ffmpegInfo(bin, file) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(err))
  })
}

async function probe(bin, file) {
  const stderr = await ffmpegInfo(bin, file)
  return {
    dur: parseDuration(stderr),
    hasAudio: /Audio:/.test(String(stderr)),
  }
}

export function exportHashFor(doc, notes) {
  const parts = [String(doc?.videoUrl || ''), String(doc?.duration || 0)]
  for (const n of notes || []) {
    parts.push([
      n._id,
      n.type,
      n.t,
      n.reaction || '',
      n.videoUrl || '',
      n.onNote || '',
      n.duration || 0,
    ].join(':'))
  }
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20)
}

function needsMix(notes) {
  return (notes || []).some((n) => (n.type === 'video' && n.videoUrl) || (n.type === 'reaction' && n.reaction))
}

async function downloadTo(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error('Could not read a video')
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_FILE_BYTES) throw new Error('Video is too large to download')
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  const info = await stat(dest)
  if (!info.size || info.size > MAX_FILE_BYTES) throw new Error('Video is too large to download')
}

function emojiCode(emoji) {
  const parts = []
  for (const ch of String(emoji || '')) {
    const cp = ch.codePointAt(0)
    if (cp == null || cp === 0xfe0f || cp === 0x200d) continue
    parts.push(cp.toString(16))
  }
  return parts.join('-')
}

async function pngFor(dir, cache, emoji) {
  const code = emojiCode(emoji)
  if (!code) return ''
  if (cache.has(code)) return cache.get(code)
  const dest = join(dir, `${code}.png`)
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`)
    if (!res.ok || !res.body) {
      cache.set(code, '')
      return ''
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
    cache.set(code, dest)
    return dest
  } catch {
    cache.set(code, '')
    return ''
  }
}

function reactionsBetween(list, start, end) {
    return list
    .filter((r) => r.t >= start - 0.05 && r.t < end)
    .slice(0, 8)
    .map((r) => ({ emoji: r.reaction, start: Math.max(0, r.t - start) }))
}

function buildPieces(mainDur, notes) {
  const replies = (notes || [])
    .filter((n) => n.type === 'video' && n.videoUrl && !n.onNote)
    .sort((a, b) => a.t - b.t || String(a._id).localeCompare(String(b._id)))
    .slice(0, MAX_REPLIES)
  const reactions = (notes || [])
    .filter((n) => n.type === 'reaction' && n.reaction && !n.onNote)
    .slice(0, MAX_REACTIONS)
  const pieces = []
  const used = new Set()
  let cursor = 0
  let guard = 0
  while (cursor < mainDur - 0.08 && guard < 40) {
    guard += 1
    const next = replies.find((r) => !used.has(String(r._id)) && r.t >= cursor - 0.05 && r.t < mainDur)
    if (!next) break
    const at = Math.min(mainDur, Math.max(cursor, Number(next.t) || 0))
    if (at - cursor > 0.12) {
      pieces.push({ kind: 'main', start: cursor, end: at, reactions: reactionsBetween(reactions, cursor, at) })
    }
    const chain = replies.filter((r) => !used.has(String(r._id)) && Math.abs((Number(r.t) || 0) - (Number(next.t) || 0)) < 0.8)
    for (const reply of chain) {
      used.add(String(reply._id))
      const kids = (notes || [])
        .filter((n) => n.type === 'reaction' && n.reaction && String(n.onNote || '') === String(reply._id))
        .slice(0, 8)
        .map((n) => ({ emoji: n.reaction, start: Math.max(0, Number(n.t) || 0) }))
      pieces.push({ kind: 'reply', note: reply, reactions: kids })
    }
    cursor = at
  }
  if (mainDur - cursor > 0.12) {
    pieces.push({ kind: 'main', start: cursor, end: mainDur, reactions: reactionsBetween(reactions, cursor, mainDur + 1) })
  }
  return pieces
}

async function encodeSegment({ bin, dir, index, input, ss, dur, reactions, cache }) {
  const pngs = []
  for (const reaction of reactions || []) {
    const file = await pngFor(dir, cache, reaction.emoji)
    if (file) pngs.push({ file, start: reaction.start })
  }
  const info = await probe(bin, input)
  const hasAudio = info.hasAudio
  const out = join(dir, `seg-${index}.mp4`)
  const args = [bin, '-y', '-ss', String(Math.max(0, ss || 0)), '-t', String(dur), '-i', input]
  for (const png of pngs) args.push('-loop', '1', '-t', String(dur), '-i', png.file)
  let audioMap = '0:a:0'
  if (!hasAudio) {
    args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo')
    audioMap = `${pngs.length + 1}:a`
  }
  const filters = [
    `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,format=yuv420p[v0]`,
  ]
  let last = 'v0'
  pngs.forEach((png, i) => {
    const t0 = Math.max(0, Number(png.start) || 0).toFixed(2)
    const t1 = (Number(t0) + 1.6).toFixed(2)
    filters.push(`[${i + 1}:v]scale=140:140,format=rgba[e${i}]`)
    filters.push(`[${last}][e${i}]overlay=(W-w)/2:(H-h)/2:enable='between(t\\,${t0}\\,${t1})'[v${i + 1}]`)
    last = `v${i + 1}`
  })
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${last}]`,
    '-map', audioMap,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '30',
    '-r', '24',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '44100',
    '-ac', '2',
    '-t', String(dur),
    '-movflags', '+faststart',
    out,
  )
  await runFfmpeg(args)
  return out
}

async function concatSegments(bin, dir, files) {
  if (files.length === 1) return files[0]
  const listPath = join(dir, 'list.txt')
  const body = files.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n')
  await writeFile(listPath, body)
  const out = join(dir, 'all.mp4')
  try {
    await runFfmpeg([bin, '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', out])
  } catch {
    await runFfmpeg([
      bin, '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',
      out,
    ])
  }
  return out
}

async function composeAndUpload(doc, notes) {
  const bin = await getFfmpegPath()
  if (!bin) throw new Error('Could not prepare the download')
  const dir = await mkdtemp(join(tmpdir(), 'vmx-'))
  const cache = new Map()
  try {
    const mainPath = join(dir, 'main.mp4')
    await downloadTo(doc.videoUrl, mainPath)
    const probed = await probe(bin, mainPath)
    const mainDur = Math.min(600, Number(doc.duration) > 0 ? Number(doc.duration) : probed.dur)
    if (!(mainDur > 0)) throw new Error('Could not read the video')
    const pieces = buildPieces(mainDur, notes)
    const files = []
    let index = 0
    for (const piece of pieces) {
      if (piece.kind === 'main') {
        const dur = Math.max(0.2, piece.end - piece.start)
        files.push(await encodeSegment({
          bin, dir, index, input: mainPath, ss: piece.start, dur, reactions: piece.reactions, cache,
        }))
        index += 1
        continue
      }
      const note = piece.note
      const replyPath = join(dir, `reply-${index}.mp4`)
      try {
        await downloadTo(note.videoUrl, replyPath)
      } catch (err) {
        console.warn('[videoMessage] skip reply in download:', err?.message || err)
        continue
      }
      const replyProbe = await probe(bin, replyPath)
      const dur = Math.min(30, Number(note.duration) > 0 ? Number(note.duration) : replyProbe.dur || 1)
      if (!(dur > 0.15)) continue
      files.push(await encodeSegment({
        bin, dir, index, input: replyPath, ss: 0, dur, reactions: piece.reactions, cache,
      }))
      index += 1
    }
    if (!files.length) throw new Error('Could not prepare the download')
    const mixed = await concatSegments(bin, dir, files)
    const uploaded = await uploadFromPath(mixed, 'video/mp4', 'video-messages', {
      disposition: 'attachment; filename="video-message.mp4"',
    })
    return uploaded.url
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** One render at a time per video. Returns the public file URL. */
export function prepareMixedVideo(doc, notes) {
  if (!needsMix(notes)) return Promise.resolve(doc.videoUrl)
  const id = String(doc._id)
  const existing = jobs.get(id)
  if (existing) return existing
  const job = composeAndUpload(doc, notes).finally(() => jobs.delete(id))
  jobs.set(id, job)
  return job
}

export { needsMix }
