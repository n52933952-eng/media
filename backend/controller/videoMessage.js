import mongoose from 'mongoose'
import VideoMessage from '../models/videoMessage.js'
import VideoMessageReceipt from '../models/videoMessageReceipt.js'
import VideoNote from '../models/videoNote.js'
import User from '../models/user.js'
import Follow from '../models/follow.js'
import { assertManagedMediaUrls } from '../services/r2Presign.js'
import { deleteByUrl } from '../services/r2Storage.js'
import { exportHashFor, needsMix, prepareMixedVideo } from '../services/videoMessageExport.js'
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
const MAX_GROUP = 9
const USER_SELECT = 'username name profilePic'

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''))
const toNum = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const PUSH_WAIT_MS = 4000

/** Tray alert after a short wait, so a quick delete never pings anyone. Tap only opens the list. */
const queueVideoPush = ({ recipientId, actorName, body, videoId, noteId }) => {
  const who = String(recipientId || '')
  const vid = String(videoId || '')
  if (!who || !vid) return
  setTimeout(async () => {
    try {
      const videoStill = await VideoMessage.exists({ _id: vid })
      if (!videoStill) return
      if (noteId) {
        const noteStill = await VideoNote.exists({ _id: noteId, videoMessage: vid })
        if (!noteStill) return
      }
      const { sendNotificationToUser } = await import('../services/pushNotifications.js')
      await sendNotificationToUser(who, actorName || 'PlaySocial', body, {
        type: 'video_message',
        nonce: String(Date.now()),
      })
    } catch (err) {
      console.error('[videoMessage] push failed:', err?.message || err)
    }
  }, PUSH_WAIT_MS)
}

