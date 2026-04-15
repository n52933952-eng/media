import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'
import Story from '../models/story.js'
import User from '../models/user.js'
import Follow from '../models/follow.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'

const CLOUDINARY_UPLOAD_QUALITY = (process.env.CLOUDINARY_UPLOAD_QUALITY || 'auto:eco').trim()

/** Tell followers + author (socket) to refetch `/api/story/feed-strip` so rings / red vs gray stay in sync. */
async function emitStoryStripChanged(authorUserId) {
  try {
    const io = getIO()
    if (!io) return
    const aid = authorUserId?.toString?.() ?? String(authorUserId)
    const followerDocs = await Follow.find({ followeeId: aid }).select('followerId').limit(10000).lean()
    const socketMap = await getAllUserSockets()
    const targets = new Set([aid])
    for (const d of followerDocs || []) {
      const fid = d.followerId?.toString?.() ?? String(d.followerId)
      if (fid) targets.add(fid)
    }
    for (const fid of targets) {
      const sock = socketMap[fid]
      const sid = sock?.socketId
      if (sid) io.to(sid).emit('storyStripChanged', { authorUserId: aid })
    }
  } catch (e) {
    console.error('❌ [story] emitStoryStripChanged:', e?.message || e)
  }
}

/** After someone opens a story, only they need a fresh strip (hasUnviewed → false for that author). */
async function emitStoryStripChangedForViewer(viewerUserId) {
  try {
    const io = getIO()
    if (!io) return
    const vid = viewerUserId?.toString?.() ?? String(viewerUserId)
    const socketMap = await getAllUserSockets()
    const sid = socketMap[vid]?.socketId
    if (sid) io.to(sid).emit('storyStripChanged', { viewerRefresh: true })
  } catch (e) {
    console.error('❌ [story] emitStoryStripChangedForViewer:', e?.message || e)
  }
}

const STORY_MAX_VIDEO_SEC = 20
const STORY_TTL_MS = 24 * 60 * 60 * 1000
/** Max slides in one active story (across multiple “Share” sessions until 24h expiry) */
const STORY_MAX_TOTAL_SLIDES = 50

function uploadBufferToCloudinary(buffer, mimetype) {
  const isVideo = mimetype.startsWith('video/')
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: isVideo ? 'video' : 'image',
        folder: 'stories',
        timeout: 1200000,
        chunk_size: 6000000,
        ...(isVideo
          ? {
              transformation: [
                {
                  width: 1080,
                  crop: 'limit',
                  quality: CLOUDINARY_UPLOAD_QUALITY,
                  fetch_format: 'mp4',
                  video_codec: 'auto',
                  audio_codec: 'aac',
                },
              ],
            }
          : {
              transformation: [
                {
                  quality: CLOUDINARY_UPLOAD_QUALITY,
                  fetch_format: 'auto',
                },
              ],
            }),
      },
      (error, result) => {
        if (error) reject(error)
        else resolve(result)
      }
    )
    Readable.from(buffer).pipe(stream)
  })
}

