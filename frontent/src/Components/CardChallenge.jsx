import React, { useState, useContext, useEffect, useCallback } from 'react'
import {
    Box,
    Button,
    VStack,
    Text,
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
    Spinner,
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'

const CardChallenge = ({ compact = false }) => {
    const { user } = useContext(UserContext)
    const { socket, onlineUsers } = useContext(SocketContext)
    const { isOpen, onOpen, onClose } = useDisclosure()
    const [availableUsers, setAvailableUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [busyUsers, setBusyUsers] = useState([])
    const [hasConnections, setHasConnections] = useState(false)
    const navigate = useNavigate()
    const showToast = useShowToast()
    // Track who WE challenged so we can distinguish when acceptCardChallenge arrives
    const sentChallengeToRef = React.useRef(null)

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
        } catch { /* ignore */ }
        return []
    }, [baseUrl])

    const fetchAvailableUsers = async () => {
        if (!user) return
        try {
            setLoading(true)
            setHasConnections(false)
            const busyIdsNow = await fetchBusyGameUserIds()

            // Fetch following + followers
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
                const seen = new Set()
                const merged = [...followingList, ...followersList].filter(u => {
                    if (!u?._id) return false
                    const id = u._id.toString()
                    if (seen.has(id)) return false
                    seen.add(id)
                    return id !== user._id?.toString()
                })
                if (merged.length > 0) { setHasConnections(true); allUsers = merged }
            } catch { /* ignore */ }

            // Presence snapshot
            let presenceOnlineSet = new Set()
            if (socket && allUsers.length > 0) {
                const connectionIds = allUsers.map(u => u._id?.toString()).filter(Boolean)
                try {
                    const snapshot = await new Promise((resolve) => {
                        const timer = setTimeout(() => resolve(null), 2000)
                        socket.once('presenceSnapshot', (data) => { clearTimeout(timer); resolve(data) })
                        socket.emit('presenceSubscribe', { userIds: connectionIds })
                    })
                    if (snapshot?.onlineUsers) {
                        snapshot.onlineUsers.forEach(u => {
                            const id = typeof u === 'object' ? u.userId?.toString() : u?.toString()
                            if (id) presenceOnlineSet.add(id)
                        })
                    }
                } catch (_) {}
            }
            const globalOnlineSet = new Set(
                (Array.isArray(onlineUsers) ? onlineUsers : []).map(o => {
                    if (typeof o === 'object' && o !== null) return o.userId?.toString()
                    return o?.toString()
                }).filter(Boolean)
            )

            const onlineAvailableUsers = allUsers.filter(u => {
                const userIdStr = u._id?.toString()
                const currentUserIdStr = user._id?.toString()
                if (!userIdStr || !currentUserIdStr) return false
                const isOnline = presenceOnlineSet.size > 0
                    ? presenceOnlineSet.has(userIdStr)
                    : globalOnlineSet.has(userIdStr)
                const isNotSelf = userIdStr !== currentUserIdStr
                const isNotBusy = !busyIdsNow.some((busyId) => busyId?.toString() === userIdStr)
                return isOnline && isNotSelf && isNotBusy
            })
            setAvailableUsers(onlineAvailableUsers)
        } catch (error) {
            console.error('Error fetching users:', error)
        } finally {
            setLoading(false)
        }
    }

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

        // Challenger receives acceptCardChallenge → navigate to game
        // We only handle this here if we are the one who SENT the challenge.
        // The accepter navigates via CardChallengeNotification + SocketContext.acceptCardChallenge().
        socket.on('acceptCardChallenge', (data) => {
            if (!data?.roomId) return
            const weAreChallenger = sentChallengeToRef.current &&
                data.opponentId?.toString() === sentChallengeToRef.current.toString()
            if (weAreChallenger) {
                sentChallengeToRef.current = null
                localStorage.setItem('cardRoomId', data.roomId)
                showToast('Challenge Accepted! 🃏', 'Starting Go Fish game...', 'success')
                navigate(`/card/${data.opponentId}`)
            }
        })

        return () => {
            socket.off('userBusyChess', syncBusy)
            socket.off('userAvailableChess', syncBusy)
            socket.off('userBusyCard', syncBusy)
            socket.off('userAvailableCard', syncBusy)
            socket.off('userBusyRace', syncBusy)
            socket.off('userAvailableRace', syncBusy)
            socket.off('acceptCardChallenge')
        }
    }, [socket, navigate, showToast, user, fetchBusyGameUserIds])

    const handleOpenModal = () => {
        fetchAvailableUsers()
        onOpen()
    }

    const handleChallenge = async (opponent) => {
        if (!socket) {
            showToast('Error', 'Connection lost. Please refresh.', 'error')
            return
        }
        sentChallengeToRef.current = opponent._id?.toString()
        socket.emit('cardChallenge', {
            from: user._id,
            to: opponent._id,
            fromName: user.name,
            fromUsername: user.username,
            fromProfilePic: user.profilePic,
        })
        showToast('Success', `Go Fish challenge sent to ${opponent.name}! 🃏`, 'success')
        onClose()
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
                {/* Card Game Image */}
                <Box
                    position="relative"
                    paddingBottom={compact ? '72%' : '100%'}
                    bg="linear-gradient(135deg, #9333EA 0%, #C026D3 100%)"
                    overflow="hidden"
                    sx={{ isolation: 'isolate' }}
                >
                    <Flex
                        position="absolute"
                        top="0" left="0" right="0" bottom="0"
                        align="center"
                        justify="center"
                        flexDirection="column"
                        px={1}
                        overflow="hidden"
                    >
                        <Text fontSize={compact ? '4xl' : '6xl'} lineHeight={1} userSelect="none" aria-hidden>
                            🃏
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
                                Go Fish
                            </Text>
                        )}
                    </Flex>
                </Box>
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
                    {compact ? '🃏 Play Go Fish' : '🃏 Play Go Fish with Friend'}
                </Button>
            </Box>

            <Modal isOpen={isOpen} onClose={onClose} isCentered>
                <ModalOverlay />
                <ModalContent bg={bgColor}>
                    <ModalHeader color={textColor}>🟢 Online Friends — Choose Opponent</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6}>
                        {loading ? (
                            <Flex justify="center" py={10}><Spinner size="lg" /></Flex>
                        ) : availableUsers.length === 0 ? (
                            <Text textAlign="center" color={secondaryTextColor} py={10}>
                                {hasConnections
                                    ? 'No friends online right now 😔 Try again later!'
                                    : 'No friends to challenge yet.'}
                                <br />
                                <Text fontSize="sm" mt={2}>Follow more people to play Go Fish!</Text>
                            </Text>
                        ) : (
                            <VStack spacing={3} align="stretch">
                                {availableUsers.map(opponent => {
                                    const isBusy = busyUsers.includes(opponent._id?.toString())
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
                                                <Avatar src={opponent.profilePic} name={opponent.name} size="md" />
                                                <VStack align="start" spacing={0}>
                                                    <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                                        {opponent.name}
                                                    </Text>
                                                    <Text fontSize="xs" color={secondaryTextColor}>
                                                        @{opponent.username}
                                                    </Text>
                                                    {isBusy && (
                                                        <Badge colorScheme="red" fontSize="xs" mt={1}>🎮 In Game</Badge>
                                                    )}
                                                </VStack>
                                            </Flex>
                                            <Button
                                                size="sm"
                                                colorScheme="purple"
                                                onClick={() => handleChallenge(opponent)}
                                                isDisabled={isBusy}
                                            >
                                                {isBusy ? 'Playing' : 'Challenge 🃏'}
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

export default CardChallenge
