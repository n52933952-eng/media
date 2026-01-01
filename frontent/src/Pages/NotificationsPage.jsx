import React, { useState, useEffect, useContext } from 'react'
import { Box, Container, Heading, Text, VStack, HStack, Avatar, Flex, Button, Spinner, useColorModeValue, Badge } from '@chakra-ui/react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import ChessNotification from '../Components/ChessNotification'
import { SocketContext } from '../context/SocketContext'
import { UserContext } from '../context/UserContext'

const NotificationsPage = () => {
    const bgColor = useColorModeValue('gray.50', '#101010')
    const textColor = useColorModeValue('gray.800', 'white')
    const cardBg = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    
    const [notifications, setNotifications] = useState([])
    const [loading, setLoading] = useState(true)
    const { socket, notificationCount, setNotificationCount } = useContext(SocketContext) || {}
    const { user } = useContext(UserContext)
    const navigate = useNavigate()

    // Fetch notifications
    useEffect(() => {
        const fetchNotifications = async () => {
            try {
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                const res = await fetch(`${baseUrl}/api/notification`, {
                    credentials: 'include'
                })
                const data = await res.json()
                if (res.ok) {
                    setNotifications(data.notifications || [])
                    // Update notification count
                    if (setNotificationCount) {
                        setNotificationCount(data.unreadCount || 0)
                    }
                }
            } catch (error) {
                console.error('Error fetching notifications:', error)
            } finally {
                setLoading(false)
            }
        }
        fetchNotifications()
    }, [setNotificationCount])

    // Listen for new notifications via socket
    useEffect(() => {
        if (!socket) return

        const handleNewNotification = (notification) => {
            console.log('📬 New notification received on notifications page:', notification)
            setNotifications(prev => [notification, ...prev])
            if (setNotificationCount) {
                setNotificationCount(prev => prev + 1)
            }
        }

        socket.on('newNotification', handleNewNotification)

        return () => {
            socket.off('newNotification', handleNewNotification)
        }
    }, [socket, setNotificationCount])

    // Mark notification as read when clicked
    const handleNotificationClick = async (notification) => {
        if (notification.read) return

        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            await fetch(`${baseUrl}/api/notification/${notification._id}/read`, {
                method: 'PUT',
                credentials: 'include'
            })

            // Update local state
            setNotifications(prev => 
                prev.map(n => n._id === notification._id ? { ...n, read: true } : n)
            )
            
            // Update count
            if (setNotificationCount) {
                setNotificationCount(prev => Math.max(0, prev - 1))
            }

            // Navigate based on notification type
            if (notification.type === 'follow') {
                navigate(`/${notification.from.username}`)
            } else if (notification.type === 'comment' || notification.type === 'mention') {
                if (notification.post && notification.post._id) {
                    // Try to get post owner from populated post or fetch it
                    const postOwner = notification.post.postedBy?.username || user?.username
                    navigate(`/${postOwner}/post/${notification.post._id}`)
                }
            }
        } catch (error) {
            console.error('Error marking notification as read:', error)
        }
    }

    // Mark all as read
    const handleMarkAllAsRead = async () => {
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            await fetch(`${baseUrl}/api/notification/read-all`, {
                method: 'PUT',
                credentials: 'include'
            })

            setNotifications(prev => prev.map(n => ({ ...n, read: true })))
            if (setNotificationCount) {
                setNotificationCount(0)
            }
        } catch (error) {
            console.error('Error marking all as read:', error)
        }
    }

    const getNotificationMessage = (notification) => {
        const fromName = notification.from?.name || notification.from?.username || 'Someone'
        
        switch (notification.type) {
            case 'follow':
                return `${fromName} started following you`
            case 'comment':
                return `${fromName} commented on your post`
            case 'mention':
                return `${fromName} mentioned you in a comment`
            default:
                return 'New notification'
        }
    }

    const getNotificationIcon = (type) => {
        switch (type) {
            case 'follow':
                return '👤'
            case 'comment':
                return '💬'
            case 'mention':
                return '@'
            default:
                return '🔔'
        }
    }

    return (
        <Box bg={bgColor} minH="100vh" py={8}>
            <Container maxW="600px">
                <Flex justify="space-between" align="center" mb={6}>
                    <Heading size="lg" color={textColor}>
                        🔔 Notifications
                    </Heading>
                    {notifications.some(n => !n.read) && (
                        <Button size="sm" onClick={handleMarkAllAsRead}>
                            Mark all as read
                        </Button>
                    )}
                </Flex>

                <VStack spacing={4} align="stretch">
                    {/* Chess Challenges */}
                    <ChessNotification />

                    {/* All Notifications */}
                    {loading ? (
                        <Flex justify="center" py={8}>
                            <Spinner />
                        </Flex>
                    ) : notifications.length === 0 ? (
                        <Box
                            bg={cardBg}
                            borderRadius="md"
                            p={6}
                            textAlign="center"
                        >
                            <Text color={secondaryTextColor}>
                                No notifications yet 📬
                            </Text>
                        </Box>
                    ) : (
                        notifications.map((notification) => (
                            <Box
                                key={notification._id}
                                bg={cardBg}
                                borderRadius="md"
                                p={4}
                                borderLeft={notification.read ? 'none' : '4px solid'}
                                borderColor={notification.read ? 'transparent' : 'blue.500'}
                                cursor="pointer"
                                onClick={() => handleNotificationClick(notification)}
                                _hover={{ bg: useColorModeValue('gray.50', '#252b3b') }}
                            >
                                <HStack spacing={3} align="start">
                                    <Avatar
                                        src={notification.from?.profilePic}
                                        name={notification.from?.name || notification.from?.username}
                                        size="sm"
                                    />
                                    <Flex flex={1} direction="column">
                                        <HStack spacing={2} align="center">
                                            <Text fontSize="xl">{getNotificationIcon(notification.type)}</Text>
                                            <Text fontWeight="bold" color={textColor} fontSize="sm">
                                                {getNotificationMessage(notification)}
                                            </Text>
                                            {!notification.read && (
                                                <Badge colorScheme="blue" size="sm">New</Badge>
                                            )}
                                        </HStack>
                                        {notification.comment && (
                                            <Text fontSize="xs" color={secondaryTextColor} mt={1} noOfLines={2}>
                                                "{notification.comment}"
                                            </Text>
                                        )}
                                        <Text fontSize="xs" color={secondaryTextColor} mt={1}>
                                            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                                        </Text>
                                    </Flex>
                                </HStack>
                            </Box>
                        ))
                    )}
                </VStack>
            </Container>
        </Box>
    )
}

export default NotificationsPage


