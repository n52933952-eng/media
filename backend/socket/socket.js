
import { Server } from 'socket.io'
import http from 'http'
import Message from '../models/message.js'
import Conversation from '../models/conversation.js'
import User from '../models/user.js'
import { createChessGamePost, deleteChessGamePost } from '../controller/post.js'
import * as redisService from '../services/redis.js'
// Use redisService namespace for all Redis functions to avoid import issues
const { getRedis, isRedisAvailable } = redisService

// This will be set from index.js
let io = null
let server = null

// In-memory fallback (will be gradually replaced by Redis)
const userSocketMap = {}
// Track active calls: { callId: { user1, user2 } }
const activeCalls = new Map()
// Track chess game rooms: { roomId: [socketId1, socketId2, ...] }
const chessRooms = new Map()
// Track active chess games: { userId: roomId } - to know which game a user is in
const activeChessGames = new Map()
// Track chess game state: { roomId: { fen, capturedWhite, capturedBlack } }
const chessGameStates = new Map()

// Helper functions for userSocketMap - Redis only (required for 1M+ users)
const setUserSocket = async (userId, socketData) => {
    redisService.ensureRedis() // Redis is required
    
    // Write to Redis (primary storage for scaling)
    await redisService.redisSet(`userSocket:${userId}`, socketData, 3600) // 1 hour TTL
    
    // Also keep in-memory for fast local access (but Redis is source of truth)
    userSocketMap[userId] = socketData
}

const getUserSocket = async (userId) => {
    redisService.ensureRedis() // Redis is required
    
    // Try Redis first (source of truth)
    try {
        const redisData = await redisService.redisGet(`userSocket:${userId}`)
        if (redisData) {
            // Update in-memory cache for fast access
            userSocketMap[userId] = redisData
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read from Redis for user ${userId}:`, error.message)
        throw error
    }
    
    // If not in Redis, check in-memory cache (shouldn't happen, but safe)
    return userSocketMap[userId] || null
}

const deleteUserSocket = async (userId) => {
    redisService.ensureRedis() // Redis is required
    
    // Delete from Redis (primary storage)
    await redisService.redisDel(`userSocket:${userId}`)
    
    // Delete from in-memory cache
    delete userSocketMap[userId]
}

const getAllUserSockets = async () => {
    redisService.ensureRedis() // Redis is required
    
    // For now, use in-memory cache (it's kept in sync)
    // TODO: Can optimize later to get all from Redis if needed
    return userSocketMap
}

// Helper functions for chessGameStates - Redis only
const setChessGameState = async (roomId, gameState) => {
    redisService.ensureRedis()
    await redisService.redisSet(`chessGameState:${roomId}`, gameState, 7200) // 2 hour TTL
    chessGameStates.set(roomId, gameState) // Keep in-memory cache
}

const getChessGameState = async (roomId) => {
    redisService.ensureRedis()
    try {
        const redisData = await redisService.redisGet(`chessGameState:${roomId}`)
        if (redisData) {
            chessGameStates.set(roomId, redisData) // Update cache
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read chess game state from Redis for ${roomId}:`, error.message)
        throw error
    }
    return chessGameStates.get(roomId) || null
}

const deleteChessGameState = async (roomId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`chessGameState:${roomId}`)
    chessGameStates.delete(roomId)
}

// Helper functions for activeChessGames - Redis only
const setActiveChessGame = async (userId, roomId) => {
    redisService.ensureRedis()
    await redisService.redisSet(`activeChessGame:${userId}`, roomId, 7200) // 2 hour TTL
    activeChessGames.set(userId, roomId) // Keep in-memory cache
}

const getActiveChessGame = async (userId) => {
    redisService.ensureRedis()
    try {
        const redisData = await redisService.redisGet(`activeChessGame:${userId}`)
        if (redisData) {
            activeChessGames.set(userId, redisData) // Update cache
            return redisData
        }
    } catch (error) {
        console.error(`❌ [socket] Failed to read active chess game from Redis for ${userId}:`, error.message)
        throw error
    }
    return activeChessGames.get(userId) || null
}

const deleteActiveChessGame = async (userId) => {
    redisService.ensureRedis()
    await redisService.redisDel(`activeChessGame:${userId}`)
    activeChessGames.delete(userId)
}

const hasActiveChessGame = async (userId) => {
    redisService.ensureRedis()
    const roomId = await getActiveChessGame(userId)
    return roomId !== null
}

