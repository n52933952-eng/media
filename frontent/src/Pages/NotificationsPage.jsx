import React, { useState, useEffect, useContext } from 'react'
import { Box, Container, Heading, Text, VStack, HStack, Avatar, Flex, Button, Spinner, useColorModeValue, Badge, IconButton } from '@chakra-ui/react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { FaTrash } from 'react-icons/fa'
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

        const handleNotificationDeleted = (data) => {
            console.log('🗑️ Notification deleted via socket:', data)
            // Remove follow notifications from the specified user
            if (data.type === 'follow' && data.from) {
                setNotifications(prev => {
                    const filtered = prev.filter(n => 
                        !(n.type === 'follow' && n.from?._id?.toString() === data.from && !n.read)
                    )
                    // Update count if we removed any unread notifications
                    const removedCount = prev.length - filtered.length
                    if (removedCount > 0 && setNotificationCount) {
                        setNotificationCount(prevCount => Math.max(0, prevCount - removedCount))
                    }
                    return filtered
                })
            }
        }

        socket.on('newNotification', handleNewNotification)
        socket.on('notificationDeleted', handleNotificationDeleted)

        return () => {
            socket.off('newNotification', handleNewNotification)
            socket.off('notificationDeleted', handleNotificationDeleted)
        }
    }, [socket, setNotificationCount])

    // Mark notification as read when clicked
    const handleNotificationClick = async (notification, e) => {
        // Don't navigate if delete button was clicked
        if (e?.target?.closest('button')) {
            return
        }

        // Mark as read if not already read
        if (!notification.read) {
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
            } catch (error) {
                console.error('Error marking notification as read:', error)
            }
        }

        // Navigate based on notification type
        if (notification.type === 'follow') {
            navigate(`/${notification.from?.username || notification.from?.name || 'user'}`)
        } else if (notification.type === 'comment' || notification.type === 'mention' || notification.type === 'like' || notification.type === 'collaboration') {
            if (notification.post && notification.post._id) {
                // Get post owner from populated post
                const postOwner = notification.post.postedBy?.username || notification.post.postedBy?.name || user?.username
                navigate(`/${postOwner}/post/${notification.post._id}`)
            } else if (notification.metadata?.postId) {
                // For collaboration notifications, navigate to the post
                navigate(`/post/${notification.metadata.postId}`)
            }
        }
    }

    // Delete notification
    const handleDeleteNotification = async (notificationId, e) => {
        e.stopPropagation() // Prevent triggering the click handler

        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const res = await fetch(`${baseUrl}/api/notification/${notificationId}`, {
                method: 'DELETE',
                credentials: 'include'
            })

            if (res.ok) {
                // Remove from local state
                setNotifications(prev => {
                    const deleted = prev.find(n => n._id === notificationId)
                    const newNotifications = prev.filter(n => n._id !== notificationId)
                    
                    // Update count if notification was unread
                    if (deleted && !deleted.read && setNotificationCount) {
                        setNotificationCount(prev => Math.max(0, prev - 1))
                    }
                    
                    return newNotifications
                })
            }
        } catch (error) {
            console.error('Error deleting notification:', error)
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
        if (notification.type === 'collaboration') {
            const postText = notification.metadata?.postText || 'a collaborative post'
            return `added you as a contributor to "${postText}"`
        }
        const fromName = notification.from?.name || notification.from?.username || 'Someone'
        
        switch (notification.type) {
            case 'follow':
                return `${fromName} started following you`
            case 'comment':
                return `${fromName} commented on your post`
            case 'mention':
                return `${fromName} mentioned you in a comment`
            case 'like':
                // Check if it's a comment/reply like (has comment text) or post like
                if (notification.comment) {
                    // Check if it's a reply (nested comment) or top-level comment
                    // We can't directly check isReply from notification, but we can infer from context
                    // For now, use "liked your comment" for both - the notification system works the same
                    return `${fromName} liked your comment`
                } else {
                    return `${fromName} liked your post`
                }
            case 'collaboration':
                const postText = notification.metadata?.postText || 'a collaborative post'
                return `${fromName} added you as a contributor to "${postText}"`
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
            case 'like':
                return '❤️'
            case 'collaboration':
                return '🤝'
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
                                onClick={(e) => handleNotificationClick(notification, e)}
                                _hover={{ bg: useColorModeValue('gray.50', '#252b3b') }}
                                position="relative"
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
                                    <IconButton
                                        icon={<FaTrash />}
                                        size="sm"
                                        variant="ghost"
                                        colorScheme="red"
                                        aria-label="Delete notification"
                                        onClick={(e) => handleDeleteNotification(notification._id, e)}
                                        _hover={{ bg: useColorModeValue('red.50', 'red.900') }}
                                    />
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


