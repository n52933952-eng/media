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
    const { user } = useContext(UserContext)
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
            console.log('♟️ CHESS CHALLENGE RECEIVED!', data)
            console.log('From:', data.fromName, '| User ID:', data.from)
            
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
        if (!socket) {
            showToast('Error', 'Connection lost. Please refresh.', 'error')
            return
        }

        // Set orientation to BLACK immediately (accepter is always black)
        // This matches madechess pattern - accepter sets orientation before joining
        localStorage.setItem('chessOrientation', 'black')
        console.log('♟️ Accepter setting orientation to BLACK before accepting')

        // Emit accept event
        socket.emit('acceptChessChallenge', {
            from: user._id,
            to: challenge.from,
            roomId: `chess_${challenge.from}_${user._id}_${Date.now()}`
        })

        // Remove challenge from list
        setChallenges(prev => prev.filter(c => c.from !== challenge.from))

        // Navigate to chess game
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