export const initializeSocket = async (app) => {
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

    // Set up Redis adapter for Socket.IO (REQUIRED for multi-server scaling)
    if (process.env.REDIS_URL) {
        try {
            const { createAdapter } = await import('@socket.io/redis-adapter')
            const { getRedisPubSub } = await import('../services/redis.js')
            const pubSub = getRedisPubSub()
            
            if (pubSub && pubSub.pubClient && pubSub.subClient) {
                io.adapter(createAdapter(pubSub.pubClient, pubSub.subClient))
                console.log('✅ Socket.IO Redis adapter configured - ready for multi-server scaling!')
            } else {
                console.warn('⚠️  Redis pub/sub clients not available - Socket.IO adapter not configured')
            }
        } catch (error) {
            console.error('❌ Failed to set up Socket.IO Redis adapter:', error.message)
            // Don't exit - app can work with single server, but won't scale horizontally
        }
    }

    io.on("connection", async (socket) => {
        console.log("user connected", socket.id)
        
        const userId = socket.handshake.query.userId
        console.log("🔌 [socket] User connecting with userId:", userId)
        // Store socket info as object like madechess (dual-write: in-memory + Redis)
        if (userId && userId !== "undefined") {
            const socketData = {
                socketId: socket.id,
                onlineAt: Date.now(),
            }
            await setUserSocket(userId, socketData)
            console.log(`✅ [socket] User ${userId} added to socket map (socket: ${socket.id})`)
            
            // Get count from in-memory (faster for frequent calls)
            const allSockets = await getAllUserSockets()
            console.log(`📊 [socket] Total users in socket map: ${Object.keys(allSockets).length}`)
        } else {
            console.warn("⚠️ [socket] User connected without valid userId:", userId)
        }

        // Emit online users as array of objects like madechess
        const allSockets = await getAllUserSockets()
        const onlineArray = Object.entries(allSockets).map(([id, data]) => ({
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

        socket.on("acceptChessChallenge", async ({ from, to, roomId }) => {
            console.log(`♟️ Chess challenge accepted: ${roomId}`)
            console.log(`♟️ Challenger (to): ${to} → WHITE`)
            console.log(`♟️ Accepter (from): ${from} → BLACK`)
            
            // Determine colors (challenger is white, accepter is black)
            const challengerSocketId = userSocketMap[to]?.socketId
            const accepterSocketId = userSocketMap[from]?.socketId

            // Create chess room and join both players to Socket.IO room
            if (roomId) {
                // Track active games for both players (Redis)
                await setActiveChessGame(to, roomId)
                await setActiveChessGame(from, roomId)
                
                // Join challenger to room
                if (challengerSocketId) {
                    const challengerSocket = io.sockets.sockets.get(challengerSocketId)
                    if (challengerSocket) {
                        challengerSocket.join(roomId)
                        console.log(`♟️ Challenger ${to} joined room: ${roomId}`)
                    }
                }
                // Join accepter to room
                if (accepterSocketId) {
                    const accepterSocket = io.sockets.sockets.get(accepterSocketId)
                    if (accepterSocket) {
                        accepterSocket.join(roomId)
                        console.log(`♟️ Accepter ${from} joined room: ${roomId}`)
                    }
                }
                console.log(`♟️ Created chess room: ${roomId} with both players`)
            }

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
            
            // Initialize game state (starting position) in Redis
            if (roomId) {
                await setChessGameState(roomId, {
                    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                    capturedWhite: [],
                    capturedBlack: [],
                    lastUpdated: Date.now()
                })
                console.log(`💾 Initialized game state for room ${roomId} in Redis`)
            }
            
            // Create chess game post in feed for followers
            // Use setTimeout to ensure socket connections are fully established
            // This is important because the post creation happens immediately when game starts,
            // but followers' sockets might not be registered in userSocketMap yet
            setTimeout(() => {
                createChessGamePost(to, from, roomId).catch(err => {
                    console.error('❌ [socket] Error creating chess game post:', err)
                })
            }, 500) // Delay to ensure all socket connections are registered in userSocketMap
        })

        socket.on("declineChessChallenge", ({ from, to }) => {
            console.log(`♟️ Chess challenge declined by ${from}`)
            const challengerSocketId = userSocketMap[to]?.socketId
            if (challengerSocketId) {
                io.to(challengerSocketId).emit("chessDeclined", { from })
            }
        })

        // Join chess room for spectators
        socket.on("joinChessRoom", async ({ roomId }) => {
            if (roomId) {
                if (!chessRooms.has(roomId)) {
                    chessRooms.set(roomId, [])
                }
                const room = chessRooms.get(roomId)
                const wasAlreadyInRoom = room.includes(socket.id)
                
                if (!wasAlreadyInRoom) {
                    room.push(socket.id)
                }
                
                // Always join the Socket.IO room (even if already tracked)
                socket.join(roomId)
                
                if (!wasAlreadyInRoom) {
                    console.log(`👁️ Spectator joined chess room: ${roomId} (socket: ${socket.id})`)
                } else {
                    console.log(`👁️ Spectator rejoined chess room: ${roomId} (socket: ${socket.id})`)
                }
                
                // ALWAYS send current game state when joining/rejoining (for catch-up)
                // This ensures spectators see current position even if they navigate away and come back
                const gameState = await getChessGameState(roomId)
                if (gameState) {
                    console.log(`📤 Sending game state to spectator for catch-up:`, {
                        roomId,
                        fen: gameState.fen,
                        capturedWhite: gameState.capturedWhite?.length || 0,
                        capturedBlack: gameState.capturedBlack?.length || 0,
                        lastUpdated: new Date(gameState.lastUpdated).toISOString(),
                        isRejoin: wasAlreadyInRoom
                    })
                    // Use io.to() to ensure it reaches the spectator socket
                    io.to(socket.id).emit("chessGameState", {
                        roomId,
                        fen: gameState.fen,
                        capturedWhite: gameState.capturedWhite || [],
                        capturedBlack: gameState.capturedBlack || []
                    })
                } else {
                    console.log(`⚠️ No game state found for room ${roomId} - game may not have started yet`)
                    // Send empty state (starting position)
                    io.to(socket.id).emit("chessGameState", {
                        roomId,
                        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                        capturedWhite: [],
                        capturedBlack: []
                    })
                }
            }
        })

        socket.on("chessMove", async ({ roomId, move, to, fen, capturedWhite, capturedBlack }) => {
            console.log(`♟️ Chess move received from ${socket.handshake.query.userId} to ${to}`)
            console.log(`♟️ Move data:`, move)
            
            // Update game state in backend (for spectator catch-up) - Redis
            if (roomId && fen) {
                await setChessGameState(roomId, {
                    fen,
                    capturedWhite: capturedWhite || [],
                    capturedBlack: capturedBlack || [],
                    lastUpdated: Date.now()
                })
                console.log(`💾 Updated game state for room ${roomId}:`, {
                    fen: fen.substring(0, 50) + '...',
                    capturedWhite: capturedWhite?.length || 0,
                    capturedBlack: capturedBlack?.length || 0
                })
            } else {
                console.warn(`⚠️ Cannot update game state - missing roomId or fen:`, { roomId: !!roomId, fen: !!fen })
            }
            
            // Emit to the opponent (specific user)
            const recipientSocketId = userSocketMap[to]?.socketId
            if (recipientSocketId) {
                console.log(`♟️ Forwarding move to ${to} (socket: ${recipientSocketId})`)
                // Send move in same format as madechess: { move: moveObject }
                io.to(recipientSocketId).emit("opponentMove", { move })
            } else {
                console.log(`⚠️ Recipient ${to} not found in socket map`)
            }
            
            // ALSO emit to all spectators in the room (if roomId exists)
            // Use Socket.IO room system - if anyone joined the room, broadcast to them
            if (roomId) {
                // Check if room exists (has at least one socket joined)
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    console.log(`👁️ Broadcasting move to ${room.size} sockets in room ${roomId}`)
                    // Emit to all sockets in the room (including players and spectators)
                    io.to(roomId).emit("opponentMove", { move })
                } else {
                    console.log(`⚠️ Room ${roomId} doesn't exist or is empty`)
                }
            }
        })

        socket.on("resignChess", async ({ roomId, to }) => {
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
            
            // Notify all spectators in the room that game ended
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    console.log(`👁️ Notifying ${room.size} spectators that game ended (resign)`)
                    io.to(roomId).emit("chessGameEnded", { reason: 'resigned' })
                }
            }
            
            // Delete chess game post immediately
            if (roomId) {
                deleteChessGamePost(roomId).catch(err => {
                    console.error('❌ Error deleting chess game post on resign:', err)
                })
                // Remove from active games tracking (Redis)
                await deleteActiveChessGame(userId)
                await deleteActiveChessGame(to)
                // Clean up game state (Redis)
                await deleteChessGameState(roomId)
                console.log(`🗑️ Cleaned up game state for room ${roomId}`)
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

        socket.on("chessGameEnd", async ({ roomId, player1, player2, reason }) => {
            // The player who emitted this event is leaving or game ended normally
            const currentUserId = socket.handshake.query.userId
            const player1SocketId = userSocketMap[player1]?.socketId
            const player2SocketId = userSocketMap[player2]?.socketId
            
            // Determine which player left and who the other player is
            const leavingPlayerSocketId = currentUserId === player1 ? player1SocketId : player2SocketId
            const otherPlayerId = currentUserId === player1 ? player2 : player1
            const otherPlayerSocketId = currentUserId === player1 ? player2SocketId : player1SocketId
            
            // If game ended normally (checkmate/draw), notify both players
            if (reason === 'game_over' || reason === 'checkmate' || reason === 'draw') {
                if (player1SocketId) {
                    io.to(player1SocketId).emit("chessGameCleanup")
                }
                if (player2SocketId) {
                    io.to(player2SocketId).emit("chessGameCleanup")
                }
            } else {
                // Player left - notify the other player
                if (otherPlayerSocketId) {
                    io.to(otherPlayerSocketId).emit("opponentLeftGame")
                    io.to(otherPlayerSocketId).emit("chessGameCleanup")
                }
                
                // Cleanup for the player who left
                if (leavingPlayerSocketId) {
                    io.to(leavingPlayerSocketId).emit("chessGameCleanup")
                }
            }
            
            // Notify all spectators in the room that game ended
            if (roomId) {
                const room = io.sockets.adapter.rooms.get(roomId)
                if (room && room.size > 0) {
                    const endReason = reason || 'player_left'
                    console.log(`👁️ Notifying ${room.size} spectators that game ended (${endReason})`)
                    io.to(roomId).emit("chessGameEnded", { reason: endReason })
                }
            }
            
            // Delete chess game post immediately
            if (roomId) {
                deleteChessGamePost(roomId).catch(err => {
                    console.error('❌ Error deleting chess game post on game end:', err)
                })
                // Remove from active games tracking (Redis)
                await deleteActiveChessGame(player1)
                await deleteActiveChessGame(player2)
                // Clean up game state (Redis)
                await deleteChessGameState(roomId)
                console.log(`🗑️ Cleaned up game state for room ${roomId}`)
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

        socket.on("disconnect", async () => {
            console.log("user disconnected", socket.id)
            
            let disconnectedUserId = null
            
            // Remove user from map by matching socket.id like madechess (dual-write: in-memory + Redis)
            for (const [id, data] of Object.entries(userSocketMap)) {
                if (data.socketId === socket.id) {
                    disconnectedUserId = id
                    await deleteUserSocket(id) // Delete from both in-memory and Redis
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

            // Check if disconnected user was in an active chess game
            if (disconnectedUserId && await hasActiveChessGame(disconnectedUserId)) {
                const gameRoomId = await getActiveChessGame(disconnectedUserId)
                console.log(`♟️ User ${disconnectedUserId} disconnected while in game: ${gameRoomId}`)
                
                // Find the other player
                let otherPlayerId = null
                for (const [userId, roomId] of activeChessGames.entries()) {
                    if (roomId === gameRoomId && userId !== disconnectedUserId) {
                        otherPlayerId = userId
                        break
                    }
                }
                
                // Notify the other player
                if (otherPlayerId) {
                    const otherPlayerData = await getUserSocket(otherPlayerId)
                    const otherPlayerSocketId = otherPlayerData?.socketId
                    if (otherPlayerSocketId) {
                        io.to(otherPlayerSocketId).emit("opponentLeftGame")
                        io.to(otherPlayerSocketId).emit("chessGameCleanup")
                    }
                }
                
                // Notify all spectators in the room
                if (gameRoomId) {
                    const room = io.sockets.adapter.rooms.get(gameRoomId)
                    if (room && room.size > 0) {
                        console.log(`👁️ Notifying ${room.size} spectators that game ended (player disconnected)`)
                        io.to(gameRoomId).emit("chessGameEnded", { reason: 'player_disconnected' })
                    }
                }
                
                // Delete chess game post immediately
                deleteChessGamePost(gameRoomId).catch(err => {
                    console.error('❌ Error deleting chess game post on disconnect:', err)
                })
                
                // Remove from active games tracking (Redis)
                await deleteActiveChessGame(disconnectedUserId)
                if (otherPlayerId) {
                    await deleteActiveChessGame(otherPlayerId)
                }
                
                // Clean up game state (Redis)
                await deleteChessGameState(gameRoomId)
                console.log(`🗑️ Cleaned up game state for room ${gameRoomId}`)
            }
            
            // Remove socket from chess rooms
            for (const [roomId, room] of chessRooms.entries()) {
                const index = room.indexOf(socket.id)
                if (index !== -1) {
                    room.splice(index, 1)
                    console.log(`👁️ Removed socket ${socket.id} from chess room ${roomId}`)
                    // Clean up empty rooms
                    if (room.length === 0) {
                        chessRooms.delete(roomId)
                        console.log(`🗑️ Deleted empty chess room: ${roomId}`)
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
export { getAllUserSockets } // Export the async function
export const getServer = () => server
