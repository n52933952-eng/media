import mongoose from 'mongoose'
import VideoMessage from '../models/videoMessage.js'
import VideoNote from '../models/videoNote.js'
import User from '../models/user.js'
import { assertManagedMediaUrls } from '../services/r2Presign.js'
import { getIO, getUserSelfRoomId } from '../socket/socket.js'

/**
 * Video Messages — private 1-to-1 videos answered *inside* a moment.
 *
 * Scale notes:
 * - Every read is indexed + cursor paginated; nothing loads "all".
 * - Every realtime emit goes to exactly one user's self room (all their devices).
 *   No follower fan-out, no broadcast.
 * - Notes are a separate collection; the video document never grows.
 */

const PAGE_SIZE = 15
const NOTES_PAGE_SIZE = 200
const MAX_MARKERS = 10
const MAX_DURATION_SEC = 600
const MAX_NOTE_DURATION_SEC = 30
const USER_SELECT = 'username name profilePic'

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''))
const toNum = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const emitToUser = (userId, event, payload) => {
  try {
    const io = getIO()
    const room = getUserSelfRoomId(userId)
    if (io && room) io.to(room).emit(event, payload)
  } catch (err) {
    console.error(`[videoMessage] emit ${event} failed:`, err?.message)
  }
}

const encodeCursor = ({ createdAt, id }) =>
  Buffer.from(JSON.stringify({ c: new Date(createdAt).toISOString(), i: String(id) })).toString('base64url')

const decodeCursor = (raw) => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const createdAt = new Date(parsed?.c)
    if (Number.isNaN(createdAt.getTime()) || !isId(parsed?.i)) return null
    return { createdAt, id: new mongoose.Types.ObjectId(String(parsed.i)) }
  } catch {
    return null
  }
}

const sanitizeMarkers = (raw, duration) => {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const m of raw) {
    if (out.length >= MAX_MARKERS) break
    const t = toNum(m?.t, -1)
    if (t < 0 || (duration > 0 && t > duration)) continue
    out.push({
      t: Math.round(t * 10) / 10,
      type: m?.type === 'question' ? 'question' : 'mark',
      text: String(m?.text || '').trim().slice(0, 120),
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

const toPublic = (doc) => {
  const o = doc?.toObject ? doc.toObject() : { ...doc }
  return {
    _id: o._id,
    sender: o.sender,
    receiver: o.receiver,
    videoUrl: o.videoUrl,
    thumbnailUrl: o.thumbnailUrl || '',
    duration: o.duration || 0,
    markers: o.markers || [],
    noteCount: o.noteCount || 0,
    lastNoteAt: o.lastNoteAt || null,
    seenAt: o.seenAt || null,
    senderHasNewNotes: !!o.senderHasNewNotes,
    createdAt: o.createdAt,
  }
}

const loadForParticipant = async (id, userId) => {
  if (!isId(id)) return null
  const doc = await VideoMessage.findById(id)
  if (!doc) return null
  const uid = String(userId)
  if (String(doc.sender) !== uid && String(doc.receiver) !== uid) return null
  return doc
}

// ───────────────────────────── create / send ─────────────────────────────

export const sendVideoMessage = async (req, res) => {
  try {
    const senderId = req.user._id
    const { receiverId, videoUrl, thumbnailUrl, duration, markers } = req.body || {}

    if (!isId(receiverId)) return res.status(400).json({ error: 'receiverId is required' })
    if (String(receiverId) === String(senderId)) {
      return res.status(400).json({ error: 'You cannot send a video message to yourself' })
    }

    let safeVideoUrl
    try {
      ;[safeVideoUrl] = assertManagedMediaUrls(videoUrl)
      if (thumbnailUrl) assertManagedMediaUrls(thumbnailUrl)
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }

    const receiver = await User.findById(receiverId).select('_id').lean()
    if (!receiver) return res.status(404).json({ error: 'User not found' })

    const safeDuration = Math.min(MAX_DURATION_SEC, toNum(duration))

    const doc = await VideoMessage.create({
      sender: senderId,
      receiver: receiverId,
      participants: [senderId, receiverId],
      videoUrl: safeVideoUrl,
      thumbnailUrl: thumbnailUrl ? String(thumbnailUrl) : '',
      duration: safeDuration,
      markers: sanitizeMarkers(markers, safeDuration),
    })

    await doc.populate([
      { path: 'sender', select: USER_SELECT },
      { path: 'receiver', select: USER_SELECT },
    ])
    const payload = toPublic(doc)

    emitToUser(receiverId, 'videoMessage:new', payload)
    return res.status(201).json(payload)
  } catch (error) {
    console.error('[videoMessage] send error:', error)
    return res.status(500).json({ error: 'Failed to send video message' })
  }
}

// ───────────────────────────── inbox ─────────────────────────────

export const listVideoMessages = async (req, res) => {
  try {
    const userId = req.user._id
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE))
    const cursor = decodeCursor(req.query.cursor)

    const filter = { participants: userId }
    if (cursor) {
      filter.$and = [
        {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
          ],
        },
      ]
    }

    const rows = await VideoMessage.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('sender', USER_SELECT)
      .populate('receiver', USER_SELECT)
      .lean()

    const hasMore = rows.length > limit
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toPublic)
    const last = items[items.length - 1]

    return res.status(200).json({
      items,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last._id }) : null,
    })
  } catch (error) {
    console.error('[videoMessage] list error:', error)
    return res.status(500).json({ error: 'Failed to load video messages' })
  }
}

