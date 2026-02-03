import User from '../models/user.js'
import { getIO, getUserSocket } from '../socket/socket.js'
import * as redisService from '../services/redis.js'

// Helper functions (same as in socket.js)
const getActiveCall = async (callId) => {
    if (!redisService.isRedisAvailable()) {
        return null
    }
    try {
        // redisGet already parses JSON, so we don't need to parse again
        const callData = await redisService.redisGet(`activeCall:${callId}`)
        return callData || null
    } catch (error) {
        console.error(`❌ [call] Error getting active call ${callId}:`, error.message)
        return null
    }
}

const deleteActiveCall = async (callId) => {
    if (!redisService.isRedisAvailable()) {
        return
    }
    try {
        await redisService.redisDel(`activeCall:${callId}`)
    } catch (error) {
        console.error(`❌ [call] Error deleting active call ${callId}:`, error.message)
    }
}

const deletePendingCall = async (receiverId) => {
    if (!redisService.isRedisAvailable()) {
        return
    }
    try {
        await redisService.redisDel(`pendingCall:${receiverId}`)
    } catch (error) {
        console.error(`❌ [call] Error deleting pending call for ${receiverId}:`, error.message)
    }
}

const clearInCall = async (userId) => {
    if (!redisService.isRedisAvailable() || !userId) return
    try {
        await redisService.redisDel(`inCall:${String(userId).trim()}`)
    } catch (error) {
        console.error(`❌ [call] Error clearing inCall for ${userId}:`, error.message)
    }
}

/**
 * HTTP endpoint to cancel a call
 * POST /api/call/cancel
 * Body: { conversationId: callerId, sender: receiverId }
 * 
 * This allows canceling calls even when the app is killed
 */
export const cancelCall = async (req, res) => {
    try {
        const { conversationId, sender } = req.body

        if (!conversationId || !sender) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing conversationId or sender' 
            })
        }

        console.log(`📴 [HTTP cancelCall] Canceling call - conversationId: ${conversationId}, sender: ${sender}`)
        console.log(`📴 [HTTP cancelCall] Note: conversationId is the CALLER, sender is the RECEIVER (who declined)`)

        // Get socket IDs (same logic as socket handler)
        // conversationId = caller (who made the call)
        // sender = receiver (who declined the call)
        const callerData = await getUserSocket(conversationId)
        const callerSocketId = callerData?.socketId

        const receiverData = await getUserSocket(sender)
        const receiverSocketId = receiverData?.socketId
        
        console.log(`📴 [HTTP cancelCall] Socket IDs - Caller: ${callerSocketId || 'NOT CONNECTED'}, Receiver: ${receiverSocketId || 'NOT CONNECTED'}`)

        // Remove from active calls - try both possible call IDs
        const callId1 = `${sender}-${conversationId}`
        const callId2 = `${conversationId}-${sender}`
        const call1 = await getActiveCall(callId1)
        const call2 = await getActiveCall(callId2)
        if (call1) await deleteActiveCall(callId1)
        if (call2) await deleteActiveCall(callId2)
        
        // Delete pending call: keyed by receiver (sender = B who declined had the pending call when A called)
        await deletePendingCall(sender)
        await deletePendingCall(conversationId)

        // CRITICAL: Clear Redis inCall so isUserBusy returns false – allows recall after cancel
        await Promise.all([
            clearInCall(sender).catch(() => {}),
            clearInCall(conversationId).catch(() => {})
        ])

        // Update database - mark users as NOT in call (non-blocking, fire-and-forget)
        // OPTIMIZATION: Use Promise.all for parallel updates (faster for 1M+ users)
        // Don't await - fire and forget to ensure immediate cancellation response
        Promise.all([
            User.findByIdAndUpdate(sender, { inCall: false }).catch(err => 
                console.log('⚠️ [HTTP cancelCall] Error updating sender inCall status:', err)
            ),
            User.findByIdAndUpdate(conversationId, { inCall: false }).catch(err => 
                console.log('⚠️ [HTTP cancelCall] Error updating receiver inCall status:', err)
            )
        ]).then(() => {
            console.log('✅ [HTTP cancelCall] Database inCall status updated for both users')
        }).catch(err => {
            console.error('❌ [HTTP cancelCall] Error updating database inCall status:', err)
        })

        // Send FCM notification to stop ringtone
        try {
            const { sendCallEndedNotificationToUser } = await import('../services/fcmNotifications.js')
            const fcmResult = await sendCallEndedNotificationToUser(conversationId, sender)
            if (fcmResult.success) {
                console.log('✅ [HTTP cancelCall] Sent call ended FCM notification to receiver')
            } else {
                console.log('⚠️ [HTTP cancelCall] FCM call ended notification failed:', fcmResult.error)
            }
        } catch (fcmError) {
            console.error('❌ [HTTP cancelCall] Error sending FCM call ended notification:', fcmError)
        }

        // Emit socket events to notify both users
        // CRITICAL: Emit to CALLER (conversationId) so they know the call was declined
        // Also emit to RECEIVER (sender) in case they're online (though they already declined)
        const io = getIO()
        if (io) {
            // Emit to caller (conversationId) - this is the most important one
            if (callerSocketId) {
                console.log(`📴 [HTTP cancelCall] Emitting CallCanceled to CALLER (${conversationId}) at socket ${callerSocketId}`)
                io.to(callerSocketId).emit("CallCanceled")
            } else {
                console.warn(`⚠️ [HTTP cancelCall] Caller (${conversationId}) is NOT CONNECTED - CallCanceled event not sent`)
            }
            
            // Also emit to receiver (sender) - they already declined but good to confirm
            if (receiverSocketId) {
                console.log(`📴 [HTTP cancelCall] Emitting CallCanceled to RECEIVER (${sender}) at socket ${receiverSocketId}`)
                io.to(receiverSocketId).emit("CallCanceled")
            }
            
            // General broadcast (for other listeners if needed)
            io.emit("cancleCall", { userToCall: conversationId, from: sender })
        } else {
            console.error('❌ [HTTP cancelCall] Socket.IO instance not available!')
        }

        console.log(`✅ [HTTP cancelCall] Call canceled successfully`)
        return res.status(200).json({ 
            success: true, 
            message: 'Call canceled successfully' 
        })

    } catch (error) {
        console.error('❌ [HTTP cancelCall] Error:', error)
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            message: error.message 
        })
    }
}
