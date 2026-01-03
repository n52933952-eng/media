import React, { useState, useEffect, useContext } from 'react'
import { Box, Flex, Text, Avatar, VStack, HStack, Spinner, useColorModeValue, Divider } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { SocketContext } from '../context/SocketContext'
import { formatDistanceToNow } from 'date-fns'

const ActivityFeed = () => {
    const { socket } = useContext(SocketContext) || {}
    const navigate = useNavigate()
    const [activities, setActivities] = useState([])
    const [loading, setLoading] = useState(true)

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    // Fetch activities
    useEffect(() => {
        const fetchActivities = async () => {
            try {
                const res = await fetch(
                    `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/activity`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                if (res.ok && data.activities) {
                    setActivities(data.activities.slice(0, 5)) // Show only 5 most recent
                }
            } catch (error) {
                console.error('Error fetching activities:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchActivities()
    }, [])

    // Listen for new activities
    useEffect(() => {
        if (!socket) return

        const handleNewActivity = (activity) => {
            setActivities(prev => {
                // Add new activity at the beginning, keep only 5
                const updated = [activity, ...prev].slice(0, 5)
                return updated
            })
        }

        socket.on('newActivity', handleNewActivity)

        return () => {
            socket.off('newActivity', handleNewActivity)
        }
    }, [socket])

    const getActivityIcon = (type) => {
        switch (type) {
            case 'like':
                return '❤️'
            case 'comment':
                return '💬'
            case 'follow':
                return '👤'
            case 'post':
                return '📝'
            case 'reply':
                return '↩️'
            default:
                return '🔔'
        }
    }

    const getActivityText = (activity) => {
        const userName = activity.userId?.name || activity.userId?.username || 'Someone'
        
        switch (activity.type) {
            case 'like':
                return `${userName} liked a post`
            case 'comment':
                return `${userName} commented on a post`
            case 'follow':
                const targetName = activity.targetUser?.name || activity.targetUser?.username || 'someone'
                return `${userName} followed ${targetName}`
            case 'post':
                return `${userName} created a post`
            case 'reply':
                return `${userName} replied to a comment`
            default:
                return `${userName} did something`
        }
    }

    const handleActivityClick = (activity) => {
        if (activity.postId) {
            const username = activity.postId?.postedBy?.username || activity.userId?.username
            if (username) {
                navigate(`/${username}/post/${activity.postId._id}`)
            }
        } else if (activity.targetUser) {
            navigate(`/${activity.targetUser.username}`)
        } else if (activity.userId) {
            navigate(`/${activity.userId.username}`)
        }
    }

    if (loading) {
        return (
            <Box bg={cardBg} borderRadius="md" p={4} mb={4} border="1px solid" borderColor={borderColor}>
                <Flex justifyContent="center">
                    <Spinner size="sm" />
                </Flex>
            </Box>
        )
    }

    if (activities.length === 0) {
        return null // Don't show if no activities
    }

    return (
        <Box 
            bg={cardBg} 
            borderRadius="md" 
            p={3} 
            mb={4} 
            border="1px solid" 
            borderColor={borderColor}
            maxH="400px"
            overflowY="auto"
        >
            <Text 
                fontSize="sm" 
                fontWeight="bold" 
                color={textColor} 
                mb={3}
            >
                🔔 Live Activity
            </Text>
            
            <VStack spacing={2} align="stretch">
                {activities.map((activity, index) => (
                    <React.Fragment key={activity._id || index}>
                        <Flex
                            align="center"
                            gap={2}
                            p={2}
                            borderRadius="md"
                            _hover={{ bg: useColorModeValue('gray.50', 'gray.700') }}
                            cursor="pointer"
                            onClick={() => handleActivityClick(activity)}
                            transition="all 0.2s"
                        >
                            <Text fontSize="sm">{getActivityIcon(activity.type)}</Text>
                            <Avatar
                                src={activity.userId?.profilePic}
                                name={activity.userId?.name || activity.userId?.username}
                                size="xs"
                            />
                            <Flex direction="column" flex={1} minW={0}>
                                <Text 
                                    fontSize="xs" 
                                    color={textColor}
                                    noOfLines={1}
                                >
                                    {getActivityText(activity)}
                                </Text>
                                <Text 
                                    fontSize="2xs" 
                                    color={secondaryTextColor}
                                >
                                    {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                                </Text>
                            </Flex>
                        </Flex>
                        {index < activities.length - 1 && (
                            <Divider borderColor={borderColor} />
                        )}
                    </React.Fragment>
                ))}
            </VStack>
        </Box>
    )
}

export default ActivityFeed
