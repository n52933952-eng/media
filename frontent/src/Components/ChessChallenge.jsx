import React, { useState, useContext, useEffect, useCallback } from 'react'
import {
    Box,
    Button,
    VStack,
    Text,
    Image,
    useColorModeValue,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    useDisclosure,
    Flex,
    Avatar,
    Badge,
    Spinner
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'

const ChessChallenge = ({ compact = false }) => {
    const { user, setOrientation } = useContext(UserContext)
    const { socket, onlineUsers } = useContext(SocketContext)
    const { isOpen, onOpen, onClose } = useDisclosure()
    const [availableUsers, setAvailableUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [busyUsers, setBusyUsers] = useState([])
    const [hasConnections, setHasConnections] = useState(false) // true if we had following+followers to check
    const navigate = useNavigate()
    const showToast = useShowToast()

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const hoverBg = useColorModeValue('gray.50', '#252525')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

    /** Returns current busy ids (also updates state). Use the return value when filtering in the same tick — React state is async. */
    const fetchBusyGameUserIds = useCallback(async () => {
        try {
            const busyRes = await fetch(`${baseUrl}/api/user/busyGameUsers`, {
                credentials: 'include',
            })
            if (busyRes.ok) {
                const { busyUserIds } = await busyRes.json()
                const ids = busyUserIds || []
                setBusyUsers(ids)
                return ids
            }
        } catch (err) {
            console.warn('⚠️ [ChessChallenge] Failed to fetch busy game users:', err)
        }
        return []
    }, [baseUrl])

    // Normalize ID (backend may return string or { _id: "..." })
    const toIdStr = (id) => {
        const raw = id?._id ?? id
        const s = (typeof raw?.toString === 'function' ? raw.toString() : String(raw ?? '')).trim()
        return /^[0-9a-fA-F]{24}$/.test(s) ? s : null
    }

    // Fetch followers and following who are online
    const fetchAvailableUsers = async () => {
        if (!user) return
        
        try {
            setLoading(true)
            setHasConnections(false)
            // Anyone in chess, card, or race — use returned ids for filtering (state updates async)
            const busyIdsNow = await fetchBusyGameUserIds()
            if (import.meta.env.DEV) {
                console.log('♟️ [ChessChallenge] Synced busy game users from Redis')
            }
            
            // Fetch following + followers using the Follow-collection-backed endpoints
            let allUsers = []
            try {
                const [followingRes, followersRes] = await Promise.all([
                    fetch(`${baseUrl}/api/user/following`, { credentials: 'include' }),
                    fetch(`${baseUrl}/api/user/followers`, { credentials: 'include' }),
                ])

                const toList = async (res) => {
                    if (!res.ok) return []
                    const data = await res.json()
                    return Array.isArray(data) ? data : (Array.isArray(data.users) ? data.users : [])
                }

                const [followingList, followersList] = await Promise.all([toList(followingRes), toList(followersRes)])

                if (import.meta.env.DEV) {
                    console.log(`♟️ [ChessChallenge] following: ${followingList.length}, followers: ${followersList.length}`)
                }

                // Merge and deduplicate (by _id string)
                const seen = new Set()
                const merged = [...followingList, ...followersList].filter(u => {
                    if (!u?._id) return false
                    const id = u._id.toString()
                    if (seen.has(id)) return false
                    seen.add(id)
                    return id !== user._id?.toString()
                })

                if (merged.length > 0) {
                    setHasConnections(true)
                    allUsers = merged
                }

                if (import.meta.env.DEV) {
                    console.log(`♟️ [ChessChallenge] Total unique connections: ${allUsers.length}`)
                }
            } catch (err) {
                console.warn('⚠️ [ChessChallenge] Error fetching connections:', err)
            }
            
            // Use presenceSubscribe to get accurate real-time presence
            // (works even when global getOnlineUser broadcast is disabled for scale)
            let presenceOnlineSet = new Set()
            if (socket && allUsers.length > 0) {
                const connectionIds = allUsers.map(u => u._id?.toString()).filter(Boolean)
                try {
                    const snapshot = await new Promise((resolve) => {
                        const timer = setTimeout(() => resolve(null), 2000) // 2s timeout
                        socket.once('presenceSnapshot', (data) => {
                            clearTimeout(timer)
                            resolve(data)
                        })
                        socket.emit('presenceSubscribe', { userIds: connectionIds })
                    })
                    if (snapshot?.onlineUsers) {
                        snapshot.onlineUsers.forEach(u => {
                            const id = typeof u === 'object' ? u.userId?.toString() : u?.toString()
                            if (id) presenceOnlineSet.add(id)
                        })
                        if (import.meta.env.DEV) {
                            console.log(`♟️ [ChessChallenge] presenceSnapshot: ${presenceOnlineSet.size} online of ${connectionIds.length}`)
                        }
                    }
                } catch (_) {}
            }

            // Also build a Set from the legacy global onlineUsers list as a fallback
            const globalOnlineSet = new Set(
                (Array.isArray(onlineUsers) ? onlineUsers : []).map(o => {
                    if (typeof o === 'object' && o !== null) return o.userId?.toString()
                    return o?.toString()
                }).filter(Boolean)
            )

            // Filter to only online users who are not busy
            const onlineAvailableUsers = allUsers.filter(u => {
                // Convert both to strings for comparison
                const userIdStr = u._id?.toString()
                const currentUserIdStr = user._id?.toString()
                
                if (!userIdStr || !currentUserIdStr) {
                    return false
                }
                
                // Check via presenceSubscribe snapshot first, fall back to global list
                const isOnline = presenceOnlineSet.size > 0
                    ? presenceOnlineSet.has(userIdStr)
                    : globalOnlineSet.has(userIdStr)
                
                const isNotSelf = userIdStr !== currentUserIdStr
                const isNotBusy = !busyIdsNow.some((busyId) => busyId?.toString() === userIdStr)
                
                if (import.meta.env.DEV && isOnline && isNotSelf) {
                    console.log(`✅ [ChessChallenge] User ${u.username} (${userIdStr}) is online and available`)
                }
                
                return isOnline && isNotSelf && isNotBusy
            })
            
            if (import.meta.env.DEV) {
                console.log(`♟️ [ChessChallenge] Found ${onlineAvailableUsers.length} online available users out of ${allUsers.length} total connections`)
                console.log(`♟️ [ChessChallenge] Online users from socket:`, onlineUsers)
                console.log(`♟️ [ChessChallenge] All fetched users:`, allUsers.map(u => ({ id: u._id?.toString(), username: u.username })))
            }
            
            setAvailableUsers(onlineAvailableUsers)
        } catch (error) {
            console.error('Error fetching users:', error)
        } finally {
            setLoading(false)
        }
    }

    // Keep busy list in sync when any game starts/ends (chess, card, race)
    useEffect(() => {
        if (!socket) return

        const syncBusy = () => {
            fetchBusyGameUserIds()
        }
        socket.on('userBusyChess', syncBusy)
        socket.on('userAvailableChess', syncBusy)
        socket.on('userBusyCard', syncBusy)
        socket.on('userAvailableCard', syncBusy)
        socket.on('userBusyRace', syncBusy)
        socket.on('userAvailableRace', syncBusy)

        // Listen for challenge acceptance (sender side - CHALLENGER ONLY)
        // CRITICAL: Only process if we're the challenger
        // The backend sends acceptChessChallenge to BOTH users, but only challenger should set "white"
        // We know we're the challenger if the socket event's yourColor is "white"
        socket.on('acceptChessChallenge', (data) => {
            // Only process if socket says we're white (meaning we're the challenger)
            if (data.yourColor === 'white') {
                if (import.meta.env.DEV) {
                    console.log('♟️ [ChessChallenge] Received accept - we are CHALLENGER (yourColor=white), setting WHITE')
                }
                // Challenger is always WHITE - set localStorage and state
                localStorage.setItem("chessOrientation", "white")
                localStorage.setItem("gameLive", "true")
                // Store roomId in localStorage so ChessGamePage can read it
                if (data.roomId) {
                    localStorage.setItem("chessRoomId", data.roomId)
                }
                setOrientation("white")
                
                showToast('Challenge Accepted! ♟️', 'Starting game...', 'success')
                navigate(`/chess/${data.opponentId}`)
            } else {
                if (import.meta.env.DEV) {
                    console.log('⚠️ [ChessChallenge] Received acceptChessChallenge but yourColor is not "white" (we are accepter), ignoring to prevent overwriting black')
                }
            }
        })

        return () => {
            socket.off('userBusyChess', syncBusy)
            socket.off('userAvailableChess', syncBusy)
            socket.off('userBusyCard', syncBusy)
            socket.off('userAvailableCard', syncBusy)
            socket.off('userBusyRace', syncBusy)
            socket.off('userAvailableRace', syncBusy)
            socket.off('acceptChessChallenge')
        }
    }, [socket, navigate, showToast, setOrientation, fetchBusyGameUserIds])

    const handleOpenModal = () => {
        fetchAvailableUsers()
        onOpen()
    }

    const handleChallenge = async (opponent) => {
        if (!socket) {
            showToast('Error', 'Connection lost. Please refresh.', 'error')
            return
        }

        try {
            // Don't save orientation to localStorage yet - wait for game to start
            // This matches madechess pattern - orientation is set when game actually starts
            if (import.meta.env.DEV) {
                console.log('♟️ SENDING CHESS CHALLENGE:', {
                    from: user._id,
                    to: opponent._id,
                    fromName: user.name
                })
            }
            
            socket.emit('chessChallenge', {
                from: user._id,
                to: opponent._id,
                fromName: user.name,
                fromUsername: user.username,
                fromProfilePic: user.profilePic
            })

            if (import.meta.env.DEV) {
                console.log('✅ Challenge emitted successfully!')
            }
            showToast('Success', `Chess challenge sent to ${opponent.name}!`, 'success')
            onClose()
        } catch (error) {
            showToast('Error', 'Failed to send challenge', 'error')
        }
    }

    return (
        <>
            <Box
                bg={bgColor}
                borderRadius="md"
                border="1px solid"
                borderColor={borderColor}
                mt={compact ? 0 : 4}
                overflow="hidden"
                _hover={{ shadow: 'md' }}
                transition="all 0.2s"
                cursor="pointer"
                onClick={handleOpenModal}
                maxW={compact ? '100%' : '280px'}
                w="100%"
            >
                {/* Chess Image - Square (shorter aspect in compact sidebar row) */}
                <Box
                    position="relative"
                    paddingBottom={compact ? '72%' : '100%'}
                    bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                    overflow="hidden"
                >
                    <Flex
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        bottom="0"
                        align="center"
                        justify="center"
                        flexDirection="column"
                        px={1}
                    >
                        <Text fontSize={compact ? '3xl' : '6xl'}>♟️</Text>
                        <Text
                            fontSize={compact ? 'sm' : '2xl'}
                            fontWeight="bold"
                            color="white"
                            mt={compact ? 1 : 2}
                            textAlign="center"
                            lineHeight="shorter"
                            noOfLines={2}
                        >
                            Chess
                        </Text>
                    </Flex>
                </Box>

                {/* Button */}
                <Button
                    colorScheme="purple"
                    size={compact ? 'xs' : 'sm'}
                    w="full"
                    borderRadius="0"
                    py={compact ? 2 : undefined}
                    fontSize={compact ? '2xs' : undefined}
                    whiteSpace="normal"
                    lineHeight="1.2"
                    _hover={{ bg: 'purple.600' }}
                >
                    {compact ? '♟️ Play Chess' : '♟️ Play Chess with Friend'}
                </Button>
            </Box>

            {/* Modal - Online Users List */}
            <Modal isOpen={isOpen} onClose={onClose} isCentered>
                <ModalOverlay />
                <ModalContent bg={bgColor}>
                    <ModalHeader color={textColor}>
                        🟢 Online Friends - Choose Opponent
                    </ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6}>
                        {loading ? (
                            <Flex justify="center" py={10}>
                                <Spinner size="lg" />
                            </Flex>
                        ) : availableUsers.length === 0 ? (
                            <Text textAlign="center" color={secondaryTextColor} py={10}>
                                {hasConnections
                                    ? 'No friends online right now 😔 Try again later!'
                                    : 'No friends to challenge yet.'}
                                <br />
                                <Text fontSize="sm" mt={2}>
                                    Follow more people to play chess!
                                </Text>
                            </Text>
                        ) : (
                            <VStack spacing={3} align="stretch">
                                {availableUsers.map(opponent => {
                                    const isBusy = busyUsers.includes(opponent._id)
                                    return (
                                        <Flex
                                            key={opponent._id}
                                            align="center"
                                            justify="space-between"
                                            p={3}
                                            borderRadius="md"
                                            border="1px solid"
                                            borderColor={borderColor}
                                            _hover={{ bg: hoverBg }}
                                            transition="all 0.2s"
                                        >
                                            <Flex align="center" gap={3}>
                                                <Avatar
                                                    src={opponent.profilePic}
                                                    name={opponent.name}
                                                    size="md"
                                                />
                                                <VStack align="start" spacing={0}>
                                                    <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                                        {opponent.name}
                                                    </Text>
                                                    <Text fontSize="xs" color={secondaryTextColor}>
                                                        @{opponent.username}
                                                    </Text>
                                                    {isBusy && (
                                                        <Badge colorScheme="red" fontSize="xs" mt={1}>
                                                            🎮 In Game
                                                        </Badge>
                                                    )}
                                                </VStack>
                                            </Flex>
                                            <Button
                                                size="sm"
                                                colorScheme="purple"
                                                onClick={() => handleChallenge(opponent)}
                                                isDisabled={isBusy}
                                            >
                                                {isBusy ? 'Playing' : 'Challenge ♟️'}
                                            </Button>
                                        </Flex>
                                    )
                                })}
                            </VStack>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    )
}

export default ChessChallenge

