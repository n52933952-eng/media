import Activity from '../models/activity.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'
import User from '../models/user.js'
import Follow from '../models/follow.js'

// Create an activity and emit to followers
export const createActivity = async (userId, type, options = {}) => {
    try {
        // Delete activities older than 6 hours
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
        await Activity.deleteMany({
            userId: userId,
            createdAt: { $lt: sixHoursAgo }
        })
        
        // Get current activity count for this user
        const activityCount = await Activity.countDocuments({ userId: userId })
        
        // If user already has 15 activities, delete the oldest one (replace with new)
        if (activityCount >= 15) {
            const oldestActivity = await Activity.findOne({ userId: userId })
                .sort({ createdAt: 1 }) // Oldest first
            if (oldestActivity) {
                await Activity.findByIdAndDelete(oldestActivity._id)
            }
        }
        
        const activity = new Activity({
            userId: userId,
            type: type,
            targetUser: options.targetUser || null,
            postId: options.postId || null,
            metadata: options.metadata || {}
        })

        await activity.save()
        
        // Populate user info
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
                    select: 'username name profilePic'
                }
            })
        }

        // Emit to user's followers (for activity feed)
        const io = getIO()
        if (io) {
            // Read-from-Follow: get follower ids (cap to reduce worst-case load)
            const followerDocs = await Follow.find({ followeeId: userId }).select('followerId').limit(5000).lean()
            if (followerDocs && followerDocs.length > 0) {
                const socketMap = await getAllUserSockets()
                
                followerDocs.forEach(d => {
                    const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
                    const socketData = socketMap[followerIdStr]
                    if (socketData && socketData.socketId) {
                        io.to(socketData.socketId).emit('newActivity', activity)
                    }
                })
            }
        }

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
        const limit = 15 // Always limit to 15 activities

        // Read-from-Follow: Get user's following list (cap for safety)
        const followingDocs = await Follow.find({ followerId: userId }).select('followeeId').limit(5000).lean()
        const followingIds = followingDocs.map(d => d.followeeId?.toString?.() ?? String(d.followeeId))

        // Only get activities from last 6 hours
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
        
        console.log(`📊 [getActivities] Fetching activities for ${followingIds.length} followed users`)
        console.log(`📊 [getActivities] Current time: ${new Date().toISOString()}, 6 hours ago: ${sixHoursAgo.toISOString()}`)

        // Get activities from users they follow (only recent ones, max 15)
        const activities = await Activity.find({
            userId: { $in: followingIds },
            createdAt: { $gte: sixHoursAgo } // Only activities from last 6 hours
        })
        .populate('userId', 'username name profilePic')
        .populate('targetUser', 'username name profilePic')
        .populate({
            path: 'postId',
            select: 'text img postedBy',
            populate: {
                path: 'postedBy',
                select: 'username name profilePic'
            }
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        
        // Log activity timestamps for debugging
        if (activities.length > 0) {
            const oldestActivity = activities[activities.length - 1];
            const newestActivity = activities[0];
            console.log(`📊 [getActivities] Found ${activities.length} activities:`);
            console.log(`   Oldest: ${oldestActivity.createdAt?.toISOString()} (${Math.round((Date.now() - new Date(oldestActivity.createdAt).getTime()) / (1000 * 60 * 60))}h ago)`);
            console.log(`   Newest: ${newestActivity.createdAt?.toISOString()} (${Math.round((Date.now() - new Date(newestActivity.createdAt).getTime()) / (1000 * 60))}m ago)`);
        } else {
            console.log(`📊 [getActivities] No activities found in last 6 hours`);
        }

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

        // Find the activity
        const activity = await Activity.findById(activityId)
        if (!activity) {
            return res.status(404).json({ error: 'Activity not found' })
        }

        // Read-from-Follow: Check if user is following the activity creator
        const followingDocs = await Follow.find({ followerId: userId }).select('followeeId').limit(5000).lean()
        const followingIds = followingDocs.map(d => d.followeeId?.toString?.() ?? String(d.followeeId))
        const activityUserId = activity.userId?.toString() || activity.userId

        if (!followingIds.includes(activityUserId)) {
            return res.status(403).json({ error: 'You can only delete activities from users you follow' })
        }

        // Delete the activity
        await Activity.findByIdAndDelete(activityId)

        res.status(200).json({ message: 'Activity deleted successfully' })
    } catch (error) {
        console.error('Error deleting activity:', error)
        res.status(500).json({ error: error.message })
    }
}

// Cleanup old activities (older than 6 hours) - call this periodically
export const cleanupOldActivities = async () => {
    try {
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
        const sixHoursAgoISO = sixHoursAgo.toISOString()
        
        console.log(`🧹 [cleanupOldActivities] Starting cleanup - deleting activities older than 6 hours (before ${sixHoursAgoISO})`)
        
        const result = await Activity.deleteMany({
            createdAt: { $lt: sixHoursAgo }
        })
        
        if (result.deletedCount > 0) {
            console.log(`✅ [cleanupOldActivities] Deleted ${result.deletedCount} old activities (older than 6 hours)`)
        } else {
            console.log(`✅ [cleanupOldActivities] No old activities to delete (all activities are within last 6 hours)`)
        }
        
        // Also ensure each user has max 15 activities (delete oldest if more)
        const usersWithActivities = await Activity.distinct('userId')
        let totalDeletedForLimit = 0
        
        for (const userId of usersWithActivities) {
            const count = await Activity.countDocuments({ userId: userId })
            if (count > 15) {
                const activitiesToDelete = await Activity.find({ userId: userId })
                    .sort({ createdAt: 1 }) // Oldest first
                    .limit(count - 15) // Keep only 15 most recent
                
                const idsToDelete = activitiesToDelete.map(a => a._id)
                if (idsToDelete.length > 0) {
                    await Activity.deleteMany({ _id: { $in: idsToDelete } })
                    totalDeletedForLimit += idsToDelete.length
                    console.log(`🧹 [cleanupOldActivities] Deleted ${idsToDelete.length} old activities for user ${userId} (kept 15 most recent, had ${count} total)`)
                }
            }
        }
        
        if (totalDeletedForLimit > 0) {
            console.log(`✅ [cleanupOldActivities] Total deleted for 15-activity limit: ${totalDeletedForLimit} activities`)
        }
        
        const remainingCount = await Activity.countDocuments({})
        console.log(`📊 [cleanupOldActivities] Cleanup complete - ${remainingCount} activities remaining in database`)
    } catch (error) {
        console.error('Error cleaning up old activities:', error)
    }
}


