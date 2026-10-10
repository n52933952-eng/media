import mongoose from 'mongoose'
import Post from '../models/post.js'
import PostPinAnswer from '../models/postPinAnswer.js'
import Follow from '../models/follow.js'
import { assertManagedMediaUrls } from '../services/r2Presign.js'
import { deleteMediaAsset } from '../services/mediaStorage.js'
import { getIO } from '../socket/socket.js'
import { emitToUserIds } from '../services/postSocketEmit.js'
import { invalidateUserFeedCaches } from '../services/feedCache.js'

const MAX_PINS = 8
const MAX_TEXT = 120
const MAX_ANSWER = 200
const MAX_T = 3600
const PAGE = 20

function mediaKind(post) {
  if (!post || post.isCollaborative) return null
  if (Array.isArray(post.images) && post.images.length > 1) return null
  const img = String(post.img || '')
  if (!img) return null
  if (/youtube|youtu\.be|dailymotion|vimeo/i.test(img)) return null
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(img) || img.includes('/video/')) return 'video'
  if (/\.(jpe?g|png|gif|webp|heic|avif)(\?|$)/i.test(img) || img.includes('/image/')) return 'photo'
  return null
}

function cleanPin(body, kind) {
  const pinType = String(body?.pinType || '')
  if (!['text', 'question', 'mark', 'photo'].includes(pinType)) {
    return { error: 'Pick text, question, mark, or photo' }
  }
  const text = String(body?.text || '').trim().slice(0, MAX_TEXT)
  if ((pinType === 'text' || pinType === 'question') && !text) {
    return { error: 'Add a short line' }
  }
  const pin = { pinType, text, t: null, x: null, y: null, imageUrl: '' }
  if (kind === 'video') {
    const t = Number(body?.t)
    if (!Number.isFinite(t) || t < 0 || t > MAX_T) return { error: 'Pick a second in the video' }
    pin.t = Math.round(t * 10) / 10
  } else {
    const x = Number(body?.x)
    const y = Number(body?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return { error: 'Tap the photo to place it' }
    }
    pin.x = Math.round(x * 1000) / 1000
    pin.y = Math.round(y * 1000) / 1000
  }
  if (pinType === 'photo') {
    const imageUrl = String(body?.imageUrl || '').trim()
    if (!imageUrl) return { error: 'Add a photo' }
    try {
      assertManagedMediaUrls([imageUrl])
    } catch (e) {
      return { error: e.message || 'Invalid photo' }
    }
    pin.imageUrl = imageUrl
  }
  return { pin }
}

async function loadOwned(id, userId) {
  if (!mongoose.isValidObjectId(id)) return { status: 404, error: 'Post not found' }
  const post = await Post.findById(id).select('postedBy img images pins isCollaborative')
  if (!post) return { status: 404, error: 'Post not found' }
  const owner = post.postedBy?._id || post.postedBy
  if (String(owner) !== String(userId)) return { status: 403, error: 'Only the author can add pins' }
  const kind = mediaKind(post)
  if (!kind) return { status: 400, error: 'Pins work on a single photo or video' }
  return { post, kind }
}

/** Tell followers the pins changed. Does not send the whole post, so the feed order stays put. */
async function emitPins(post, pins) {
  const io = getIO()
  if (!io) return
  const ownerId = post.postedBy?._id || post.postedBy
  const followerDocs = await Follow.find({ followeeId: ownerId }).select('followerId').limit(10000).lean()
  const ids = new Set([String(ownerId)])
  for (const row of followerDocs) {
    if (row.followerId) ids.add(String(row.followerId))
  }
  const recipientIds = [...ids]
  await emitToUserIds(io, recipientIds, 'postPins', {
    postId: String(post._id),
    pins,
  })
  invalidateUserFeedCaches(recipientIds).catch(() => {})
}