const idOf = (value) => {
  if (value == null || value === '') return ''
  if (typeof value === 'object' && value._id != null && value._id !== value) return idOf(value._id)
  if (typeof value.toHexString === 'function') return value.toHexString()
  return String(value)
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

/** Best-effort R2 cleanup, off the request path. Never throws. */
const cleanupMediaInBackground = (urls) => {
  const list = (urls || []).filter(Boolean)
  if (!list.length) return
  setImmediate(async () => {
    for (const url of list) {
      try {
        await deleteByUrl(url)
      } catch (err) {
        console.warn('[videoMessage] media cleanup skipped:', err?.message)
      }
    }
  })
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
      type: m?.type === 'question' ? 'question' : m?.type === 'reply' ? 'reply' : 'mark',
      text: String(m?.text || '').trim().slice(0, 120),
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

const toPublic = (doc) => {
  const o = doc?.toObject ? doc.toObject() : { ...doc }
  const person = (u) => {
    if (!u || typeof u !== 'object' || u._id == null) return null
    if (u.username == null && u.name == null && u.profilePic == null) return null
    return { _id: u._id, username: u.username || '', name: u.name || '', profilePic: u.profilePic || '' }
  }
  const base = {
    _id: o._id,
    sender: o.sender,
    receiver: o.receiver || null,
    videoUrl: o.videoUrl,
    thumbnailUrl: o.thumbnailUrl || '',
    duration: o.duration || 0,
    markers: o.markers || [],
    noteCount: o.noteCount || 0,
    lastNoteAt: o.lastNoteAt || null,
    seenAt: o.seenAt || null,
    senderHasNewNotes: !!o.senderHasNewNotes,
    senderUnseenNotes: o.senderUnseenNotes || 0,
    receiverUnseenNotes: o.receiverUnseenNotes || 0,
    createdAt: o.createdAt,
  }
  if (!o.isGroup) return base
  const members = (o.participants || []).map(person).filter(Boolean)
  return {
    ...base,
    isGroup: true,
    memberCount: o.memberCount || members.length,
    members,
  }
}

const memberIdsOf = (doc) => {
  const raw = Array.isArray(doc?.participants) && doc.participants.length
    ? doc.participants
    : [doc?.sender, doc?.receiver]
  const out = []
  for (const p of raw) {
    const id = String(p?._id || p || '')
    if (id && id !== 'undefined' && !out.includes(id)) out.push(id)
  }
  return out
}

/** One socket each, only to the people on this video. Never a follower fan-out. */
const emitToMembers = (doc, exceptId, event, payload) => {
  const skip = String(exceptId || '')
  for (const uid of memberIdsOf(doc)) {
    if (uid !== skip) emitToUser(uid, event, payload)
  }
}

const loadForParticipant = async (id, userId) => {
  if (!isId(id)) return null
  const doc = await VideoMessage.findById(id)
  if (!doc) return null
  const uid = String(userId)
  if (!memberIdsOf(doc).includes(uid)) return null
  return doc
}

// ───────────────────────────── create / send ─────────────────────────────

export const sendVideoMessage = async (req, res) => {
  try {
    const senderId = req.user._id
    const { receiverId, videoUrl, thumbnailUrl, duration, markers } = req.body || {}
    const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds : null

    let safeVideoUrl
    try {
      ;[safeVideoUrl] = assertManagedMediaUrls(videoUrl)
      if (thumbnailUrl) assertManagedMediaUrls(thumbnailUrl)
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }
    const safeDuration = Math.min(MAX_DURATION_SEC, toNum(duration))
    const thumb = thumbnailUrl ? String(thumbnailUrl) : ''
    const safeMarkers = sanitizeMarkers(markers, safeDuration)

    if (rawMembers && rawMembers.length > 1) {
      const ids = []
      for (const raw of rawMembers) {
        const id = String(raw || '')
        if (!isId(id) || id === String(senderId) || ids.includes(id)) continue
        ids.push(id)
      }
      if (ids.length < 2) return res.status(400).json({ error: 'Pick at least 2 people for a group' })
      if (ids.length > MAX_GROUP) return res.status(400).json({ error: 'A group can have up to 9 people' })

      const [followed, users] = await Promise.all([
        Follow.find({ followerId: senderId, followeeId: { $in: ids } }).select('followeeId').lean(),
        User.find({ _id: { $in: ids } }).select('_id').lean(),
      ])
      if (users.length !== ids.length) return res.status(404).json({ error: 'User not found' })
      if (followed.length !== ids.length) {
        return res.status(403).json({ error: 'You can only send video messages to people you follow' })
      }

      const doc = await VideoMessage.create({
        sender: senderId,
        receiver: null,
        isGroup: true,
        memberCount: ids.length + 1,
        participants: [senderId, ...ids],
        videoUrl: safeVideoUrl,
        thumbnailUrl: thumb,
        duration: safeDuration,
        markers: safeMarkers,
      })
      try {
        const now = new Date()
        await VideoMessageReceipt.insertMany([
          { videoMessage: doc._id, user: senderId, recipient: false, seenAt: now, unseenNotes: 0 },
          ...ids.map((id) => ({
            videoMessage: doc._id,
            user: id,
            recipient: true,
            seenAt: null,
            unseenNotes: 0,
          })),
        ])
      } catch (err) {
        await VideoMessage.deleteOne({ _id: doc._id })
        throw err
      }

      await doc.populate([
        { path: 'sender', select: USER_SELECT },
        { path: 'participants', select: USER_SELECT },
      ])
      const payload = { ...toPublic(doc), mySeenAt: null, myUnseenNotes: 0 }
      const mine = { ...payload, mySeenAt: new Date().toISOString() }
      const actorName = doc.sender?.name || doc.sender?.username || 'Someone'
      for (const id of ids) {
        emitToUser(id, 'videoMessage:new', payload)
        queueVideoPush({
          recipientId: id,
          actorName,
          body: 'sent you a group video',
          videoId: doc._id,
        })
      }
      return res.status(201).json(mine)
    }

    const oneId = rawMembers?.length === 1 ? rawMembers[0] : receiverId
    if (!isId(oneId)) return res.status(400).json({ error: 'receiverId is required' })
    if (String(oneId) === String(senderId)) {
      return res.status(400).json({ error: 'You cannot send a video message to yourself' })
    }

    const receiver = await User.findById(oneId).select('_id').lean()
    if (!receiver) return res.status(404).json({ error: 'User not found' })

    const follows = await Follow.exists({ followerId: senderId, followeeId: oneId })
    if (!follows) {
      return res.status(403).json({ error: 'You can only send video messages to people you follow' })
    }

    const doc = await VideoMessage.create({
      sender: senderId,
      receiver: oneId,
      isGroup: false,
      memberCount: 2,
      participants: [senderId, oneId],
      videoUrl: safeVideoUrl,
      thumbnailUrl: thumb,
      duration: safeDuration,
      markers: safeMarkers,
    })

    await doc.populate([
      { path: 'sender', select: USER_SELECT },
      { path: 'receiver', select: USER_SELECT },
    ])
    const payload = toPublic(doc)

    emitToUser(oneId, 'videoMessage:new', payload)
    queueVideoPush({
      recipientId: oneId,
      actorName: doc.sender?.name || doc.sender?.username || 'Someone',
      body: 'sent you a video',
      videoId: doc._id,
    })
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
      .populate('participants', USER_SELECT)
      .lean()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const groupIds = page.filter((row) => row.isGroup).map((row) => row._id)
    const receipts = groupIds.length
      ? await VideoMessageReceipt.find({ user: userId, videoMessage: { $in: groupIds } })
          .select('videoMessage seenAt unseenNotes')
          .lean()
      : []
    const mine = new Map(receipts.map((row) => [String(row.videoMessage), row]))
    const items = page.map((row) => {
      const pub = toPublic(row)
      if (!row.isGroup) return pub
      const receipt = mine.get(String(row._id))
      return {
        ...pub,
        mySeenAt: receipt?.seenAt || null,
        myUnseenNotes: receipt?.unseenNotes || 0,
      }
    })
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

async function countUnseenFor(userId) {
  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId
  const [received, senderRows, receiverRows, groupNew, groupNotes] = await Promise.all([
    VideoMessage.countDocuments({ receiver: uid, seenAt: null }),
    VideoMessage.aggregate([
      { $match: { sender: uid, $or: [{ senderUnseenNotes: { $gt: 0 } }, { senderHasNewNotes: true }] } },
      {
        $group: {
          _id: null,
          n: { $sum: { $cond: [{ $gt: ['$senderUnseenNotes', 0] }, '$senderUnseenNotes', 1] } },
        },
      },
    ]),
    VideoMessage.aggregate([
      { $match: { receiver: uid, seenAt: { $type: 'date' }, receiverUnseenNotes: { $gt: 0 } } },
      { $group: { _id: null, n: { $sum: '$receiverUnseenNotes' } } },
    ]),
    VideoMessageReceipt.countDocuments({ user: uid, recipient: true, seenAt: null }).maxTimeMS(2500),
    VideoMessageReceipt.aggregate([
      { $match: { user: uid, seenAt: { $type: 'date' }, unseenNotes: { $gt: 0 } } },
      { $group: { _id: null, n: { $sum: '$unseenNotes' } } },
    ]).option({ maxTimeMS: 2500 }),
  ])
  const replied = (senderRows[0]?.n || 0) + (receiverRows[0]?.n || 0)
  return received + replied + groupNew + (groupNotes[0]?.n || 0)
}

/** Badge: unopened videos + each reply or reaction I have not opened yet. */
export const getVideoMessageUnseenCount = async (req, res) => {
  try {
    const unseenCount = await countUnseenFor(req.user._id)
    return res.status(200).json({ unseenCount })
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

    const uid = String(userId)
    if (doc.isGroup) {
      try {
        await VideoMessageReceipt.updateOne(
          { videoMessage: doc._id, user: userId },
          { $set: { seenAt: new Date(), unseenNotes: 0 } },
        ).maxTimeMS(2500)
      } catch (err) {
        console.error('[videoMessage] group seen skipped:', err?.message || err)
      }
    } else {
      const update = {}
      if (String(doc.receiver) === uid && !doc.seenAt) update.seenAt = new Date()
      if (String(doc.receiver) === uid && (doc.receiverUnseenNotes || 0) > 0) update.receiverUnseenNotes = 0
      if (String(doc.sender) === uid && (doc.senderHasNewNotes || (doc.senderUnseenNotes || 0) > 0)) {
        update.senderHasNewNotes = false
        update.senderUnseenNotes = 0
      }
      if (Object.keys(update).length) {
        await VideoMessage.updateOne({ _id: doc._id }, { $set: update })
        Object.assign(doc, update)
        if (update.seenAt) emitToUser(doc.sender, 'videoMessage:seen', { _id: String(doc._id), seenAt: update.seenAt })
      }
    }

    await doc.populate([
      { path: 'sender', select: USER_SELECT },
      { path: 'receiver', select: USER_SELECT },
      { path: 'participants', select: USER_SELECT },
    ])

    const notes = await VideoNote.find({ videoMessage: doc._id })
      .sort({ t: 1, _id: 1 })
      .limit(NOTES_PAGE_SIZE)
      .populate('user', USER_SELECT)
      .lean()

    let unseenCount
    try {
      unseenCount = await countUnseenFor(userId)
    } catch (err) {
      console.error('[videoMessage] unseen during open skipped:', err?.message || err)
    }
    return res.status(200).json({ ...toPublic(doc), notes, ...(typeof unseenCount === 'number' ? { unseenCount } : {}) })
  } catch (error) {
    console.error('[videoMessage] get error:', error)
    return res.status(500).json({ error: 'Failed to load video message' })
  }
}

/** Same badge as a reaction: the other person, and only again after they already watched. */
async function badgeWatchedOthers(doc, actorId) {
  const videoMessageId = String(doc._id)
  if (doc.isGroup) {
    const others = await VideoMessageReceipt.find({ videoMessage: doc._id, user: { $ne: actorId } })
      .select('user seenAt')
      .maxTimeMS(2500)
      .lean()
    const opened = others.filter((row) => row.seenAt != null).map((row) => row.user)
    if (opened.length) {
      await VideoMessageReceipt.updateMany(
        { videoMessage: doc._id, user: { $in: opened } },
        { $inc: { unseenNotes: 1 } },
      ).maxTimeMS(2500)
    }
    for (const row of others) {
      emitToUser(row.user, 'videoMessage:note', { videoMessageId, badge: row.seenAt != null })
    }
    return
  }
  const senderId = idOf(doc.sender)
  const receiverId = idOf(doc.receiver)
  const otherId = idOf(actorId) === senderId ? receiverId : senderId
  if (!otherId) return
  if (receiverId && idOf(actorId) === receiverId) {
    await VideoMessage.updateOne(
      { _id: doc._id },
      { $inc: { senderUnseenNotes: 1 }, $set: { senderHasNewNotes: true } },
    )
    emitToUser(otherId, 'videoMessage:note', { videoMessageId, badge: true })
    return
  }
  const watched = await VideoMessage.exists({ _id: doc._id, seenAt: { $ne: null } })
  if (!watched) return
  await VideoMessage.updateOne({ _id: doc._id }, { $inc: { receiverUnseenNotes: 1 } })
  emitToUser(otherId, 'videoMessage:note', { videoMessageId, badge: true })
}

/** Sender drops a text "Reply here" on a second. They do not record another video. */
export const addReplyPrompt = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })
    if (String(doc.sender) !== String(userId)) {
      return res.status(403).json({ error: 'Only the sender can ask for a reply' })
    }
    if ((doc.markers || []).length >= MAX_MARKERS) {
      return res.status(400).json({ error: 'Too many prompts on this video' })
    }
    const at = toNum(req.body?.t, -1)
    if (at < 0) return res.status(400).json({ error: 'Invalid time' })
    const safeT = doc.duration > 0 ? Math.min(doc.duration, at) : at
    const marker = {
      t: Math.round(safeT * 10) / 10,
      type: 'reply',
      text: String(req.body?.text || 'Reply here').trim().slice(0, 120) || 'Reply here',
    }
    doc.markers = [...(doc.markers || []), marker].sort((a, b) => a.t - b.t)
    await doc.save()
    emitToMembers(doc, userId, 'videoMessage:marker', {
      videoMessageId: String(doc._id),
      markers: doc.markers,
    })
    await badgeWatchedOthers(doc, userId)
    return res.status(201).json({ markers: doc.markers })
  } catch (error) {
    console.error('[videoMessage] reply prompt error:', error)
    return res.status(500).json({ error: 'Failed to add reply prompt' })
  }
}

