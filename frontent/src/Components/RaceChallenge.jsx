import React, { useState, useContext, useEffect, useRef, useCallback } from 'react'
import {
    Box, Button, VStack, Text, useColorModeValue,
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
    useDisclosure, Flex, Avatar, Badge, Spinner,
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'

const RaceChallenge = ({ compact = false }) => {
    const { user } = useContext(UserContext)
    const { socket, onlineUsers } = useContext(SocketContext)
    const { isOpen, onOpen, onClose } = useDisclosure()
    const [availableUsers, setAvailableUsers]   = useState([])
    const [loading,        setLoading]           = useState(false)
    const [busyUsers,      setBusyUsers]         = useState([])
    const [hasConnections, setHasConnections]    = useState(false)
    const navigate    = useNavigate()
    const showToast   = useShowToast()
    const sentToRef   = useRef(null)

    const bgColor            = useColorModeValue('white', '#0f172a')
    const borderColor        = useColorModeValue('gray.200', '#1e3a5f')
    const hoverBg            = useColorModeValue('gray.50',  '#1a2740')
    const textColor          = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

    const fetchBusyGameUserIds = useCallback(async () => {
        try {
            const busyRes = await fetch(`${base}/api/user/busyGameUsers`, { credentials: 'include' })
            if (busyRes.ok) {
                const { busyUserIds } = await busyRes.json()
                const ids = busyUserIds || []
                setBusyUsers(ids)
                return ids
            }
        } catch { /* ignore */ }
        return []
    }, [base])

    // ── Fetch online friends who are available ────────────────────────────────
    const fetchAvailableUsers = async () => {
        if (!user) return
        setLoading(true)
        setHasConnections(false)
        try {
            const busyIdsNow = await fetchBusyGameUserIds()

            let allUsers = []
            try {
                const [fwRes, frRes] = await Promise.all([
                    fetch(`${base}/api/user/following`, { credentials: 'include' }),
                    fetch(`${base}/api/user/followers`, { credentials: 'include' }),
                ])
                const toList = async (r) => {
                    if (!r.ok) return []
                    const d = await r.json()
                    return Array.isArray(d) ? d : (Array.isArray(d.users) ? d.users : [])
                }
                const [fw, fr] = await Promise.all([toList(fwRes), toList(frRes)])
                const seen = new Set()
                const merged = [...fw, ...fr].filter(u => {
                    if (!u?._id) return false
                    const id = u._id.toString()
                    if (seen.has(id)) return false
                    seen.add(id)
                    return id !== user._id?.toString()
                })
                if (merged.length > 0) { setHasConnections(true); allUsers = merged }
            } catch { /* ignore */ }

            // Online presence check
            let presenceSet = new Set()
            if (socket && allUsers.length > 0) {
                try {
                    const snap = await new Promise((resolve) => {
                        const t = setTimeout(() => resolve(null), 2000)
                        socket.once('presenceSnapshot', (d) => { clearTimeout(t); resolve(d) })
                        socket.emit('presenceSubscribe', { userIds: allUsers.map(u => u._id?.toString()).filter(Boolean) })
                    })
                    if (snap?.onlineUsers) {
                        snap.onlineUsers.forEach(u => {
                            const id = typeof u === 'object' ? u.userId?.toString() : u?.toString()
                            if (id) presenceSet.add(id)
                        })
                    }
                } catch (_) {}
            }
            const globalSet = new Set(
                (Array.isArray(onlineUsers) ? onlineUsers : []).map(o => (
                    typeof o === 'object' ? o.userId?.toString() : o?.toString()
                )).filter(Boolean)
            )

            setAvailableUsers(allUsers.filter((u) => {
                const id = u._id?.toString()
                const online = presenceSet.size > 0 ? presenceSet.has(id) : globalSet.has(id)
                const notBusy = !busyIdsNow.some((b) => b?.toString() === id)
                return id !== user._id?.toString() && online && notBusy
            }))
        } catch (e) {
            console.error('RaceChallenge fetch error:', e)
        } finally {
            setLoading(false)
        }
    }

    // ── Socket listeners ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!socket) return

        const syncBusy = () => {
            fetchBusyGameUserIds()
        }
        const onAccepted  = (data) => {
            if (!data?.roomId) return
            const weChallenger = sentToRef.current && data.opponentId?.toString() === sentToRef.current.toString()
            if (weChallenger) {
                sentToRef.current = null
                localStorage.setItem('raceRoomId', data.roomId)
                showToast('Challenge Accepted! 🏎️', 'Starting race…', 'success')
                navigate(`/race/${data.opponentId}`)
            }
        }
        const onDeclined = () => {
            // Opponent declined — clear pending so a new challenge works correctly
            sentToRef.current = null
            localStorage.removeItem('racePendingTo')
            showToast('Challenge Declined', 'Your opponent is not available right now.', 'warning')
        }
        const onBlocked = ({ game }) => {
            if (game !== 'race') return
            sentToRef.current = null
            localStorage.removeItem('racePendingTo')
            showToast('Cannot Challenge', 'That player is currently busy in a game or call.', 'warning')
        }

        socket.on('userBusyChess', syncBusy)
        socket.on('userAvailableChess', syncBusy)
        socket.on('userBusyCard', syncBusy)
        socket.on('userAvailableCard', syncBusy)
        socket.on('userBusyRace', syncBusy)
        socket.on('userAvailableRace', syncBusy)
        socket.on('acceptRaceChallenge', onAccepted)
        socket.on('raceDeclined',        onDeclined)
        socket.on('gameChallengeBlocked', onBlocked)

        return () => {
            socket.off('userBusyChess', syncBusy)
            socket.off('userAvailableChess', syncBusy)
            socket.off('userBusyCard', syncBusy)
            socket.off('userAvailableCard', syncBusy)
            socket.off('userBusyRace', syncBusy)
            socket.off('userAvailableRace', syncBusy)
            socket.off('acceptRaceChallenge', onAccepted)
            socket.off('raceDeclined', onDeclined)
            socket.off('gameChallengeBlocked', onBlocked)
        }
    }, [socket, navigate, showToast, user, fetchBusyGameUserIds])

    const handleOpenModal = () => { fetchAvailableUsers(); onOpen() }

    const handleChallenge = (opponent) => {
        if (!socket) { showToast('Error', 'Connection lost. Please refresh.', 'error'); return }
        // Clear any stale pending from a previous challenge before sending a new one
        sentToRef.current = opponent._id?.toString()
        localStorage.setItem('racePendingTo', opponent._id?.toString())
        socket.emit('raceChallenge', {
            from:            user._id,
            to:              opponent._id,
            fromName:        user.name,
            fromUsername:    user.username,
            fromProfilePic:  user.profilePic,
        })
        showToast('Sent! 🏎️', `Race challenge sent to ${opponent.name}!`, 'success')
        onClose()
    }

    // ── UI ────────────────────────────────────────────────────────────────────
    return (
        <>
            {/* Challenge card / button */}
            <Box
                bg={bgColor}
                borderRadius="md"
                border="1px solid"
                borderColor={borderColor}
                mt={compact ? 0 : 4}
                overflow="hidden"
                _hover={{ shadow: 'lg', transform: 'translateY(-2px)' }}
                transition="all 0.25s"
                cursor="pointer"
                onClick={handleOpenModal}
                maxW={compact ? '100%' : '280px'}
                w="100%"
            >
                {/* Banner */}
                <Box
                    position="relative"
                    paddingBottom={compact ? '72%' : '100%'}
                    bg="linear-gradient(135deg, #0f172a 0%, #1e3a5f 40%, #e63946 100%)"
                    overflow="hidden"
                    sx={{ isolation: 'isolate' }}
                >
                    {/* Road stripes — fewer / subtler in compact row to avoid bright seams */}
                    {[...Array(compact ? 4 : 6)].map((_, i) => (
                        <Box
                            key={i}
                            position="absolute"
                            bottom={`${i * (compact ? 22 : 18)}%`}
                            left="50%"
                            transform="translateX(-50%) perspective(80px) rotateX(45deg)"
                            w="8px" h={compact ? '8%' : '8%'}
                            bg={compact ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)'}
                            borderRadius="2px"
                            pointerEvents="none"
                        />
                    ))}
                    <Flex
                        position="absolute"
                        inset={0}
                        align="center"
                        justify="center"
                        flexDirection="column"
                        px={1}
                        overflow="hidden"
                    >
                        <Text fontSize={compact ? '4xl' : '5xl'} lineHeight={1} userSelect="none" aria-hidden>
                            🏎️
                        </Text>
                        {!compact && (
                            <Text
                                fontSize="xl"
                                fontWeight="black"
                                color="white"
                                mt={2}
                                textAlign="center"
                                letterSpacing="wider"
                                textTransform="uppercase"
                                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}
                            >
                                Street Race
                            </Text>
                        )}
                    </Flex>
                </Box>
                <Button
                    bg="linear-gradient(90deg, #e63946, #c1121f)"
                    color="white"
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
                    _hover={{ bg: 'linear-gradient(90deg, #c1121f, #a00e18)' }}
                    fontWeight="bold"
                >
                    {compact ? '🏎️ Race' : '🏎️ Challenge to Street Race'}
                </Button>
            </Box>

            {/* Opponent picker modal */}
            <Modal isOpen={isOpen} onClose={onClose} isCentered>
                <ModalOverlay backdropFilter="blur(4px)" />
                <ModalContent bg={bgColor} borderRadius="2xl" border="1px solid" borderColor={borderColor}>
                    <ModalHeader color={textColor}>🟢 Choose Your Opponent</ModalHeader>
                    <ModalCloseButton color={textColor} />
                    <ModalBody pb={6}>
                        {loading ? (
                            <Flex justify="center" py={10}><Spinner size="lg" color="red.400" /></Flex>
                        ) : availableUsers.length === 0 ? (
                            <VStack spacing={2} py={10}>
                                <Text fontSize="3xl">🏁</Text>
                                <Text textAlign="center" color={secondaryTextColor}>
                                    {hasConnections
                                        ? 'No friends online right now. Try again soon!'
                                        : 'No friends to race yet.'}
                                </Text>
                                <Text fontSize="sm" color={secondaryTextColor}>Follow more people to race!</Text>
                            </VStack>
                        ) : (
                            <VStack spacing={3} align="stretch">
                                {availableUsers.map(opp => {
                                    const busy = busyUsers.includes(opp._id?.toString())
                                    return (
                                        <Flex
                                            key={opp._id}
                                            align="center"
                                            justify="space-between"
                                            p={3}
                                            borderRadius="xl"
                                            border="1px solid"
                                            borderColor={borderColor}
                                            _hover={{ bg: hoverBg }}
                                            transition="all 0.2s"
                                        >
                                            <Flex align="center" gap={3}>
                                                <Avatar src={opp.profilePic} name={opp.name} size="md" />
                                                <VStack align="start" spacing={0}>
                                                    <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                                        {opp.name}
                                                    </Text>
                                                    <Text fontSize="xs" color={secondaryTextColor}>@{opp.username}</Text>
                                                    {busy && (
                                                        <Badge colorScheme="red" fontSize="xs" mt={1}>🏎️ Racing</Badge>
                                                    )}
                                                </VStack>
                                            </Flex>
                                            <Button
                                                size="sm"
                                                bg="linear-gradient(90deg,#e63946,#c1121f)"
                                                color="white"
                                                _hover={{ opacity: 0.88 }}
                                                onClick={() => handleChallenge(opp)}
                                                isDisabled={busy}
                                                fontWeight="bold"
                                            >
                                                {busy ? 'Racing' : 'Race 🏎️'}
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

export default RaceChallenge
