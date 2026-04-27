import Capsule from '../models/capsule.js'
import Post from '../models/post.js'
import Notification from '../models/notification.js'
import { getIO, getRecipientSockedId } from '../socket/socket.js'

const CAPSULE_RETENTION_MS = Number(process.env.CAPSULE_RETENTION_MS || (14 * 24 * 60 * 60 * 1000))
const DURATIONS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
}

/** POST /api/capsule/seal  — seal a post as a capsule */
export const sealCapsule = async (req, res) => {
  try {
    const { postId, duration, clientNow } = req.body
    const userId = req.user._id

    if (!postId || !DURATIONS[duration]) {
      return res.status(400).json({ error: 'postId and duration (1m/5m/1h/3d) required' })
    }

    const post = await Post.findById(postId).lean()
    if (!post) return res.status(404).json({ error: 'Post not found' })
    const postIdStr = String(post?._id || '')
    const isNormalFeedPost = !(
      post?.footballData ||
      post?.weatherData ||
      post?.chessGameData ||
      post?.cardGameData ||
      post?.raceGameData ||
      post?.isMatchReaction ||
      postIdStr.startsWith('live_')
    )
    if (!isNormalFeedPost) {
      return res.status(400).json({ error: 'Moment Capsule works only on normal feed posts' })
    }

    // Use client time if provided (helps when server clock drifts), but clamp to sane range.
    const nowServer = Date.now()
    const nowClient = Number(clientNow)
    const useClientClock = Number.isFinite(nowClient) && Math.abs(nowClient - nowServer) <= 60 * 60 * 1000
    const baseNow = useClientClock ? nowClient : nowServer

    const openAt = new Date(baseNow + DURATIONS[duration])
    const expiresAt = new Date(openAt.getTime() + CAPSULE_RETENTION_MS)

    const capsule = await Capsule.findOneAndUpdate(
      { postId, sealedBy: userId },
      { openAt, opened: false, notified: false, expiresAt },
      { upsert: true, new: true }
    )

    return res.status(200).json(capsule)
  } catch (err) {
    console.error('sealCapsule error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

/** DELETE /api/capsule/unseal/:postId  — remove a capsule seal */
export const unsealCapsule = async (req, res) => {
  try {
    const { postId } = req.params
    const userId = req.user._id
    await Capsule.findOneAndDelete({ postId, sealedBy: userId })
    return res.status(200).json({ message: 'Capsule removed' })
  } catch (err) {
    console.error('unsealCapsule error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

/** GET /api/capsule/mine  — get current user's capsules */
export const getMyCapsules = async (req, res) => {
  try {
    const userId = req.user._id
    const capsules = await Capsule.find({ sealedBy: userId })
      .populate('postId', 'text img postedBy createdAt')
      .sort({ openAt: 1 })
      .lean()
    return res.status(200).json(capsules)
  } catch (err) {
    console.error('getMyCapsules error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

/** GET /api/capsule/status/:postId  — check if current user sealed a post */
export const getCapsuleStatus = async (req, res) => {
  try {
    const { postId } = req.params
    const userId = req.user._id
    const capsule = await Capsule.findOne({ postId, sealedBy: userId }).lean()
    return res.status(200).json(capsule || null)
  } catch (err) {
    console.error('getCapsuleStatus error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

/** GET /api/capsule/count/:postId  — public seal count on a post */
export const getCapsuleCount = async (req, res) => {
  try {
    const { postId } = req.params
    const count = await Capsule.countDocuments({ postId })
    return res.status(200).json({ count })
  } catch (err) {
    console.error('getCapsuleCount error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

/**
 * Background job: check for opened capsules and notify users.
 * Call this on a timer (e.g. setInterval every minute) from index.js.
 */
export const processDueCapsules = async () => {
  try {
    const due = await Capsule.find({ opened: false, openAt: { $lte: new Date() } })
      .populate('sealedBy', 'name username')
      .populate('postId', 'text img postedBy')
      .lean()

    if (!due.length) return

    const ids = due.map(c => c._id)

    // Send notifications (database + realtime socket push)
    const io = getIO()
    for (const capsule of due) {
      if (!capsule.postId) continue
      try {
        const created = await Notification.create({
          user: capsule.sealedBy._id,
          from: capsule.sealedBy._id,
          type: 'capsule_opened',
          post: capsule.postId._id,
          metadata: { capsuleOpenAt: capsule.openAt },
        })

        const populated = await Notification.findById(created._id)
          .populate('from', 'username name profilePic')
          .populate({
            path: 'post',
            select: 'text img postedBy',
            populate: { path: 'postedBy', select: 'username name' },
          })
          .lean()

        const socketId = await getRecipientSockedId(capsule.sealedBy._id)
        if (io && socketId && populated) {
          io.to(socketId).emit('newNotification', populated)
        }
      } catch (_) {}
    }

    // Scale-first cleanup: remove delivered reminders immediately.
    // This keeps Capsule collection bounded even with millions of users.
    await Capsule.deleteMany({ _id: { $in: ids } })
  } catch (err) {
    console.error('processDueCapsules error:', err)
  }
}