/** Badge: videos I received and never opened + my sent videos with new replies. */
export const getVideoMessageUnseenCount = async (req, res) => {
  try {
    const userId = req.user._id
    const [received, replied] = await Promise.all([
      VideoMessage.countDocuments({ receiver: userId, seenAt: null }),
      VideoMessage.countDocuments({ sender: userId, senderHasNewNotes: true }),
    ])
    return res.status(200).json({ unseenCount: received + replied })
  } catch (error) {
    console.error('[videoMessage] unseen count error:', error)
    return res.status(500).json({ error: 'Failed to load count' })
  }
}

// ───────────────────────────── open one ─────────────────────────────

export const getVideoMessage = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })

    // Opening = seen. Receiver clears `seenAt`; sender clears "new replies" flag.
    const uid = String(userId)
    const update = {}
    if (String(doc.receiver) === uid && !doc.seenAt) update.seenAt = new Date()
    if (String(doc.sender) === uid && doc.senderHasNewNotes) update.senderHasNewNotes = false
    if (Object.keys(update).length) {
      await VideoMessage.updateOne({ _id: doc._id }, { $set: update })
      Object.assign(doc, update)
      if (update.seenAt) emitToUser(doc.sender, 'videoMessage:seen', { _id: String(doc._id), seenAt: update.seenAt })
    }

    await doc.populate([
      { path: 'sender', select: USER_SELECT },
      { path: 'receiver', select: USER_SELECT },
    ])

    const notes = await VideoNote.find({ videoMessage: doc._id })
      .sort({ t: 1, _id: 1 })
      .limit(NOTES_PAGE_SIZE)
      .populate('user', USER_SELECT)
      .lean()

    return res.status(200).json({ ...toPublic(doc), notes })
  } catch (error) {
    console.error('[videoMessage] get error:', error)
    return res.status(500).json({ error: 'Failed to load video message' })
  }
}

// ───────────────────────────── reply inside a moment ─────────────────────────────

export const addVideoNote = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })

    const { t, type, videoUrl, duration, reaction } = req.body || {}
    const at = toNum(t, -1)
    if (at < 0) return res.status(400).json({ error: 'Invalid time' })
    const safeT = doc.duration > 0 ? Math.min(doc.duration, at) : at

    const note = { videoMessage: doc._id, user: userId, t: Math.round(safeT * 10) / 10 }

    if (type === 'reaction') {
      const emoji = String(reaction || '').trim().slice(0, 8)
      if (!emoji) return res.status(400).json({ error: 'Reaction is required' })
      note.type = 'reaction'
      note.reaction = emoji
    } else {
      try {
        ;[note.videoUrl] = assertManagedMediaUrls(videoUrl)
      } catch (e) {
        return res.status(400).json({ error: e.message })
      }
      note.type = 'video'
      note.duration = Math.min(MAX_NOTE_DURATION_SEC, toNum(duration))
    }

    const created = await VideoNote.create(note)

    const otherId = String(doc.sender) === String(userId) ? doc.receiver : doc.sender
    const flag = String(userId) === String(doc.receiver) ? { senderHasNewNotes: true } : {}
    await VideoMessage.updateOne(
      { _id: doc._id },
      { $inc: { noteCount: 1 }, $set: { lastNoteAt: new Date(), ...flag } },
    )

    await created.populate('user', USER_SELECT)
    const payload = { videoMessageId: String(doc._id), note: created.toObject() }

    emitToUser(otherId, 'videoMessage:note', payload)
    return res.status(201).json(payload)
  } catch (error) {
    console.error('[videoMessage] add note error:', error)
    return res.status(500).json({ error: 'Failed to add reply' })
  }
}

export const deleteVideoNote = async (req, res) => {
  try {
    const userId = req.user._id
    const { id, noteId } = req.params
    if (!isId(noteId)) return res.status(400).json({ error: 'Invalid note' })
    const doc = await loadForParticipant(id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })

    const removed = await VideoNote.findOneAndDelete({ _id: noteId, videoMessage: doc._id, user: userId })
    if (!removed) return res.status(404).json({ error: 'Reply not found' })

    await VideoMessage.updateOne({ _id: doc._id, noteCount: { $gt: 0 } }, { $inc: { noteCount: -1 } })

    const otherId = String(doc.sender) === String(userId) ? doc.receiver : doc.sender
    const payload = { videoMessageId: String(doc._id), noteId: String(noteId) }
    emitToUser(otherId, 'videoMessage:noteDeleted', payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error('[videoMessage] delete note error:', error)
    return res.status(500).json({ error: 'Failed to delete reply' })
  }
}

// ───────────────────────────── delete whole video ─────────────────────────────

export const deleteVideoMessage = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })

    await Promise.all([
      VideoMessage.deleteOne({ _id: doc._id }),
      VideoNote.deleteMany({ videoMessage: doc._id }),
    ])

    const otherId = String(doc.sender) === String(userId) ? doc.receiver : doc.sender
    const payload = { _id: String(doc._id) }
    emitToUser(otherId, 'videoMessage:deleted', payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error('[videoMessage] delete error:', error)
    return res.status(500).json({ error: 'Failed to delete video message' })
  }
}