/** POST — multipart field `files` (array) */
export const createStory = async (req, res) => {
  try {
    const files = req.files
    if (!files?.length) {
      return res.status(400).json({ error: 'At least one image or video is required' })
    }

    const userId = req.user._id.toString()

    // Optional overlay text. Supports either:
    // - text: single string applied to all uploaded slides
    // - texts: JSON array (same length as files) for per-slide captions
    const textAll = (req.body?.text || '').toString().slice(0, 300)
    let texts = null
    try {
      const raw = req.body?.texts
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(parsed)) {
          texts = parsed.map((x) => (x == null ? '' : String(x))).map((s) => s.slice(0, 300))
        }
      }
    } catch (_) {
      texts = null
    }

    const existing = await Story.findOne({
      user: userId,
      expiresAt: { $gt: new Date() },
    })
    const currentLen = existing?.slides?.length ?? 0
    if (currentLen + files.length > STORY_MAX_TOTAL_SLIDES) {
      return res.status(400).json({
        error: `Your story can have at most ${STORY_MAX_TOTAL_SLIDES} items before it expires (24h).`,
      })
    }

    const slides = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const isVideo = file.mimetype.startsWith('video/')
      const result = await uploadBufferToCloudinary(file.buffer, file.mimetype)
      const slideText = (texts && typeof texts[i] === 'string' ? texts[i] : textAll) || ''

      if (isVideo) {
        const dur = typeof result.duration === 'number' ? result.duration : parseFloat(result.duration) || 0
        if (dur > STORY_MAX_VIDEO_SEC + 0.5) {
          try {
            await cloudinary.uploader.destroy(result.public_id, { resource_type: 'video' })
          } catch (_) {}
          return res.status(400).json({ error: `Each video must be ${STORY_MAX_VIDEO_SEC} seconds or less` })
        }
        slides.push({
          type: 'video',
          url: result.secure_url,
          publicId: result.public_id || '',
          text: slideText,
          durationSec: Math.min(dur || STORY_MAX_VIDEO_SEC, STORY_MAX_VIDEO_SEC),
        })
      } else {
        slides.push({
          type: 'image',
          url: result.secure_url,
          publicId: result.public_id || '',
          text: slideText,
          durationSec: 5,
        })
      }
    }

    if (existing) {
      existing.slides = [...(existing.slides || []), ...slides]
      // New segments should show as unviewed for followers (story-level view flag).
      existing.viewers = []
      await existing.save()
      await existing.populate('user', 'username profilePic name')
      void emitStoryStripChanged(userId)
      return res.status(200).json({ story: existing, appended: true })
    }

    await Story.deleteMany({
      user: userId,
      expiresAt: { $gt: new Date() },
    })

    const expiresAt = new Date(Date.now() + STORY_TTL_MS)
    const story = new Story({
      user: userId,
      slides,
      expiresAt,
      viewers: [],
    })
    await story.save()
    await story.populate('user', 'username profilePic name')

    void emitStoryStripChanged(userId)
    return res.status(201).json({ story, appended: false })
  } catch (e) {
    console.error('❌ [createStory]', e)
    return res.status(500).json({ error: e.message || 'Failed to create story' })
  }
}

/** DELETE — remove current user's active story */
export const deleteMyStory = async (req, res) => {
  try {
    const userId = req.user._id
    const active = await Story.findOne({ user: userId, expiresAt: { $gt: new Date() } })
    if (!active) {
      return res.status(404).json({ error: 'No active story' })
    }
    for (const s of active.slides || []) {
      if (s.publicId) {
        try {
          await cloudinary.uploader.destroy(s.publicId, {
            resource_type: s.type === 'video' ? 'video' : 'image',
          })
        } catch (_) {}
      }
    }
    await Story.deleteOne({ _id: active._id })
    void emitStoryStripChanged(userId)
    return res.json({ ok: true })
  } catch (e) {
    console.error('❌ [deleteMyStory]', e)
    return res.status(500).json({ error: e.message || 'Failed to delete story' })
  }
}

/** DELETE — remove ONE slide from current user's active story.
 *  Query: ?index=<number>&publicId=<string>&url=<string>
 *  We accept index for UI simplicity, and verify by publicId/url to prevent "auto-advance" deleting the wrong slide.
 *  If it was the last slide, the whole story is deleted.
 */
