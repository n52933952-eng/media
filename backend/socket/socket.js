
import { Server } from 'socket.io'
import http from 'http'
import Message from '../models/message.js'
import Conversation from '../models/conversation.js'
import User from '../models/user.js'

// This will be set from index.js
let io = null
let server = null

const userSocketMap = {}
// Track active calls: { callId: { user1, user2 } }
const activeCalls = new Map()

export const initializeSocket = (app) => {
    // Create HTTP server from Express app
    server = http.createServer(app)
    
    // Initialize Socket.IO
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || "http://localhost:5173",
            credentials: true,
            methods: ["GET", "POST"]
        }
    })

    io.on("connection", (socket) => {
        console.log("user connected", socket.id)
        
        const userId = socket.handshake.query.userId
        // Store socket info as object like madechess
        if (userId && userId !== "undefined") {
            userSocketMap[userId] = {
                socketId: socket.id,
                onlineAt: Date.now(),
            }
        }

        // Emit online users as array of objects like madechess
        const onlineArray = Object.entries(userSocketMap).map(([id, data]) => ({
            userId: id,
            onlineAt: data.onlineAt,
        }))
        io.emit("getOnlineUser", onlineArray)

        // Helper function to check if user is busy
        const isUserBusy = (userId) => {
            for (const [callId, callData] of activeCalls.entries()) {
                if (callData.user1 === userId || callData.user2 === userId) {
                    return true
                }
            }
            return false
        }

        // WebRTC: Handle call user - emit to both receiver AND sender like madechess
        socket.on("callUser", ({ userToCall, signalData, from, name, callType = 'video' }) => {
            // Check if either user is already in a call
            if (isUserBusy(userToCall) || isUserBusy(from)) {
                // Notify sender that the call cannot be made (user is busy)
                const senderData = userSocketMap[from]
                const senderSocketId = senderData?.socketId
                if (senderSocketId) {
                    io.to(senderSocketId).emit("callBusyError", { 
                        message: "User is currently in a call",
                        busyUserId: isUserBusy(userToCall) ? userToCall : from
                    })
                }
                return
            }

            const receiverData = userSocketMap[userToCall]
            const receiverSocketId = receiverData?.socketId

            const senderData = userSocketMap[from]
            const senderSocketId = senderData?.socketId

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall,
                    callType
                })
            }

            if (senderSocketId) {
                io.to(senderSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall,
                    callType
                })
            }

            // Mark both users as busy
            const callId = `${from}-${userToCall}`
            activeCalls.set(callId, { user1: from, user2: userToCall })
            
            // Update database - mark users as in call (persistent across refreshes)
            User.findByIdAndUpdate(from, { inCall: true }).catch(err => console.log('Error updating caller inCall status:', err))
            User.findByIdAndUpdate(userToCall, { inCall: true }).catch(err => console.log('Error updating receiver inCall status:', err))
            
            io.emit("callBusy", { userToCall, from })
        })

        // WebRTC: Handle answer call
        socket.on("answerCall", (data) => {
            const callerData = userSocketMap[data.to]
            const callerSocketId = callerData?.socketId
            if (callerSocketId) {
                io.to(callerSocketId).emit("callAccepted", data.signal)
                // Call is now active - both users are busy (already marked in callUser)
            }
        })

        // WebRTC: Handle ICE candidate
        socket.on("iceCandidate", ({ userToCall, candidate, from }) => {
            const receiverData = userSocketMap[userToCall]
            const receiverSocketId = receiverData?.socketId
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("iceCandidate", { candidate, from })
            }
        })

        // WebRTC: Handle cancel call - match madechess implementation
        socket.on("cancelCall", ({ conversationId, sender }) => {
            const receiverData = userSocketMap[conversationId]
            const receiverSocketId = receiverData?.socketId

            const senderData = userSocketMap[sender]
            const senderSocketId = senderData?.socketId

            // Remove from active calls - try both possible call IDs
            const callId1 = `${sender}-${conversationId}`
            const callId2 = `${conversationId}-${sender}`
            if (activeCalls.has(callId1)) {
                activeCalls.delete(callId1)
            } else if (activeCalls.has(callId2)) {
                activeCalls.delete(callId2)
            }

            // Update database - mark users as NOT in call
            User.findByIdAndUpdate(sender, { inCall: false }).catch(err => console.log('Error updating sender inCall status:', err))
            User.findByIdAndUpdate(conversationId, { inCall: false }).catch(err => console.log('Error updating receiver inCall status:', err))

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("CallCanceled")
            }
            if (senderSocketId) {
                io.to(senderSocketId).emit("CallCanceled")
            }
            io.emit("cancleCall", { userToCall: conversationId, from: sender })
        })

        // Mark messages as seen
        socket.on("markmessageasSeen", async ({ conversationId, userId }) => {
            try {
                // Get the current user's ID from socket
                const currentUserId = socket.handshake.query.userId
                
                // Update only messages sent by userId (the other user) to seen: true
                // This marks messages from userId as "seen by currentUserId"
                await Message.updateMany(
                    { 
                        conversationId: conversationId, 
                        sender: userId,  // Only messages sent by userId
                        seen: false 
                    },
                    { $set: { seen: true } }
                )
                // Update conversation's lastMessage.seen to true
                await Conversation.updateOne(
                    { _id: conversationId },
                    { $set: { "lastMessage.seen": true } }
                )
                
                // Emit to the sender (the userId is the sender of the messages)
                const senderData = userSocketMap[userId]
                const senderSocketId = senderData?.socketId
                if (senderSocketId) {
                    io.to(senderSocketId).emit("messagesSeen", { conversationId })
                }
                
                // Also emit to the current user who marked messages as seen (to update their count)
                if (currentUserId && currentUserId !== userId) {
                    const currentUserData = userSocketMap[currentUserId]
                    const currentUserSocketId = currentUserData?.socketId
                    if (currentUserSocketId) {
                        io.to(currentUserSocketId).emit("messagesSeen", { conversationId })
                        
                        // Update unread count for the user who marked messages as seen
                        try {
                            const userConversations = await Conversation.find({ participants: currentUserId })
                            const totalUnread = await Promise.all(
                                userConversations.map(async (conv) => {
                                    const unreadCount = await Message.countDocuments({
                                        conversationId: conv._id,
                                        seen: false,
                                        sender: { $ne: currentUserId }
                                    })
                                    return unreadCount || 0
                                })
                            )
                            const totalUnreadCount = totalUnread.reduce((sum, count) => sum + count, 0)
                            io.to(currentUserSocketId).emit("unreadCountUpdate", { totalUnread: totalUnreadCount })
                        } catch (error) {
                            console.log('Error calculating unread count:', error)
                        }
                    }
                }
            } catch (error) {
                console.log("Error marking messages as seen:", error)
            }
        })

        // Typing indicator - user started typing
        socket.on("typingStart", ({ from, to, conversationId }) => {
            const recipientData = userSocketMap[to]
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userTyping", { userId: from, conversationId, isTyping: true })
            }
        })

        // Typing indicator - user stopped typing
        socket.on("typingStop", ({ from, to, conversationId }) => {
            const recipientData = userSocketMap[to]
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userTyping", { userId: from, conversationId, isTyping: false })
            }
        })

        // Chess Challenge Events
        socket.on("chessChallenge", ({ from, to, fromName, fromUsername, fromProfilePic }) => {
            console.log(`♟️ Chess challenge from ${from} to ${to}`)
            const recipientSocketId = userSocketMap[to]?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("chessChallenge", {
                    from,
                    fromName,
                    fromUsername,
                    fromProfilePic
                })
            }
        })

        socket.on("acceptChessChallenge", ({ from, to, roomId }) => {
            console.log(`♟️ Chess challenge accepted: ${roomId}`)
            console.log(`♟️ Challenger (to): ${to} → WHITE`)
            console.log(`♟️ Accepter (from): ${from} → BLACK`)
            
            // Determine colors (challenger is white, accepter is black)
            const challengerSocketId = userSocketMap[to]?.socketId
            const accepterSocketId = userSocketMap[from]?.socketId

            if (challengerSocketId) {
                console.log(`♟️ Sending WHITE to challenger: ${to} (socket: ${challengerSocketId})`)
                const challengerData = {
                    roomId,
                    yourColor: 'white',
                    opponentId: from
                }
                console.log(`♟️ Challenger data:`, challengerData)
                io.to(challengerSocketId).emit("acceptChessChallenge", challengerData)
            } else {
                console.log(`⚠️ Challenger ${to} not found in socket map`)
            }

            if (accepterSocketId) {
                console.log(`♟️ Sending BLACK to accepter: ${from} (socket: ${accepterSocketId})`)
                const accepterData = {
                    roomId,
                    yourColor: 'black',
                    opponentId: to
                }
                console.log(`♟️ Accepter data:`, accepterData)
                io.to(accepterSocketId).emit("acceptChessChallenge", accepterData)
            } else {
                console.log(`⚠️ Accepter ${from} not found in socket map`)
            }

            // Broadcast busy status - TARGETED to specific users only (not all users)
            // This is critical for scalability - don't broadcast to 1M users!
            if (challengerSocketId) {
                io.to(challengerSocketId).emit("userBusyChess", { userId: from })
                io.to(challengerSocketId).emit("userBusyChess", { userId: to })
            }
            if (accepterSocketId) {
                io.to(accepterSocketId).emit("userBusyChess", { userId: from })
                io.to(accepterSocketId).emit("userBusyChess", { userId: to })
            }
        })

        socket.on("declineChessChallenge", ({ from, to }) => {
            console.log(`♟️ Chess challenge declined by ${from}`)
            const challengerSocketId = userSocketMap[to]?.socketId
            if (challengerSocketId) {
                io.to(challengerSocketId).emit("chessDeclined", { from })
            }
        })

        socket.on("chessMove", ({ roomId, move, to }) => {
            console.log(`♟️ Chess move received from ${socket.handshake.query.userId} to ${to}`)
            console.log(`♟️ Move data:`, move)
            const recipientSocketId = userSocketMap[to]?.socketId
            if (recipientSocketId) {
                console.log(`♟️ Forwarding move to ${to} (socket: ${recipientSocketId})`)
                // Send move in same format as madechess: { move: moveObject }
                io.to(recipientSocketId).emit("opponentMove", { move })
            } else {
                console.log(`⚠️ Recipient ${to} not found in socket map`)
            }
        })

        socket.on("resignChess", ({ roomId, to }) => {
            const recipientSocketId = userSocketMap[to]?.socketId
            const resignerSocketId = userSocketMap[socket.handshake.query.userId]?.socketId
            const userId = socket.handshake.query.userId
            
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("opponentResigned")
            }
            
            // Emit cleanup event to both players to clear localStorage
            if (resignerSocketId) {
                io.to(resignerSocketId).emit("chessGameCleanup")
            }
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("chessGameCleanup")
            }
            
            // Make users available again - TARGETED to specific users only (not all users)
            // This is critical for scalability - don't broadcast to 1M users!
            if (resignerSocketId) {
                io.to(resignerSocketId).emit("userAvailableChess", { userId })
                io.to(resignerSocketId).emit("userAvailableChess", { userId: to })
            }
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userAvailableChess", { userId })
                io.to(recipientSocketId).emit("userAvailableChess", { userId: to })
            }
        })

        socket.on("chessGameEnd", ({ roomId, player1, player2 }) => {
            // The player who emitted this event is leaving
            const currentUserId = socket.handshake.query.userId
            const player1SocketId = userSocketMap[player1]?.socketId
            const player2SocketId = userSocketMap[player2]?.socketId
            
            // Determine which player left and who the other player is
            const leavingPlayerSocketId = currentUserId === player1 ? player1SocketId : player2SocketId
            const otherPlayerId = currentUserId === player1 ? player2 : player1
            const otherPlayerSocketId = currentUserId === player1 ? player2SocketId : player1SocketId
            
            // Notify the other player that their opponent left (same as resign)
            if (otherPlayerSocketId) {
                io.to(otherPlayerSocketId).emit("opponentLeftGame")
                io.to(otherPlayerSocketId).emit("chessGameCleanup")
            }
            
            // Cleanup for the player who left
            if (leavingPlayerSocketId) {
                io.to(leavingPlayerSocketId).emit("chessGameCleanup")
            }
            
            // Make users available again - TARGETED to specific users only (not all users)
            // This is critical for scalability - don't broadcast to 1M users!
            if (player1SocketId) {
                io.to(player1SocketId).emit("userAvailableChess", { userId: player1 })
                io.to(player1SocketId).emit("userAvailableChess", { userId: player2 })
            }
            if (player2SocketId) {
                io.to(player2SocketId).emit("userAvailableChess", { userId: player1 })
                io.to(player2SocketId).emit("userAvailableChess", { userId: player2 })
            }
        })

        socket.on("disconnect", () => {
            console.log("user disconnected", socket.id)
            
            let disconnectedUserId = null
            
            // Remove user from map by matching socket.id like madechess
            for (const [id, data] of Object.entries(userSocketMap)) {
                if (data.socketId === socket.id) {
                    disconnectedUserId = id
                    delete userSocketMap[id]
                    break
                }
            }

            // Clean up active calls for disconnected user
            if (disconnectedUserId) {
                // Clear inCall status in database for disconnected user
                User.findByIdAndUpdate(disconnectedUserId, { inCall: false }).catch(err => console.log('Error clearing inCall status on disconnect:', err))
                
                for (const [callId, callData] of activeCalls.entries()) {
                    if (callData.user1 === disconnectedUserId || callData.user2 === disconnectedUserId) {
                        activeCalls.delete(callId)
                        // Notify the other user
                        const otherUserId = callData.user1 === disconnectedUserId ? callData.user2 : callData.user1
                        const otherUserData = userSocketMap[otherUserId]
                        
                        // Clear inCall status for the other user too
                        User.findByIdAndUpdate(otherUserId, { inCall: false }).catch(err => console.log('Error clearing other user inCall status:', err))
                        
                        if (otherUserData) {
                            io.to(otherUserData.socketId).emit("CallCanceled")
                            io.emit("cancleCall", { userToCall: otherUserId, from: disconnectedUserId })
                        }
                    }
                }
            }

            // Emit updated online list as array of objects
            const updatedOnlineArray = Object.entries(userSocketMap).map(([id, data]) => ({
                userId: id,
                onlineAt: data.onlineAt,
            }))
            io.emit("getOnlineUser", updatedOnlineArray)
        })
    })

    return { io, server }
}

export const getRecipientSockedId = (recipientId) => {
    const userData = userSocketMap[recipientId]
    return userData ? userData.socketId : null
}

// Export getters for io and server
export const getIO = () => io
export const getUserSocketMap = () => userSocketMap
export const getServer = () => server
