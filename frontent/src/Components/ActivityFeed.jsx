import React, { useState, useEffect, useContext } from 'react'
import { Box, Flex, Text, Avatar, VStack, HStack, Spinner, useColorModeValue, Divider, IconButton } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { SocketContext } from '../context/SocketContext'
import { formatDistanceToNow } from 'date-fns'
import { CloseIcon } from '@chakra-ui/icons'

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
                    // Filter out activities older than 6 hours and limit to 15
                    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
                    const recentActivities = data.activities
                        .filter(activity => new Date(activity.createdAt) >= sixHoursAgo)
                        .slice(0, 15) // Show only 15 most recent
                    setActivities(recentActivities)
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
            // CRITICAL: Only add activity if it's from a user we follow
            // This prevents showing activities from users we don't follow
            if (!user?.following || !activity?.userId?._id) {
                return // Skip if we don't have following list or activity has no user
            }
            
            const activityUserId = activity.userId._id.toString()
            const isFollowing = user.following.some(followId => 
                followId.toString() === activityUserId
            )
            
            if (!isFollowing) {
                // Don't add activity from users we don't follow
                if (import.meta.env.DEV) {
                    console.log('⚠️ [ActivityFeed] Ignoring activity from user we don\'t follow:', activityUserId)
                }
                return
            }
            
            setActivities(prev => {
                // Filter out activities older than 6 hours
                const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
                const recentActivities = prev.filter(a => 
                    new Date(a.createdAt) >= sixHoursAgo
                )
                // Add new activity at the beginning, replace old ones if limit reached (keep only 15)
                const updated = [activity, ...recentActivities].slice(0, 15)
                return updated
            })
        }

        socket.on('newActivity', handleNewActivity)

        return () => {
            socket.off('newActivity', handleNewActivity)
        }
    }, [socket, user?.following]) // Include user.following to check if we follow the activity creator

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

    const handleDeleteActivity = async (activityId, e) => {
        e.stopPropagation() // Prevent triggering the click event
        
        try {
            const res = await fetch(
                `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/activity/${activityId}`,
                {
                    method: 'DELETE',
                    credentials: 'include'
                }
            )

            if (res.ok) {
                // Remove from state immediately
                setActivities(prev => prev.filter(activity => activity._id !== activityId))
            } else {
                console.error('Failed to delete activity')
            }
        } catch (error) {
            console.error('Error deleting activity:', error)
        }
    }

    if (loading) {
        return (
            <Box 
                position="sticky"
                top="20px"
                bg={cardBg} 
                borderRadius="md" 
                p={3} 
                mb={4} 
                border="1px solid" 
                borderColor={borderColor}
                h="400px"
                maxW="280px"
                ml="auto"
                display="flex"
                flexDirection="column"
            >
                <Text 
                    fontSize="sm" 
                    fontWeight="bold" 
                    color={textColor} 
                    mb={3}
                    flexShrink={0}
                >
                    🔔 Live Activity
                </Text>
                <Flex
                    flex={1}
                    alignItems="center"
                    justifyContent="center"
                >
                    <Spinner size="sm" />
                </Flex>
            </Box>
        )
    }

    return (
        <Box 
            position="sticky"
            top="20px"
            bg={cardBg} 
            borderRadius="md" 
            p={3} 
            mb={4} 
            border="1px solid" 
            borderColor={borderColor}
            h="400px"
            maxW="280px"
            ml="auto"
            display="flex"
            flexDirection="column"
        >
            <Text 
                fontSize="sm" 
                fontWeight="bold" 
                color={textColor} 
                mb={3}
                flexShrink={0}
            >
                🔔 Live Activity
            </Text>
            
            {activities.length === 0 ? (
                <Flex
                    flex={1}
                    alignItems="center"
                    justifyContent="center"
                >
                    <Text 
                        fontSize="sm" 
                        color={secondaryTextColor}
                        textAlign="center"
                    >
                        No activity
                    </Text>
                </Flex>
            ) : (
                <VStack 
                    spacing={2} 
                    align="stretch"
                    flex={1}
                    overflowY="auto"
                    pr={1}
                    sx={{
                        '&::-webkit-scrollbar': {
                            width: '6px',
                        },
                        '&::-webkit-scrollbar-track': {
                            background: 'transparent',
                        },
                        '&::-webkit-scrollbar-thumb': {
                            background: useColorModeValue('gray.300', 'gray.600'),
                            borderRadius: '3px',
                        },
                        '&::-webkit-scrollbar-thumb:hover': {
                            background: useColorModeValue('gray.400', 'gray.500'),
                        },
                    }}
                >
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
                                position="relative"
                            >
                                <IconButton
                                    icon={<CloseIcon />}
                                    size="xs"
                                    variant="ghost"
                                    aria-label="Delete activity"
                                    onClick={(e) => handleDeleteActivity(activity._id, e)}
                                    color={secondaryTextColor}
                                    opacity={0.6}
                                    _hover={{ 
                                        color: 'red.500', 
                                        bg: useColorModeValue('red.50', 'red.900'),
                                        opacity: 1 
                                    }}
                                    flexShrink={0}
                                    minW="20px"
                                    h="20px"
                                />
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
            )}
        </Box>
    )
}

export default ActivityFeed


