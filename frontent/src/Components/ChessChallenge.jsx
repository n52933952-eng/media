import React, { useState, useContext, useEffect, useCallback, useRef } from 'react'
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
import { useLiveBroadcast } from '../context/LiveBroadcastContext'
import API_BASE_URL from '../config/api'
import {
    createOpponentPagerState,
    fetchNextOnlineOpponentBatch,
    GAME_OPPONENT_PAGE_SIZE,
    GAME_OPPONENT_SCAN_PAGE_SIZE,
} from '../utils/fetchOnlineGameOpponents.js'

const ChessChallenge = ({ compact = false }) => {
    const { user, setOrientation } = useContext(UserContext)
    const { socket, onlineUsers, mergePresenceWatchIds } = useContext(SocketContext)
    const { endNormalLiveBeforeInterrupt } = useLiveBroadcast()
    const { isOpen, onOpen, onClose } = useDisclosure()
    const [availableUsers, setAvailableUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [busyUsers, setBusyUsers] = useState([])
    const [hasConnections, setHasConnections] = useState(false)
    const opponentPagerRef = useRef(createOpponentPagerState())
    const opponentShownIdsRef = useRef(new Set())
    const navigate = useNavigate()
    const showToast = useShowToast()

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const hoverBg = useColorModeValue('gray.50', '#252525')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

    const fetchBusyGameUserIds = useCallback(async () => {
        try {
            const busyRes = await fetch(`${baseUrl}/api/user/busyGameUsers`, { credentials: 'include' })
            if (busyRes.ok) {
                const { busyUserIds } = await busyRes.json()
                const ids = busyUserIds || []
                setBusyUsers(ids)
                return ids
            }
        } catch (err) {
            console.warn('Failed to fetch busy game users:', err)
        }
        return []
    }, [baseUrl])

    const idStr = (id) => {
        const raw = id?._id ?? id
        const str = (typeof raw?.toString === 'function' ? raw.toString() : String(raw ?? '')).trim()
        return /^[0-9a-fA-F]{24}$/.test(str) ? str : null
    }

    const isUserOnlineNow = useCallback((userId) => {
        const target = idStr(userId)
        if (!target) return false
        return (Array.isArray(onlineUsers) ? onlineUsers : []).some((o) => {
            const oid = typeof o === 'object' && o !== null ? o.userId?.toString() : o?.toString()
            return oid === target
        })
    }, [onlineUsers])

    const fetchAvailableUsers = useCallback(async (mode = 'replace') => {
        if (!user?._id) return
        if (mode === 'append') {
            if (loadingMore || loading || opponentPagerRef.current.done) return
            setLoadingMore(true)
        } else {
            setLoading(true)
            opponentPagerRef.current = createOpponentPagerState()
            opponentShownIdsRef.current = new Set()
            setAvailableUsers([])
            setHasMore(false)
            setHasConnections(false)
        }
        try {
            const busyIdsNow = mode === 'replace' ? await fetchBusyGameUserIds() : busyUsers
            const watched = []
            let presencePrimed = false
            const { users, pager } = await fetchNextOnlineOpponentBatch({
                baseUrl,
                currentUserId: user._id,
                isOnline: isUserOnlineNow,
                busyUserIds: busyIdsNow,
                pager: opponentPagerRef.current,
                alreadyShownIds: opponentShownIdsRef.current,
                targetCount: GAME_OPPONENT_PAGE_SIZE,
                connectionPageSize: GAME_OPPONENT_SCAN_PAGE_SIZE,
                beforeFilterPage: async (pageUsers) => {
                    if (pageUsers.length) setHasConnections(true)
                    for (const u of pageUsers) {
                        if (!watched.includes(u._id)) watched.push(u._id)
                    }
                    if (typeof mergePresenceWatchIds === 'function') mergePresenceWatchIds(watched)
                    if (!presencePrimed) {
                        presencePrimed = true
                        await new Promise((r) => setTimeout(r, 120))
                    }
                },
            })
            opponentPagerRef.current = pager
            for (const u of users) opponentShownIdsRef.current.add(u._id)
            setAvailableUsers((prev) => (mode === 'replace' ? users : [...prev, ...users]))
            setHasMore(!pager.done)
        } catch (error) {
            console.error('Error fetching users:', error)
            if (mode === 'replace') {
                setAvailableUsers([])
                setHasMore(false)
            }
        } finally {
            if (mode === 'replace') setLoading(false)
            else setLoadingMore(false)
        }
    }, [user?._id, loadingMore, loading, busyUsers, baseUrl, fetchBusyGameUserIds, isUserOnlineNow, mergePresenceWatchIds])

    const handleModalScroll = (e) => {
        const el = e.currentTarget
        if (!el || loadingMore || loading || !hasMore) return
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
            void fetchAvailableUsers('append')
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
        socket.on('acceptChessChallenge', async (data) => {
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
                await endNormalLiveBeforeInterrupt()
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
    }, [socket, navigate, showToast, setOrientation, fetchBusyGameUserIds, endNormalLiveBeforeInterrupt])

    const handleOpenModal = () => {
        void fetchAvailableUsers('replace')
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
                    sx={{ isolation: 'isolate' }}
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
                        overflow="hidden"
                    >
                        <Text fontSize={compact ? '4xl' : '6xl'} lineHeight={1} userSelect="none" aria-hidden>
                            ♟️
                        </Text>
                        {!compact && (
                            <Text
                                fontSize="2xl"
                                fontWeight="bold"
                                color="white"
                                mt={2}
                                textAlign="center"
                                lineHeight="shorter"
                                noOfLines={2}
                            >
                                Chess
                            </Text>
                        )}
                    </Flex>
                </Box>

                {/* Button — slight overlap removes subpixel hairline between gradient and footer */}
                <Button
                    colorScheme="purple"
                    size={compact ? 'xs' : 'sm'}
                    w="full"
                    borderRadius="0"
                    borderTopWidth="0"
                    mt="-1px"
                    position="relative"
                    zIndex={1}
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
                    <ModalBody
                        pb={6}
                        maxH="min(420px, 65vh)"
                        overflowY="auto"
                        sx={{ scrollbarGutter: 'stable' }}
                        onScroll={handleModalScroll}
                    >
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
                                {loadingMore && (
                                    <Flex justify="center" py={3}><Spinner size="sm" /></Flex>
                                )}
                            </VStack>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    )
}

export default ChessChallenge

