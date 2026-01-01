import React, { useState, useContext, useEffect, useRef } from 'react'
import {
    Box,
    Button,
    VStack,
    Text,
    Flex,
    Avatar,
    useColorModeValue,
    Badge,
    HStack
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'

const ChessNotification = () => {
    const { user, setOrientation } = useContext(UserContext)
    const { socket } = useContext(SocketContext)
    const [challenges, setChallenges] = useState([])
    const navigate = useNavigate()
    const showToast = useShowToast()
    const audioRef = useRef(null)

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    // Load chess challenges from localStorage on mount
    useEffect(() => {
        const savedChallenges = localStorage.getItem('chessChallenges')
        if (savedChallenges) {
            try {
                setChallenges(JSON.parse(savedChallenges))
            } catch (error) {
                console.error('Error parsing chess challenges:', error)
            }
        }
    }, [])

    // Save challenges to localStorage whenever they change
    useEffect(() => {
        if (challenges.length > 0) {
            localStorage.setItem('chessChallenges', JSON.stringify(challenges))
        } else {
            localStorage.removeItem('chessChallenges')
        }
    }, [challenges])

    // Listen for chess challenges via socket
    useEffect(() => {
        if (!socket) return

        const handleChessChallenge = (data) => {
            if (import.meta.env.DEV) {
                console.log('♟️ CHESS CHALLENGE RECEIVED!', data)
                console.log('From:', data.fromName, '| User ID:', data.from)
            }
            
            // Add challenge to list
            setChallenges(prev => {
                // Prevent duplicates
                if (prev.some(c => c.from === data.from)) {
                    return prev
                }
                return [...prev, {
                    ...data,
                    timestamp: Date.now()
                }]
            })

            // Play notification sound
            if (audioRef.current) {
                audioRef.current.play().catch(err => 
                    console.error('Failed to play challenge sound:', err)
                )
            }

            // Show toast notification
            showToast('Chess Challenge! ♟️', `${data.fromName} challenged you to a game!`, 'info')
        }

        socket.on('chessChallenge', handleChessChallenge)

        return () => {
            socket.off('chessChallenge')
        }
    }, [socket, showToast])

    const handleAccept = (challenge) => {
        console.log('🎯 [ChessNotification] handleAccept called:', {
            challengeFrom: challenge.from,
            currentUserId: user._id,
            socket: !!socket
        })

        if (!socket) {
            console.error('❌ [ChessNotification] No socket connection!')
            showToast('Error', 'Connection lost. Please refresh.', 'error')
            return
        }

        // Accepter is always BLACK - set localStorage and state
        console.log('🎯 [ChessNotification] Setting orientation to BLACK (accepter)')
        console.log('🎯 [ChessNotification] Before setting - localStorage chessOrientation:', localStorage.getItem("chessOrientation"))
        console.log('🎯 [ChessNotification] Before setting - localStorage gameLive:', localStorage.getItem("gameLive"))
        
        // Clear any old values first (safety measure)
        localStorage.removeItem("chessOrientation")
        localStorage.removeItem("gameLive")
        localStorage.removeItem("chessRoomId")
        
        // Emit accept event first (generate roomId)
        const roomId = `chess_${challenge.from}_${user._id}_${Date.now()}`
        const acceptData = {
            from: user._id,
            to: challenge.from,
            roomId: roomId
        }
        
        // Set new values FIRST (BEFORE emitting socket event)
        // This prevents ChessChallenge from overwriting it with "white"
        localStorage.setItem("chessOrientation", "black")
        localStorage.setItem("gameLive", "true")
        localStorage.setItem("chessRoomId", roomId)
        setOrientation("black")
        
        // Verify it was set correctly BEFORE emitting
        const verifyOrientation = localStorage.getItem("chessOrientation")
        const verifyGameLive = localStorage.getItem("gameLive")
        const verifyRoomId = localStorage.getItem("chessRoomId")
        if (import.meta.env.DEV) {
            console.log('🎯 [ChessNotification] After setting - localStorage chessOrientation:', verifyOrientation)
            console.log('🎯 [ChessNotification] After setting - localStorage gameLive:', verifyGameLive)
            console.log('🎯 [ChessNotification] After setting - localStorage chessRoomId:', verifyRoomId)
        }
        
        if (verifyOrientation !== "black") {
            if (import.meta.env.DEV) {
                console.error('❌ [ChessNotification] ERROR: localStorage was not set correctly! Expected "black", got:', verifyOrientation)
            }
        } else {
            if (import.meta.env.DEV) {
                console.log('✅ [ChessNotification] localStorage verified correctly set to "black"')
            }
        }

        // Now emit socket event (this will trigger ChessChallenge on challenger's side)
        // But accepter's localStorage is already set to "black", so it won't be overwritten
        if (import.meta.env.DEV) {
            console.log('🎯 [ChessNotification] Emitting acceptChessChallenge:', acceptData)
        }
        socket.emit('acceptChessChallenge', acceptData)
        
        // Double-check after a tiny delay to catch any race conditions
        setTimeout(() => {
            const checkOrientation = localStorage.getItem("chessOrientation")
            if (import.meta.env.DEV) {
                console.log('🎯 [ChessNotification] Double-check after emit - localStorage chessOrientation:', checkOrientation)
            }
            if (checkOrientation !== "black") {
                if (import.meta.env.DEV) {
                    console.error('❌ [ChessNotification] RACE CONDITION DETECTED! Orientation was overwritten to:', checkOrientation)
                }
                // Fix it immediately
                localStorage.setItem("chessOrientation", "black")
                if (import.meta.env.DEV) {
                    console.log('✅ [ChessNotification] Fixed race condition - set back to "black"')
                }
            }
        }, 50)

        // Remove challenge from list
        setChallenges(prev => prev.filter(c => c.from !== challenge.from))

        // Navigate to chess page
        console.log('🎯 [ChessNotification] Navigating to chess page:', `/chess/${challenge.from}`)
        navigate(`/chess/${challenge.from}`)
    }

    const handleDecline = (challenge) => {
        if (!socket) return

        // Emit decline event
        socket.emit('declineChessChallenge', {
            from: user._id,
            to: challenge.from
        })

        // Remove challenge from list
        setChallenges(prev => prev.filter(c => c.from !== challenge.from))

        showToast('Declined', 'Chess challenge declined', 'info')
    }

    if (challenges.length === 0) return null

    return (
        <>
            {/* Hidden audio for notification sound */}
            <audio ref={audioRef} src="/notification.mp3" preload="auto" />

            <Box
                bg={bgColor}
                borderRadius="md"
                border="1px solid"
                borderColor={borderColor}
                p={4}
                mb={4}
            >
                <Flex align="center" justify="space-between" mb={3}>
                    <Text fontSize="lg" fontWeight="bold" color={textColor}>
                        ♟️ Chess Challenges
                    </Text>
                    <Badge colorScheme="purple" fontSize="sm">
                        {challenges.length} pending
                    </Badge>
                </Flex>

                <VStack spacing={3} align="stretch">
                    {challenges.map((challenge) => (
                        <Flex
                            key={challenge.from}
                            align="center"
                            justify="space-between"
                            p={3}
                            borderRadius="md"
                            bg={useColorModeValue('purple.50', 'purple.900')}
                            border="1px solid"
                            borderColor="purple.200"
                        >
                            <Flex align="center" gap={3}>
                                <Avatar
                                    src={challenge.fromProfilePic}
                                    name={challenge.fromName}
                                    size="md"
                                />
                                <VStack align="start" spacing={0}>
                                    <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                        {challenge.fromName}
                                    </Text>
                                    <Text fontSize="xs" color={secondaryTextColor}>
                                        @{challenge.fromUsername}
                                    </Text>
                                    <Text fontSize="xs" color="purple.500" mt={1}>
                                        ♟️ Challenges you to Chess!
                                    </Text>
                                </VStack>
                            </Flex>

                            <HStack>
                                <Button
                                    size="sm"
                                    colorScheme="green"
                                    onClick={() => handleAccept(challenge)}
                                >
                                    Accept
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorScheme="red"
                                    onClick={() => handleDecline(challenge)}
                                >
                                    Decline
                                </Button>
                            </HStack>
                        </Flex>
                    ))}
                </VStack>
            </Box>
        </>
    )
}

export default ChessNotification