/** Sender removes one "Reply here" mark. Match the second they tapped. */
export const removeReplyPrompt = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })
    if (String(doc.sender) !== String(userId)) {
      return res.status(403).json({ error: 'Only the sender can remove a reply prompt' })
    }
    const at = toNum(req.body?.t, -1)
    if (at < 0) return res.status(400).json({ error: 'Invalid time' })
    const list = doc.markers || []
    const idx = list.findIndex((m) => m?.type === 'reply' && Math.abs(Number(m.t) - at) < 0.2)
    if (idx < 0) return res.status(404).json({ error: 'Reply prompt not found' })
    doc.markers = list.filter((_, i) => i !== idx)
    await doc.save()
    const payload = { videoMessageId: String(doc._id), markers: doc.markers }
    emitToMembers(doc, userId, 'videoMessage:marker', payload)
    return res.status(200).json({ markers: doc.markers })
  } catch (error) {
    console.error('[videoMessage] remove reply prompt error:', error)
    return res.status(500).json({ error: 'Failed to remove reply prompt' })
  }
}

// ───────────────────────────── reply inside a moment ─────────────────────────────

export const addVideoNote = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })

    const { t, type, videoUrl, duration, reaction, onNote } = req.body || {}
    const at = toNum(t, -1)
    if (at < 0) return res.status(400).json({ error: 'Invalid time' })

    const note = { videoMessage: doc._id, user: userId }

    if (type === 'reaction') {
      const emoji = String(reaction || '').trim().slice(0, 8)
      if (!emoji) return res.status(400).json({ error: 'Reaction is required' })
      note.type = 'reaction'
      note.reaction = emoji
      if (onNote) {
        if (!isId(onNote)) return res.status(400).json({ error: 'Invalid reply' })
        const parent = await VideoNote.findOne({ _id: onNote, videoMessage: doc._id, type: 'video' })
          .select('_id duration')
          .lean()
        if (!parent) return res.status(400).json({ error: 'Reply not found' })
        const cap = parent.duration > 0 ? parent.duration : MAX_NOTE_DURATION_SEC
        note.onNote = parent._id
        note.t = Math.round(Math.min(cap, at) * 10) / 10
      } else {
        const safeT = doc.duration > 0 ? Math.min(doc.duration, at) : at
        note.t = Math.round(safeT * 10) / 10
      }
    } else {
      try {
        ;[note.videoUrl] = assertManagedMediaUrls(videoUrl)
      } catch (e) {
        return res.status(400).json({ error: e.message })
      }
      note.type = 'video'
      note.duration = Math.min(MAX_NOTE_DURATION_SEC, toNum(duration))
      if (onNote) {
        if (!isId(onNote)) return res.status(400).json({ error: 'Invalid reply' })
        const parent = await VideoNote.findOne({ _id: onNote, videoMessage: doc._id, type: 'video', onNote: null })
          .select('_id duration')
          .lean()
        if (!parent) return res.status(400).json({ error: 'Reply not found' })
        const cap = parent.duration > 0 ? parent.duration : MAX_NOTE_DURATION_SEC
        note.onNote = parent._id
        note.t = Math.round(Math.min(cap, at) * 10) / 10
      } else {
        const safeT = doc.duration > 0 ? Math.min(doc.duration, at) : at
        note.t = Math.round(safeT * 10) / 10
      }
    }

    const created = await VideoNote.create(note)
    await created.populate('user', USER_SELECT)
    const actorName = created.user?.name || created.user?.username || 'Someone'
    const noteBody = created.type === 'reaction' ? `reacted ${created.reaction || ''} on a video` : 'replied on a video'
    const basePayload = {
      videoMessageId: String(doc._id),
      note: created.toObject(),
    }

    if (doc.isGroup) {
      const payload = { ...basePayload, badge: false }
      res.status(201).json(payload)
      setImmediate(async () => {
        try {
          await VideoMessage.updateOne({ _id: doc._id }, { $inc: { noteCount: 1 }, $set: { lastNoteAt: new Date() } })
          const others = await VideoMessageReceipt.find({ videoMessage: doc._id, user: { $ne: userId } })
            .select('user seenAt')
            .maxTimeMS(2500)
            .lean()
          const opened = others.filter((row) => row.seenAt != null).map((row) => row.user)
          if (opened.length) {
            await VideoMessageReceipt.updateMany(
              { videoMessage: doc._id, user: { $in: opened } },
              { $inc: { unseenNotes: 1 } },
            ).maxTimeMS(2500)
          }
          for (const row of others) {
            // Already watched: a later reaction brings the badge back. Not watched yet: the new-video badge is enough.
            emitToUser(row.user, 'videoMessage:note', { ...basePayload, badge: row.seenAt != null })
            queueVideoPush({
              recipientId: row.user,
              actorName,
              body: noteBody,
              videoId: doc._id,
              noteId: created._id,
            })
          }
        } catch (err) {
          console.error('[videoMessage] group note fan-out skipped:', err?.message || err)
        }
      })
      return
    }

    const actorId = idOf(userId)
    const senderId = idOf(doc.sender)
    const receiverId = idOf(doc.receiver)
    const otherId = actorId === senderId ? receiverId : senderId
    const fromReceiver = !!receiverId && actorId === receiverId
    const inc = { noteCount: 1 }
    const set = { lastNoteAt: new Date() }
    let badge = false
    if (fromReceiver) {
      // Sender already has the video. A new reaction still lights their badge.
      inc.senderUnseenNotes = 1
      set.senderHasNewNotes = true
      badge = true
    } else if (otherId) {
      const watched = await VideoMessage.exists({ _id: doc._id, seenAt: { $ne: null } })
      if (watched) {
        // Receiver already watched. A later reaction lights their badge again.
        inc.receiverUnseenNotes = 1
        badge = true
      }
    }
    await VideoMessage.updateOne({ _id: doc._id }, { $inc: inc, $set: set })

    const payload = { ...basePayload, badge }
    emitToUser(otherId, 'videoMessage:note', payload)
    queueVideoPush({
      recipientId: otherId,
      actorName,
      body: noteBody,
      videoId: doc._id,
      noteId: created._id,
    })
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

    const idStr = (v) => {
      if (v == null || v === '') return ''
      if (typeof v === 'string') return v
      if (typeof v === 'object' && v._id != null && v._id !== v) return idStr(v._id)
      if (typeof v.toHexString === 'function') return v.toHexString()
      return String(v)
    }
    const note = await VideoNote.findOne({ _id: noteId, videoMessage: doc._id })
    if (!note) return res.status(404).json({ error: 'Reply not found' })

    const iAmSender = idStr(doc.sender) === idStr(userId)
    const mine = idStr(note.user) === idStr(userId)
    // Either person can remove a reaction. A video reply only if you sent the video or you recorded it.
    if (!iAmSender && !mine && note.type !== 'reaction') {
      return res.status(404).json({ error: 'Reply not found' })
    }
    const removed = await VideoNote.findOneAndDelete({ _id: note._id, videoMessage: doc._id })
    if (!removed) return res.status(404).json({ error: 'Reply not found' })

    const kids = removed.type === 'video'
      ? await VideoNote.find({ onNote: removed._id }).select('_id').lean()
      : []
    if (kids.length) await VideoNote.deleteMany({ onNote: removed._id })

    const dropped = 1 + kids.length
    await VideoMessage.updateOne({ _id: doc._id, noteCount: { $gt: 0 } }, { $inc: { noteCount: -dropped } })
    if (removed.videoUrl) cleanupMediaInBackground([removed.videoUrl])

    const payload = { videoMessageId: String(doc._id), noteId: String(noteId) }
    if (doc.isGroup) {
      emitToMembers(doc, userId, 'videoMessage:noteDeleted', payload)
      for (const kid of kids) {
        emitToMembers(doc, userId, 'videoMessage:noteDeleted', { videoMessageId: String(doc._id), noteId: String(kid._id) })
      }
    } else {
      const otherId = iAmSender ? doc.receiver : doc.sender
      emitToUser(otherId, 'videoMessage:noteDeleted', payload)
      for (const kid of kids) {
        emitToUser(otherId, 'videoMessage:noteDeleted', { videoMessageId: String(doc._id), noteId: String(kid._id) })
      }
    }
    return res.status(200).json(payload)
  } catch (error) {
    console.error('[videoMessage] delete note error:', error)
    return res.status(500).json({ error: 'Failed to delete reply' })
  }
}