export const deleteMyStorySlide = async (req, res) => {
  try {
    const userId = req.user._id
    const active = await Story.findOne({ user: userId, expiresAt: { $gt: new Date() } })
    if (!active) {
      return res.status(404).json({ error: 'No active story' })
    }

    const rawIndex = req.query.index
    const index = Number.parseInt(String(rawIndex), 10)
    if (!Number.isFinite(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid index' })
    }

    const expectedPublicId = (req.query.publicId || '').toString().trim()
    const expectedUrl = (req.query.url || '').toString().trim()

    const slides = Array.isArray(active.slides) ? active.slides : []
    if (index >= slides.length) {
      return res.status(400).json({ error: 'Index out of range' })
    }

    const atIndex = slides[index]
    let deleteIdx = index

    // Verify target slide matches what client saw to avoid deleting the wrong slide if it advanced.
    const matchesExpected =
      (!!expectedPublicId && atIndex?.publicId && String(atIndex.publicId) === expectedPublicId) ||
      (!!expectedUrl && atIndex?.url && String(atIndex.url) === expectedUrl)

    if (!matchesExpected && (expectedPublicId || expectedUrl)) {
      const found = slides.findIndex((s) => {
        if (!s) return false
        if (expectedPublicId && s.publicId && String(s.publicId) === expectedPublicId) return true
        if (expectedUrl && s.url && String(s.url) === expectedUrl) return true
        return false
      })
      if (found >= 0) {
        deleteIdx = found
      } else {
        return res.status(409).json({ error: 'Story changed. Please try again.' })
      }
    }

    const target = slides[deleteIdx]
    if (target?.publicId) {
      try {
        await cloudinary.uploader.destroy(String(target.publicId), {
          resource_type: target.type === 'video' ? 'video' : 'image',
        })
      } catch (_) {}
    }

    active.slides.splice(deleteIdx, 1)

    if (!active.slides.length) {
      await Story.deleteOne({ _id: active._id })
      void emitStoryStripChanged(userId)
      return res.json({ ok: true, deletedAll: true })
    }

    await active.save()
    const fresh = await Story.findById(active._id)
      .populate('user', 'username profilePic name')
      .populate('viewers.user', 'username profilePic name')
      .lean()

    void emitStoryStripChanged(userId)
    return res.json({ ok: true, deletedAll: false, story: fresh })
  } catch (e) {
    console.error('❌ [deleteMyStorySlide]', e)
    return res.status(500).json({ error: e.message || 'Failed to delete story' })
  }
}

/** GET — whether user has an active story + unviewed (does not record a view) */
export const getStoryStatus = async (req, res) => {
  try {
    const { userId } = req.params
    const story = await Story.findOne({
      user: userId,
      expiresAt: { $gt: new Date() },
    })
      .select('_id viewers slides')
      .lean()

    if (!story) {
      return res.json({ active: false })
    }

    const viewed = (story.viewers || []).some(
      (v) => (v.user?.toString?.() || v.user) === req.user._id.toString()
    )
    return res.json({
      active: true,
      storyId: story._id,
      // Same as Instagram: poster sees “new” ring until they open their own story; then gray.
      hasUnviewed: !viewed,
      slideCount: (story.slides || []).length,
    })
  } catch (e) {
    console.error('❌ [getStoryStatus]', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}

/** GET — followers + self with active stories + unviewed flag */
export const getFeedStrip = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following').lean()
    const following = (me?.following || []).map((id) => id.toString())
    const ids = [...new Set([...following, req.user._id.toString()])]

    const stories = await Story.find({
      user: { $in: ids },
      expiresAt: { $gt: new Date() },
    })
      .populate('user', 'username profilePic name')
      .sort({ updatedAt: -1 })
      .lean()

    const byUser = new Map()
    for (const s of stories) {
      const uid = s.user?._id?.toString() || s.user?.toString()
      if (!uid) continue
      if (!byUser.has(uid)) byUser.set(uid, s)
    }

    const out = []
    for (const [, s] of byUser) {
      const uid = s.user?._id?.toString() || s.user?.toString()
      const viewed = (s.viewers || []).some((v) => (v.user?.toString?.() || v.user) === req.user._id.toString())
      out.push({
        storyId: s._id,
        user: s.user,
        slideCount: (s.slides || []).length,
        hasUnviewed: !viewed,
        expiresAt: s.expiresAt,
      })
    }

    return res.json({ stories: out })
  } catch (e) {
    console.error('❌ [getFeedStrip]', e)
    return res.status(500).json({ error: e.message || 'Failed to load stories' })
  }
}

/** GET — open story by user id (records view for others) */
export const getStoryByUser = async (req, res) => {
  try {
    const { userId } = req.params
    const story = await Story.findOne({
      user: userId,
      expiresAt: { $gt: new Date() },
    }).populate('user', 'username profilePic name')

    if (!story) {
      return res.status(404).json({ error: 'No active story' })
    }

    const isOwner = userId === req.user._id.toString()

    // Record view for opener too (including owner) so poster’s ring turns gray after they watch — Instagram-style.
    await Story.updateOne(
      { _id: story._id },
      { $pull: { viewers: { user: req.user._id } } }
    )
    await Story.updateOne(
      { _id: story._id },
      { $push: { viewers: { user: req.user._id, viewedAt: new Date() } } }
    )

    const fresh = await Story.findById(story._id)
      .populate('user', 'username profilePic name')
      .populate('viewers.user', 'username profilePic name')
      .lean()

    const allViewers = fresh?.viewers || []
    const viewersForOwner =
      isOwner
        ? allViewers.filter(
            (v) => (v.user?._id?.toString?.() || v.user?.toString?.() || v.user) !== req.user._id.toString()
          )
        : undefined

    void emitStoryStripChangedForViewer(req.user._id)

    return res.json({
      story: fresh,
      isOwner,
      viewers: isOwner ? viewersForOwner : undefined,
    })
  } catch (e) {
    console.error('❌ [getStoryByUser]', e)
    return res.status(500).json({ error: e.message || 'Failed to load story' })
  }
}

/** GET — viewer list (owner only) */
export const getStoryViewers = async (req, res) => {
  try {
    const { storyId } = req.params
    const story = await Story.findById(storyId).populate('viewers.user', 'username profilePic name')
    if (!story) return res.status(404).json({ error: 'Story not found' })
    if (story.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const list = (story.viewers || []).filter(
      (v) => (v.user?._id?.toString?.() || v.user?.toString?.() || v.user) !== req.user._id.toString()
    )
    return res.json({ viewers: list })
  } catch (e) {
    console.error('❌ [getStoryViewers]', e)
    return res.status(500).json({ error: e.message || 'Failed to load viewers' })
  }
}

/**
 * Remove expired stories from MongoDB and delete slide assets on Cloudinary.
 * Safe to run on a schedule; API already hides expired docs via expiresAt > now.
 */
export async function cleanupExpiredStories() {
  const now = new Date()
  const batchSize = 40
  let totalDeleted = 0

  for (;;) {
    const batch = await Story.find({ expiresAt: { $lte: now } })
      .limit(batchSize)
      .select('_id user slides')
      .lean()

    if (!batch.length) break

    const authorIds = new Set()
    for (const doc of batch) {
      const uid = doc.user?.toString?.() ?? String(doc.user)
      if (uid) authorIds.add(uid)
      for (const s of doc.slides || []) {
        if (s?.publicId) {
          try {
            await cloudinary.uploader.destroy(String(s.publicId), {
              resource_type: s.type === 'video' ? 'video' : 'image',
            })
          } catch (_) {}
        }
      }
    }

    const ids = batch.map((d) => d._id)
    const r = await Story.deleteMany({ _id: { $in: ids } })
    totalDeleted += r.deletedCount || 0

    for (const aid of authorIds) {
      void emitStoryStripChanged(aid)
    }

    if (batch.length < batchSize) break
  }

  if (totalDeleted > 0) {
    console.log(`🧹 [story] cleanupExpiredStories: removed ${totalDeleted} expired stor(y/ies) from DB + Cloudinary`)
  }
}
