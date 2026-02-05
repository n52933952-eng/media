import React, { useState, useContext, useEffect } from 'react'
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

const ChessChallenge = () => {
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
            const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
            
            // First, fetch all users who are currently in active chess games
            try {
                const busyRes = await fetch(`${baseUrl}/api/user/busyChessUsers`, {
                    credentials: 'include'
                })
                if (busyRes.ok) {
                    const { busyUserIds } = await busyRes.json()
                    setBusyUsers(busyUserIds || [])
                    if (import.meta.env.DEV) {
                        console.log('♟️ [ChessChallenge] Found busy users from Redis:', busyUserIds)
                    }
                }
            } catch (err) {
                console.warn('⚠️ [ChessChallenge] Failed to fetch busy users:', err)
            }
            
            // Fetch fresh profile (following/followers) from API
            let freshUserData = user
            try {
                const userRes = await fetch(`${baseUrl}/api/user/getUserPro/${user._id}`, {
                    credentials: 'include'
                })
                if (userRes.ok) {
                    freshUserData = await userRes.json()
                    if (import.meta.env.DEV) {
                        console.log('♟️ [ChessChallenge] Fetched fresh user data:', {
                            following: freshUserData.following?.length || 0,
                            followers: freshUserData.followers?.length || 0
                        })
                    }
                }
            } catch (err) {
                console.warn('⚠️ [ChessChallenge] Error fetching fresh user data:', err)
            }
            
            // Build connection IDs (handle both string IDs and objects with _id)
            const allConnectionIds = [
                ...(freshUserData.following || []),
                ...(freshUserData.followers || [])
            ].map(toIdStr).filter(Boolean)
            const uniqueIds = [...new Set(allConnectionIds)]
            
            let allUsers = []
            if (uniqueIds.length > 0) {
                setHasConnections(true)
                if (import.meta.env.DEV) {
                    console.log(`♟️ [ChessChallenge] Fetching ${uniqueIds.length} users for online check`)
                }
                const userPromises = uniqueIds.map(async (userId) => {
                    try {
                        const res = await fetch(`${baseUrl}/api/user/getUserPro/${userId}`, {
                            credentials: 'include'
                        })
                        if (res.ok) {
                            const userData = await res.json()
                            if (userData && userData._id) return userData
                        }
                    } catch (err) {
                        if (import.meta.env.DEV) console.warn(`⚠️ [ChessChallenge] Error fetching user ${userId}:`, err.message)
                    }
                    return null
                })
                allUsers = (await Promise.all(userPromises)).filter(u => u !== null && u._id)
            } else {
                // Fallback: try /api/user/following (returns full user objects)
                try {
                    const followingRes = await fetch(`${baseUrl}/api/user/following`, { credentials: 'include' })
                    if (followingRes.ok) {
                        const followingList = await followingRes.json()
                        if (Array.isArray(followingList) && followingList.length > 0) {
                            setHasConnections(true)
                            allUsers = followingList.filter(u => u && u._id && u._id.toString() !== user._id?.toString())
                            if (import.meta.env.DEV) {
                                console.log('♟️ [ChessChallenge] Used /api/user/following fallback:', allUsers.length, 'users')
                            }
                        }
                    }
                } catch (err) {
                    console.warn('⚠️ [ChessChallenge] Fallback /api/user/following failed:', err)
                }
            }
            
            // Filter to only online users who are not busy
            const onlineAvailableUsers = allUsers.filter(u => {
                // Safety check for onlineUsers
                if (!onlineUsers || !Array.isArray(onlineUsers)) {
                    if (import.meta.env.DEV) {
                        console.warn('⚠️ [ChessChallenge] onlineUsers is not an array:', onlineUsers)
                    }
                    return false
                }
                
                // Convert both to strings for comparison
                const userIdStr = u._id?.toString()
                const currentUserIdStr = user._id?.toString()
                
                if (!userIdStr || !currentUserIdStr) {
                    return false
                }
                
                // Check if user is online - onlineUsers is array of {userId, onlineAt}
                const isOnline = onlineUsers.some(online => {
                    // Handle both object format {userId: "...", onlineAt: "..."} and direct string format
                    let onlineUserId = null
                    if (typeof online === 'object' && online !== null) {
                        onlineUserId = online.userId?.toString() || online.toString()
                    } else {
                        onlineUserId = online?.toString()
                    }
                    return onlineUserId === userIdStr
                })
                
                const isNotSelf = userIdStr !== currentUserIdStr
                const isNotBusy = !busyUsers.some(busyId => {
                    const busyIdStr = busyId?.toString()
                    return busyIdStr === userIdStr
                })
                
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

    // Listen for busy users via socket
    useEffect(() => {
        if (!socket) return

        socket.on('userBusyChess', ({ userId }) => {
            setBusyUsers(prev => [...prev, userId])
        })

        socket.on('userAvailableChess', ({ userId }) => {
            setBusyUsers(prev => prev.filter(id => id !== userId))
        })

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
            socket.off('userBusyChess')
            socket.off('userAvailableChess')
            socket.off('acceptChessChallenge')
        }
    }, [socket, navigate, showToast])

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
                mt={4}
                overflow="hidden"
                _hover={{ shadow: 'md' }}
                transition="all 0.2s"
                cursor="pointer"
                onClick={handleOpenModal}
                maxW="280px"
                w="100%"
            >
                {/* Chess Image - Square */}
                <Box
                    position="relative"
                    paddingBottom="100%"
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
                    >
                        <Text fontSize="6xl">♟️</Text>
                        <Text fontSize="2xl" fontWeight="bold" color="white" mt={2}>
                            Chess
                        </Text>
                    </Flex>
                </Box>

                {/* Button */}
                <Button
                    colorScheme="purple"
                    size="sm"
                    w="full"
                    borderRadius="0"
                    _hover={{ bg: 'purple.600' }}
                >
                    ♟️ Play Chess with Friend
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

