import Capsule from '../models/capsule.js'
import Post from '../models/post.js'
import Notification from '../models/notification.js'
import User from '../models/user.js'

const DURATIONS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
}

/** POST /api/capsule/seal  — seal a post as a capsule */
export const sealCapsule = async (req, res) => {
  try {
    const { postId, duration } = req.body
    const userId = req.user._id

    if (!postId || !DURATIONS[duration]) {
      return res.status(400).json({ error: 'postId and duration (7d/30d/1y) required' })
    }

    const post = await Post.findById(postId).lean()
    if (!post) return res.status(404).json({ error: 'Post not found' })

    const openAt = new Date(Date.now() + DURATIONS[duration])

    const capsule = await Capsule.findOneAndUpdate(
      { postId, sealedBy: userId },
      { openAt, opened: false, notified: false },
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

    // Mark as opened
    await Capsule.updateMany({ _id: { $in: ids } }, { opened: true, notified: true })

    // Send notifications
    for (const capsule of due) {
      if (!capsule.postId) continue
      try {
        await Notification.create({
          to: capsule.sealedBy._id,
          from: capsule.sealedBy._id,
          type: 'capsule_opened',
          post: capsule.postId._id,
        })
      } catch (_) {}
    }
  } catch (err) {
    console.error('processDueCapsules error:', err)
  }
}