// ───────────────────────────── download one mixed video ─────────────────────────────

export const downloadVideoMessage = async (req, res) => {
  try {
    const doc = await loadForParticipant(req.params.id, req.user._id)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })
    const notes = await VideoNote.find({ videoMessage: doc._id })
      .sort({ t: 1, _id: 1 })
      .limit(NOTES_PAGE_SIZE)
      .lean()
    if (!needsMix(notes)) return res.json({ url: doc.videoUrl })
    const hash = exportHashFor(doc, notes)
    if (doc.exportHash === hash && doc.exportUrl) return res.json({ url: doc.exportUrl })
    const url = await prepareMixedVideo(doc, notes)
    const previous = doc.exportUrl && doc.exportUrl !== url ? doc.exportUrl : ''
    await VideoMessage.updateOne({ _id: doc._id }, { $set: { exportUrl: url, exportHash: hash } })
    if (previous) cleanupMediaInBackground([previous])
    return res.json({ url })
  } catch (error) {
    console.error('[videoMessage] download error:', error)
    return res.status(500).json({ error: 'Could not prepare the download' })
  }
}

// ───────────────────────────── delete whole video ─────────────────────────────

export const deleteVideoMessage = async (req, res) => {
  try {
    const userId = req.user._id
    const doc = await loadForParticipant(req.params.id, userId)
    if (!doc) return res.status(404).json({ error: 'Video message not found' })

    const noteUrls = await VideoNote.find({ videoMessage: doc._id, videoUrl: { $exists: true, $ne: '' } })
      .select('videoUrl')
      .limit(NOTES_PAGE_SIZE)
      .lean()
    const receipts = doc.isGroup
      ? await VideoMessageReceipt.find({ videoMessage: doc._id }).select('user seenAt unseenNotes recipient').lean()
      : []

    await Promise.all([
      VideoMessage.deleteOne({ _id: doc._id }),
      VideoNote.deleteMany({ videoMessage: doc._id }),
      doc.isGroup ? VideoMessageReceipt.deleteMany({ videoMessage: doc._id }) : Promise.resolve(),
    ])

    cleanupMediaInBackground([doc.videoUrl, doc.thumbnailUrl, doc.exportUrl, ...noteUrls.map((n) => n.videoUrl)])

    const idStr = String(doc._id)
    if (doc.isGroup) {
      for (const row of receipts) {
        const unseen = (row.recipient && !row.seenAt) || (row.unseenNotes || 0) > 0
        emitToUser(row.user, 'videoMessage:deleted', { _id: idStr, unseen })
      }
    } else {
      const tell = (uid) => {
        const isReceiver = String(doc.receiver) === String(uid)
        const unseen = isReceiver ? !doc.seenAt : !!doc.senderHasNewNotes
        emitToUser(uid, 'videoMessage:deleted', { _id: idStr, unseen })
      }
      tell(doc.sender)
      tell(doc.receiver)
    }
    return res.status(200).json({ _id: idStr })
  } catch (error) {
    console.error('[videoMessage] delete error:', error)
    return res.status(500).json({ error: 'Failed to delete video message' })
  }
}
