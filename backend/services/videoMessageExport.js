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

function parseFps(stderr) {
  const match = /(\d+(?:\.\d+)?)\s+fps/.exec(String(stderr || ''))
  const fps = match ? Number(match[1]) : 0
  return fps >= 12 && fps <= 60 ? fps : 30
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
  const format = (/Input #\d+,\s*([a-z0-9_]+)/i.exec(stderr) || [])[1] || ''
  return {
    dur: parseDuration(stderr),
    hasAudio: /Audio:/.test(String(stderr)),
    fps: parseFps(stderr),
    mov: /mov|mp4|m4a|3gp/.test(format.toLowerCase()),
  }
}

function countOnce(bin, file, mov) {
  return new Promise((resolve) => {
    const args = [bin]
    if (mov) args.push('-ignore_editlist', '1')
    args.push('-i', file, '-map', '0:v:0', '-f', 'null', '-')
    const child = spawn(bin, args.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    let tail = ''
    child.stderr.on('data', (d) => {
      tail = (tail + String(d)).slice(-4000)
    })
    const finish = () => {
      if (/option not found|Unrecognized option/i.test(tail)) {
        resolve(0)
        return
      }
      const frames = [...tail.matchAll(/frame=\s*(\d+)/g)]
      resolve(frames.length ? Number(frames[frames.length - 1][1]) : 0)
    }
    child.on('error', () => resolve(0))
    child.on('close', finish)
  })
}

/** Phone recordings often store a 1s duration while the frames are all still there. */
async function countFrames(bin, file, mov) {
  const plain = await countOnce(bin, file, false)
  if (!mov) return plain
  const full = await countOnce(bin, file, true)
  return Math.max(plain, full)
}

export function exportHashFor(doc, notes) {
  const parts = ['mix8', String(doc?.videoUrl || ''), String(doc?.duration || 0)]
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

function childVideos(notes, parentId) {
  return (notes || [])
    .filter((n) => n.type === 'video' && n.videoUrl && String(n.onNote || '') === String(parentId))
    .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0) || String(a._id).localeCompare(String(b._id)))
    .slice(0, 10)
}

function reactionKids(notes, parentId) {
  return (notes || [])
    .filter((n) => n.type === 'reaction' && n.reaction && String(n.onNote || '') === String(parentId))
    .slice(0, 24)
    .map((n) => ({ emoji: n.reaction, start: Math.max(0, Number(n.t) || 0) }))
}

function reactionsBetween(list, start, end) {
    return list
    .filter((r) => r.t >= start - 0.05 && r.t < end)
    .slice(0, 24)
    .map((r) => ({ emoji: r.reaction, start: Math.max(0, r.t - start) }))
}

/** A phone clip can be stretched longer than its saved length. Keep marks on the same picture. */
function fileTime(note, fileDur, t) {
  const at = Math.max(0, Number(t) || 0)
  const meta = Number(note?.duration) || 0
  const span = Number(fileDur) || 0
  if (meta > 0.2 && span > meta * 1.4) return Math.min(Math.max(0, span - 0.05), at * (span / meta))
  return at
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
        .slice(0, 24)
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

function atempoChain(stretch) {
  let speed = 1 / stretch
  const parts = []
  while (speed < 0.5 - 1e-4) {
    parts.push('atempo=0.5')
    speed /= 0.5
  }
  while (speed > 2 + 1e-4) {
    parts.push('atempo=2.0')
    speed /= 2
  }
  const last = Math.min(2, Math.max(0.5, speed))
  parts.push(`atempo=${last.toFixed(4)}`)
  return parts.join(',')
}

function replyTiming(note, probeInfo, frames) {
  const meta = Number(note?.duration) || 0
  const seen = Number(probeInfo?.dur) || 0
  const fps = probeInfo?.fps >= 12 && probeInfo?.fps <= 60 ? probeInfo.fps : 30
  const fromFrames = frames > 1 ? frames / fps : 0
  const outDur = Math.min(30, Math.max(meta, seen, fromFrames, 0.2))
  const stretch = seen > 0.15 && seen < 1.6 && fromFrames > seen * 1.5 ? Math.min(fromFrames / seen, 12) : 1
  return { outDur, stretch, fps }
}

function emojiSlices(reactions, playFor) {
  const span = Math.max(0.2, Number(playFor) || 0.2)
  const show = 1.6
  const marks = (reactions || [])
    .map((r) => ({ emoji: r.emoji, start: Math.max(0, Number(r.start) || 0) }))
    .filter((r) => r.emoji && r.start < span - 0.02)
    .sort((a, b) => a.start - b.start)
  if (!marks.length) return []
  const points = [0, span]
  for (const m of marks) {
    points.push(Math.min(span, m.start))
    points.push(Math.min(span, m.start + show))
  }
  const times = [...new Set(points.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b)
  const raw = []
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i]
    const dur = Math.round((times[i + 1] - start) * 100) / 100
    if (dur < 0.05) continue
    const active = marks.filter((m) => m.start <= start + 0.03 && m.start + show > start + 0.05)
    raw.push({
      start,
      dur,
      reactions: active.slice(0, 4).map((m) => ({ emoji: m.emoji, start: 0 })),
    })
  }
  const slices = []
  for (const sl of raw) {
    const prev = slices[slices.length - 1]
    if (prev && sl.dur < 0.12 && !sl.reactions.length) {
      prev.dur = Math.round((prev.dur + sl.dur) * 100) / 100
      continue
    }
    slices.push({ ...sl, reactions: sl.reactions.slice() })
  }
  return slices
}

async function encodeCore({ bin, dir, index, input, ss, readDur, outDur, stretch = 1, reactions, cache, hasAudio, wholeFile = false, frameFps = 30, mov = false }) {
  const pngs = []
  for (const reaction of reactions || []) {
    const file = await pngFor(dir, cache, reaction.emoji)
    if (file) pngs.push({ file, start: reaction.start })
  }
  const out = join(dir, `seg-${index}.mp4`)
  const playFor = Math.max(0.2, Number(outDur) || 0.2)
  const readFor = Math.max(playFor, Number(readDur) || playFor)
  const speed = Number(stretch) > 1.01 ? Number(stretch) : 1
  const pace = Math.min(60, Math.max(12, Number(frameFps) || 30))
  const args = [bin, '-y']
  if (wholeFile && mov) args.push('-ignore_editlist', '1')
  else if (!wholeFile) args.push('-ss', String(Math.max(0, ss || 0)), '-t', String(readFor))
  args.push('-i', input)
  for (const png of pngs) args.push('-loop', '1', '-framerate', '24', '-t', String(playFor), '-i', png.file)
  const setpts = wholeFile ? `setpts=N/${pace}/TB` : 'setpts=PTS-STARTPTS'
  const filters = [
    `[0:v]${setpts},scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,format=yuv420p[v0]`,
  ]
  let last = 'v0'
  pngs.forEach((png, i) => {
    filters.push(`[${i + 1}:v]scale=140:140,format=rgba[e${i}]`)
    filters.push(`[${last}][e${i}]overlay=(W-w)/2:(H-h)/2:eof_action=pass[v${i + 1}]`)
    last = `v${i + 1}`
  })
  let audioMap = `${pngs.length + 1}:a`
  if (hasAudio) {
    const audio = [
      'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
      'asetpts=PTS-STARTPTS',
    ]
    if (speed > 1) audio.push(atempoChain(speed))
    audio.push(`apad=whole_dur=${playFor.toFixed(3)}`)
    audio.push(`atrim=0:${playFor.toFixed(3)}`)
    filters.push(`[0:a]${audio.join(',')}[aout]`)
    audioMap = '[aout]'
  } else {
    args.push('-f', 'lavfi', '-t', String(playFor), '-i', 'anullsrc=r=44100:cl=stereo')
  }
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${last}]`,
    '-map', audioMap,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '30',
    '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr',
    '-video_track_timescale', '24000',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '44100',
    '-ac', '2',
    '-t', String(playFor),
    '-movflags', '+faststart',
    out,
  )
  await runFfmpeg(args)
  return out
}

async function encodeSegment(opts) {
  const playFor = Math.max(0.2, Number(opts.outDur) || 0.2)
  const slices = emojiSlices(opts.reactions, playFor)
  if (!slices.length) return encodeCore({ ...opts, reactions: [] })
  const bake = !!opts.wholeFile || Number(opts.stretch) > 1.01
  let input = opts.input
  let ss = Number(opts.ss) || 0
  if (bake) {
    input = await encodeCore({ ...opts, index: `${opts.index}-b`, reactions: [] })
    ss = 0
  }
  const base = bake
    ? { input, ss: 0, stretch: 1, wholeFile: false, mov: false, hasAudio: true, frameFps: 24 }
    : { input, ss, stretch: 1, wholeFile: false, mov: false, hasAudio: !!opts.hasAudio, frameFps: opts.frameFps }
  const one = slices.length === 1 && slices[0].start < 0.05 && slices[0].dur > playFor - 0.08
  if (one) {
    return encodeCore({
      ...opts,
      ...base,
      ss: base.ss + slices[0].start,
      readDur: slices[0].dur,
      outDur: slices[0].dur,
      index: opts.index,
      reactions: slices[0].reactions,
    })
  }
  const files = []
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i]
    files.push(await encodeCore({
      ...opts,
      ...base,
      index: `${opts.index}-e${i}`,
      ss: base.ss + sl.start,
      readDur: sl.dur,
      outDur: sl.dur,
      reactions: sl.reactions,
    }))
  }
  return concatSegments(opts.bin, opts.dir, files, `mix-${opts.index}`)
}

async function concatSegments(bin, dir, files, name = 'all') {
  if (files.length === 1) return files[0]
  const listPath = join(dir, `${name}.txt`)
  const body = files.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n')
  await writeFile(listPath, body)
  const out = join(dir, `${name}.mp4`)
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

async function encodeNoteFile({ bin, dir, index, note, reactions, cache }) {
  const replyPath = join(dir, `reply-${index}.mp4`)
  try {
    await downloadTo(note.videoUrl, replyPath)
  } catch (err) {
    console.warn('[videoMessage] skip reply in download:', err?.message || err)
    return null
  }
  const replyProbe = await probe(bin, replyPath)
  const frames = await countFrames(bin, replyPath, replyProbe.mov)
  const timing = replyTiming(note, replyProbe, frames)
  if (!(timing.outDur > 0.15)) return null
  const scaled = (reactions || []).map((r) => ({ ...r, start: fileTime(note, timing.outDur, r.start) }))
  const replyEncode = {
    bin,
    dir,
    index,
    input: replyPath,
    ss: 0,
    readDur: timing.outDur,
    outDur: timing.outDur,
    stretch: timing.stretch,
    reactions: scaled,
    cache,
    hasAudio: replyProbe.hasAudio,
    frameFps: replyProbe.fps,
    mov: replyProbe.mov,
  }
  try {
    return { file: await encodeSegment({ ...replyEncode, wholeFile: true }), dur: timing.outDur }
  } catch (err) {
    console.warn('[videoMessage] reply mix retry:', err?.message || err)
    try {
      return {
        file: await encodeSegment({ ...replyEncode, wholeFile: true, mov: false, stretch: 1 }),
        dur: timing.outDur,
      }
    } catch (err2) {
      console.warn('[videoMessage] reply mix skipped:', err2?.message || err2)
      return null
    }
  }
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
          bin,
          dir,
          index,
          input: mainPath,
          ss: piece.start,
          readDur: dur,
          outDur: dur,
          reactions: piece.reactions,
          cache,
          hasAudio: probed.hasAudio,
        }))
        index += 1
        continue
      }
      const made = await encodeNoteFile({
        bin,
        dir,
        index,
        note: piece.note,
        reactions: piece.reactions,
        cache,
      })
      if (!made) continue
      index += 1
      const nested = childVideos(notes, piece.note._id)
      if (!nested.length) {
        files.push(made.file)
        continue
      }
      const before = files.length
      const used = new Set()
      let cursor = 0
      let guard = 0
      const span = made.dur
      while (cursor < span - 0.08 && guard < 24) {
        guard += 1
        const next = nested.find((n) => !used.has(String(n._id)) && fileTime(piece.note, span, n.t) >= cursor - 0.05 && fileTime(piece.note, span, n.t) < span)
        if (!next) break
        const at = Math.min(span, Math.max(cursor, fileTime(piece.note, span, next.t)))
        if (at - cursor > 0.12) {
          try {
            files.push(await encodeSegment({
              bin,
              dir,
              index,
              input: made.file,
              ss: cursor,
              readDur: at - cursor,
              outDur: at - cursor,
              reactions: [],
              cache,
              hasAudio: true,
            }))
            index += 1
          } catch (err) {
            console.warn('[videoMessage] reply slice skipped:', err?.message || err)
          }
        }
        const chain = nested.filter((n) => !used.has(String(n._id)) && Math.abs(fileTime(piece.note, span, n.t) - fileTime(piece.note, span, next.t)) < 0.8)
        for (const child of chain) {
          used.add(String(child._id))
          const childMade = await encodeNoteFile({
            bin,
            dir,
            index,
            note: child,
            reactions: reactionKids(notes, child._id),
            cache,
          })
          if (!childMade) continue
          files.push(childMade.file)
          index += 1
        }
        cursor = at
      }
      if (span - cursor > 0.12) {
        try {
          files.push(await encodeSegment({
            bin,
            dir,
            index,
            input: made.file,
            ss: cursor,
            readDur: span - cursor,
            outDur: span - cursor,
            reactions: [],
            cache,
            hasAudio: true,
          }))
          index += 1
        } catch (err) {
          console.warn('[videoMessage] reply slice skipped:', err?.message || err)
        }
      }
      if (files.length === before) files.push(made.file)
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
