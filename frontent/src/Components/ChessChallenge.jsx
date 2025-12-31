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

const ChessChallenge = () => {
    const { user, setOrientation } = useContext(UserContext)
    const { socket, onlineUsers } = useContext(SocketContext)
    const { isOpen, onOpen, onClose } = useDisclosure()
    const [availableUsers, setAvailableUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [busyUsers, setBusyUsers] = useState([])
    const navigate = useNavigate()
    const showToast = useShowToast()

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const hoverBg = useColorModeValue('gray.50', '#252525')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    // Fetch followers and following who are online
    const fetchAvailableUsers = async () => {
        if (!user) return
        
        try {
            setLoading(true)
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            
            // Get unique user IDs from both followers and following
            const allConnectionIds = [
                ...(user.following || []),
                ...(user.followers || [])
            ]
            
            // Remove duplicates
            const uniqueIds = [...new Set(allConnectionIds)]
            
            // Fetch all users in parallel
            const userPromises = uniqueIds.map(async (userId) => {
                try {
                    const res = await fetch(`${baseUrl}/api/user/getUserPro/${userId}`, {
                        credentials: 'include'
                    })
                    if (res.ok) {
                        return await res.json()
                    }
                } catch (err) {
                    console.error('Error fetching user:', err)
                }
                return null
            })
            
            const allUsers = (await Promise.all(userPromises)).filter(u => u !== null)
            
            // Filter to only online users who are not busy
            const onlineAvailableUsers = allUsers.filter(u => {
                // Safety check for onlineUsers
                if (!onlineUsers || !Array.isArray(onlineUsers)) {
                    return false
                }
                
                const isOnline = onlineUsers.some(online => online.userId === u._id)
                const isNotSelf = u._id !== user._id
                const isNotBusy = !busyUsers.includes(u._id)
                
                return isOnline && isNotSelf && isNotBusy
            })
            
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

        // Listen for challenge acceptance (sender side)
        socket.on('acceptChessChallenge', (data) => {
            if (import.meta.env.DEV) {
                console.log('♟️ Challenge accepted! Navigating to game...', data)
            }
            
            // CRITICAL: Set orientation locally BEFORE navigating (like madechess)
            // Challenger is always WHITE - must set BOTH localStorage AND state
            // Set localStorage FIRST (synchronously) before any async operations
            localStorage.setItem("chessOrientation", "white")
            localStorage.setItem("gameLive", "true")
            
            // Then update state
            setOrientation("white")
            
            if (import.meta.env.DEV) {
                console.log('♟️ Challenger setting orientation to WHITE in localStorage:', localStorage.getItem("chessOrientation"))
                console.log('♟️ Challenger setting gameLive to true in localStorage:', localStorage.getItem("gameLive"))
            }
            
            showToast('Challenge Accepted! ♟️', 'Starting game...', 'success')
            // Navigate to chess page (orientation already set in localStorage)
            // Use setTimeout to ensure localStorage is written before navigation
            setTimeout(() => {
                navigate(`/chess/${data.opponentId}`)
            }, 0)
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
                                No friends online right now 😔
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