export const addPostPin = async (req, res) => {
  try {
    const loaded = await loadOwned(req.params.id, req.user._id)
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error })
    if ((loaded.post.pins || []).length >= MAX_PINS) {
      return res.status(400).json({ error: `Maximum ${MAX_PINS} pins` })
    }
    const cleaned = cleanPin(req.body, loaded.kind)
    if (cleaned.error) return res.status(400).json({ error: cleaned.error })

    const updated = await Post.findOneAndUpdate(
      {
        _id: loaded.post._id,
        $expr: { $lt: [{ $size: { $ifNull: ['$pins', []] } }, MAX_PINS] },
      },
      { $push: { pins: cleaned.pin } },
      { new: true, timestamps: false, projection: { pins: 1 } },
    )
    if (!updated) return res.status(400).json({ error: `Maximum ${MAX_PINS} pins` })
    const pins = updated.pins || []
    await emitPins(loaded.post, pins)
    return res.status(201).json({ pins })
  } catch (error) {
    console.error('[postPin] add error:', error)
    return res.status(500).json({ error: 'Failed to add pin' })
  }
}

export const removePostPin = async (req, res) => {
  try {
    const loaded = await loadOwned(req.params.id, req.user._id)
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error })
    const pin = (loaded.post.pins || []).find((p) => String(p._id) === String(req.params.pinId))
    if (!pin) return res.status(404).json({ error: 'Pin not found' })

    const updated = await Post.findByIdAndUpdate(
      loaded.post._id,
      { $pull: { pins: { _id: pin._id } } },
      { new: true, timestamps: false, projection: { pins: 1 } },
    )
    await PostPinAnswer.deleteMany({ post: loaded.post._id, pinId: pin._id })
    if (pin.pinType === 'photo' && pin.imageUrl) {
      deleteMediaAsset(pin.imageUrl).catch(() => {})
    }
    const pins = updated?.pins || []
    await emitPins(loaded.post, pins)
    return res.status(200).json({ pins })
  } catch (error) {
    console.error('[postPin] remove error:', error)
    return res.status(500).json({ error: 'Failed to remove pin' })
  }
}

export const answerPostPin = async (req, res) => {
  try {
    const postId = req.params.id
    const pinId = req.params.pinId
    if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(pinId)) {
      return res.status(404).json({ error: 'Not found' })
    }
    const text = String(req.body?.text || '').trim().slice(0, MAX_ANSWER)
    if (!text) return res.status(400).json({ error: 'Write an answer' })

    const post = await Post.findById(postId).select('pins').lean()
    if (!post) return res.status(404).json({ error: 'Post not found' })
    const pin = (post.pins || []).find((p) => String(p._id) === String(pinId))
    if (!pin || pin.pinType !== 'question') return res.status(404).json({ error: 'Question not found' })

    const row = await PostPinAnswer.findOneAndUpdate(
      { post: postId, pinId, user: req.user._id },
      { $set: { text } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).populate('user', 'username name profilePic')
    return res.status(200).json({ answer: row })
  } catch (error) {
    console.error('[postPin] answer error:', error)
    return res.status(500).json({ error: 'Failed to answer' })
  }
}

export const listPostPinAnswers = async (req, res) => {
  try {
    const postId = req.params.id
    const pinId = req.params.pinId
    if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(pinId)) {
      return res.status(404).json({ error: 'Not found' })
    }
    const query = { post: postId, pinId }
    const cursor = String(req.query.cursor || '')
    if (cursor && mongoose.isValidObjectId(cursor)) query._id = { $lt: cursor }

    const rows = await PostPinAnswer.find(query)
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .populate('user', 'username name profilePic')
      .lean()
    const hasMore = rows.length > PAGE
    const answers = hasMore ? rows.slice(0, PAGE) : rows
    let mine = null
    if (req.user?._id) {
      mine = await PostPinAnswer.findOne({ post: postId, pinId, user: req.user._id })
        .populate('user', 'username name profilePic')
        .lean()
    }
    return res.status(200).json({
      answers,
      mine,
      nextCursor: hasMore ? String(answers[answers.length - 1]._id) : null,
    })
  } catch (error) {
    console.error('[postPin] list answers error:', error)
    return res.status(500).json({ error: 'Failed to load answers' })
  }
}
