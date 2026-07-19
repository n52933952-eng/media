import Activity from '../models/activity.js'
import { getIO, getUserSelfRoomId } from '../socket/socket.js'
import Follow from '../models/follow.js'

// How long an activity stays visible/stored. Keep server + clients in sync.
export const ACTIVITY_RETENTION_HOURS = 12
const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_HOURS * 60 * 60 * 1000

// Max activities kept per creator. Keep server + clients in sync.
export const ACTIVITY_MAX_PER_USER = 40

/** Fan-out newActivity to followers' self-rooms in the background (non-blocking). */
function emitActivityToFollowersInBackground(userId, activityPayload) {
  setImmediate(async () => {
    try {
      const io = getIO()
      if (!io) return

      // Cap worst-case fan-out. Offline followers still get activities on next fetch.
      const followerDocs = await Follow.find({ followeeId: userId })
        .select('followerId')
        .limit(5000)
        .lean()
      if (!followerDocs?.length) return

      const rooms = []
      for (const d of followerDocs) {
        const fid = d.followerId?.toString?.() ?? String(d.followerId || '')
        const room = getUserSelfRoomId(fid)
        if (room) rooms.push(room)
      }
      if (!rooms.length) return

      // Batch room emits so one huge io.to([...5000]) array isn't built at once.
      const BATCH = 200
      for (let i = 0; i < rooms.length; i += BATCH) {
        const chunk = rooms.slice(i, i + BATCH)
        io.to(chunk).emit('newActivity', activityPayload)
      }
    } catch (error) {
      console.error('Error emitting activity to followers:', error?.message || error)
    }
  })
}

// Create an activity and emit to followers
export const createActivity = async (userId, type, options = {}) => {
  try {
    // Delete this user's activities past the retention window
    const retentionCutoff = new Date(Date.now() - ACTIVITY_RETENTION_MS)
    await Activity.deleteMany({
      userId: userId,
      createdAt: { $lt: retentionCutoff },
    })

    // Cap at ACTIVITY_MAX_PER_USER — drop oldest if at/over limit
    const activityCount = await Activity.countDocuments({ userId: userId })
    if (activityCount >= ACTIVITY_MAX_PER_USER) {
      const oldestActivity = await Activity.findOne({ userId: userId }).sort({ createdAt: 1 })
      if (oldestActivity) {
        await Activity.findByIdAndDelete(oldestActivity._id)
      }
    }

    const activity = new Activity({
      userId: userId,
      type: type,
      targetUser: options.targetUser || null,
      postId: options.postId || null,
      metadata: options.metadata || {},
    })

    await activity.save()

    await activity.populate('userId', 'username name profilePic')
    if (activity.targetUser) {
      await activity.populate('targetUser', 'username name profilePic')
    }
    if (activity.postId) {
      await activity.populate({
        path: 'postId',
        select: 'text img postedBy',
        populate: {
          path: 'postedBy',
          select: 'username name profilePic',
        },
      })
    }

    // Plain object for Socket.IO so dates serialize as ISO strings
    const activityPayload = activity.toObject({ virtuals: true })

    // Don't block the like/comment/follow request on fan-out.
    emitActivityToFollowersInBackground(userId, activityPayload)

    return activity
  } catch (error) {
    console.error('Error creating activity:', error)
    return null
  }
}

// Get activities for a user (their friends' activities)
export const getActivities = async (req, res) => {
  try {
    const userId = req.user._id
    const limit = ACTIVITY_MAX_PER_USER

    const followingDocs = await Follow.find({ followerId: userId })
      .select('followeeId')
      .limit(5000)
      .lean()
    const followingIds = followingDocs.map(
      (d) => d.followeeId?.toString?.() ?? String(d.followeeId),
    )

    const retentionCutoff = new Date(Date.now() - ACTIVITY_RETENTION_MS)

    const activities = await Activity.find({
      userId: { $in: followingIds },
      createdAt: { $gte: retentionCutoff },
    })
      .populate('userId', 'username name profilePic')
      .populate('targetUser', 'username name profilePic')
      .populate({
        path: 'postId',
        select: 'text img postedBy',
        populate: {
          path: 'postedBy',
          select: 'username name profilePic',
        },
      })
      .sort({ createdAt: -1 })
      .limit(limit)

    res.status(200).json({ activities })
  } catch (error) {
    console.error('Error fetching activities:', error)
    res.status(500).json({ error: error.message })
  }
}

// Delete a specific activity (for manual removal by user)
export const deleteActivity = async (req, res) => {
  try {
    const { activityId } = req.params
    const userId = req.user._id

    const activity = await Activity.findById(activityId)
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' })
    }

    const followingDocs = await Follow.find({ followerId: userId })
      .select('followeeId')
      .limit(5000)
      .lean()
    const followingIds = followingDocs.map(
      (d) => d.followeeId?.toString?.() ?? String(d.followeeId),
    )
    const activityUserId = activity.userId?.toString() || activity.userId

    if (!followingIds.includes(activityUserId)) {
      return res.status(403).json({ error: 'You can only delete activities from users you follow' })
    }

    await Activity.findByIdAndDelete(activityId)

    res.status(200).json({ message: 'Activity deleted successfully' })
  } catch (error) {
    console.error('Error deleting activity:', error)
    res.status(500).json({ error: error.message })
  }
}

// Cleanup old activities (older than retention window) - call this periodically
export const cleanupOldActivities = async () => {
  try {
    const retentionCutoff = new Date(Date.now() - ACTIVITY_RETENTION_MS)

    console.log(
      `🧹 [cleanupOldActivities] Deleting activities older than ${ACTIVITY_RETENTION_HOURS}h (before ${retentionCutoff.toISOString()})`,
    )

    const result = await Activity.deleteMany({
      createdAt: { $lt: retentionCutoff },
    })

    console.log(
      result.deletedCount > 0
        ? `✅ [cleanupOldActivities] Deleted ${result.deletedCount} old activities`
        : `✅ [cleanupOldActivities] No old activities to delete`,
    )

    // Ensure each user has max ACTIVITY_MAX_PER_USER
    const usersWithActivities = await Activity.distinct('userId')
    let totalDeletedForLimit = 0

    for (const uid of usersWithActivities) {
      const count = await Activity.countDocuments({ userId: uid })
      if (count > ACTIVITY_MAX_PER_USER) {
        const activitiesToDelete = await Activity.find({ userId: uid })
          .sort({ createdAt: 1 })
          .limit(count - ACTIVITY_MAX_PER_USER)

        const idsToDelete = activitiesToDelete.map((a) => a._id)
        if (idsToDelete.length > 0) {
          await Activity.deleteMany({ _id: { $in: idsToDelete } })
          totalDeletedForLimit += idsToDelete.length
        }
      }
    }

    if (totalDeletedForLimit > 0) {
      console.log(
        `✅ [cleanupOldActivities] Trimmed ${totalDeletedForLimit} over-limit activities (cap ${ACTIVITY_MAX_PER_USER})`,
      )
    }

    const remainingCount = await Activity.countDocuments({})
    console.log(`📊 [cleanupOldActivities] Done — ${remainingCount} activities remaining`)
  } catch (error) {
    console.error('Error cleaning up old activities:', error)
  }
}
