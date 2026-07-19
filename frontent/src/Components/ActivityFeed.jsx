import React, { useState, useEffect, useContext, useMemo, useRef } from 'react'
import { Box, Flex, Text, Avatar, VStack, HStack, Spinner, useColorModeValue, IconButton } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { SocketContext } from '../context/SocketContext'
import { UserContext } from '../context/UserContext'
import { formatDistanceToNow, isValid, parseISO } from 'date-fns'
import { CloseIcon } from '@chakra-ui/icons'
import API_BASE_URL from '../config/api'

import { followIdToString } from '../utils/postUtils.js'

// How long an activity stays visible. Must match backend ACTIVITY_RETENTION_HOURS.
const ACTIVITY_RETENTION_HOURS = 12
const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_HOURS * 60 * 60 * 1000

/** Normalize API/socket createdAt (ISO string, ms, Date, or Mongo-style { $date }) for relative labels */
function parseActivityCreatedAt(value) {
    if (value == null) return null
    if (value instanceof Date) return isValid(value) ? value : null
    if (typeof value === 'number' && Number.isFinite(value)) {
        const d = new Date(value)
        return isValid(d) ? d : null
    }
    if (typeof value === 'string') {
        const fromIso = parseISO(value)
        if (isValid(fromIso)) return fromIso
        const d = new Date(value)
        return isValid(d) ? d : null
    }
    if (typeof value === 'object' && value.$date != null) {
        const d = new Date(value.$date)
        return isValid(d) ? d : null
    }
    return null
}

const ActivityFeed = () => {
    const { socket } = useContext(SocketContext) || {}
    const { user } = useContext(UserContext) || {}
    const navigate = useNavigate()
    const [activities, setActivities] = useState([])
    const [loading, setLoading] = useState(true)
    /** Bumps every minute so "X ago" stays current without a full refresh */
    const [relativeTimeTick, setRelativeTimeTick] = useState(0)

    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const rowHoverBg = useColorModeValue('blackAlpha.50', 'whiteAlpha.200')
    const nameColor = useColorModeValue('blue.500', '#1DA1F2')
    const scrollbarThumb = useColorModeValue('gray.300', 'gray.600')
    const scrollbarThumbHover = useColorModeValue('gray.400', 'gray.500')
    const deleteHoverBg = useColorModeValue('red.50', 'red.900')

    // When user follows/unfollows, following[] changes — refetch so existing 6h activities appear immediately (no full page refresh)
    const followingFingerprint = useMemo(() => {
        const list = user?.following
        if (!Array.isArray(list) || list.length === 0) return ''
        return [...list].map(followIdToString).filter(Boolean).sort().join(',')
    }, [user?.following])

    /** One GET /api/activity when `followingFingerprint` string changes — not on every render (stable string deps). */
    const fetchAbortRef = useRef(null)
    /** After first successful load for this login, follow/unfollow refetches run silently (no full-card spinner). */
    const activityFetchStartedRef = useRef(false)

    useEffect(() => {
        if (!user?._id) {
            fetchAbortRef.current?.abort()
            fetchAbortRef.current = null
            activityFetchStartedRef.current = false
            setActivities([])
            setLoading(false)
            return
        }

        const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
        fetchAbortRef.current?.abort()
        const ac = new AbortController()
        fetchAbortRef.current = ac

        const silent = activityFetchStartedRef.current
        if (!silent) setLoading(true)

        ;(async () => {
            try {
                const res = await fetch(`${base}/api/activity`, {
                    credentials: 'include',
                    signal: ac.signal,
                })
                const data = await res.json()
                if (!ac.signal.aborted && res.ok && data.activities) {
                    const retentionCutoff = new Date(Date.now() - ACTIVITY_RETENTION_MS)
                    const recentActivities = data.activities
                        .filter((activity) => new Date(activity.createdAt) >= retentionCutoff)
                        .slice(0, 15)
                    setActivities(recentActivities)
                }
            } catch (error) {
                if (error?.name === 'AbortError') return
                console.error('Error fetching activities:', error)
            } finally {
                if (!ac.signal.aborted) {
                    activityFetchStartedRef.current = true
                    setLoading(false)
                }
            }
        })()

        return () => ac.abort()
    }, [user?._id, followingFingerprint])

    useEffect(() => {
        const id = setInterval(() => setRelativeTimeTick((n) => n + 1), 60_000)
        return () => clearInterval(id)
    }, [])

    // Listen for new activities
    useEffect(() => {
        if (!socket) return

        const handleNewActivity = (activity) => {
            if (!user?.following || !activity?.userId?._id) {
                return
            }

            const activityUserId = activity.userId._id.toString()
            const isFollowing = user.following.some((f) => followIdToString(f) === activityUserId)

            if (!isFollowing) {
                // Don't add activity from users we don't follow
                if (import.meta.env.DEV) {
                    console.log('⚠️ [ActivityFeed] Ignoring activity from user we don\'t follow:', activityUserId)
                }
                return
            }
            
            setActivities(prev => {
                // Filter out activities past the retention window
                const retentionCutoff = new Date(Date.now() - ACTIVITY_RETENTION_MS)
                const recentActivities = prev.filter(a =>
                    new Date(a.createdAt) >= retentionCutoff
                )
                // Dedupe by id, add newest first, keep only 15
                const newId = activity?._id != null ? String(activity._id) : ''
                const deduped = newId
                    ? recentActivities.filter(a => String(a?._id) !== newId)
                    : recentActivities
                const updated = [activity, ...deduped].slice(0, 15)
                return updated
            })
        }

        socket.on('newActivity', handleNewActivity)

        return () => {
            socket.off('newActivity', handleNewActivity)
        }
    }, [socket, user?.following])

    void relativeTimeTick

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

    const openUserProfile = (e, username) => {
        e?.stopPropagation?.()
        e?.preventDefault?.()
        const u = typeof username === 'string' ? username.trim() : ''
        if (!u) return
        navigate(`/${u}`)
    }

    /** Blue pressable names — same behavior as mobile Activity. */
    const renderActivityText = (activity) => {
        const actorName = activity.userId?.name || activity.userId?.username || 'Someone'
        const actorUsername = activity.userId?.username
        const targetName =
            activity.targetUser?.name || activity.targetUser?.username || 'someone'
        const targetUsername = activity.targetUser?.username

        const Name = ({ label, username }) => (
            <Text
                as="span"
                color={nameColor}
                fontWeight="700"
                cursor="pointer"
                _hover={{ textDecoration: 'underline' }}
                onClick={(e) => openUserProfile(e, username)}
            >
                {label}
            </Text>
        )

        switch (activity.type) {
            case 'like':
                return (
                    <>
                        <Name label={actorName} username={actorUsername} /> liked a post
                    </>
                )
            case 'comment':
                return (
                    <>
                        <Name label={actorName} username={actorUsername} /> commented on a post
                    </>
                )
            case 'follow':
                return (
                    <>
                        <Name label={actorName} username={actorUsername} /> started following{' '}
                        <Name label={targetName} username={targetUsername} />
                    </>
                )
            case 'post':
                return (
                    <>
                        <Name label={actorName} username={actorUsername} /> created a new post
                    </>
                )
            case 'reply':
                return (
                    <>
                        <Name label={actorName} username={actorUsername} /> replied to a comment
                    </>
                )
            default:
                return (
                    <>
                        <Name label={actorName} username={actorUsername} /> performed an action
                    </>
                )
        }
    }

    const handleActivityClick = (activity) => {
        if (activity.postId) {
            const username = activity.postId?.postedBy?.username || activity.userId?.username
            if (username) {
                navigate(`/${username}/post/${activity.postId._id}`)
            }
        } else if (activity.targetUser?.username) {
            navigate(`/${activity.targetUser.username}`)
        } else if (activity.userId?.username) {
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
                            background: scrollbarThumb,
                            borderRadius: '3px',
                        },
                        '&::-webkit-scrollbar-thumb:hover': {
                            background: scrollbarThumbHover,
                        },
                    }}
                >
                    {activities.map((activity, index) => (
                        <Flex
                            key={activity._id || index}
                            align="center"
                            gap={2}
                            p={2}
                            borderRadius="14px"
                            border="1px solid"
                            borderColor={borderColor}
                            _hover={{ bg: rowHoverBg }}
                            cursor="pointer"
                            onClick={() => handleActivityClick(activity)}
                            transition="background 0.15s ease"
                            position="relative"
                        >
                            <IconButton
                                icon={<CloseIcon boxSize="10px" />}
                                size="xs"
                                variant="ghost"
                                aria-label="Delete activity"
                                onClick={(e) => handleDeleteActivity(activity._id, e)}
                                color={secondaryTextColor}
                                opacity={0.6}
                                _hover={{ 
                                    color: 'red.500', 
                                    bg: deleteHoverBg,
                                    opacity: 1 
                                }}
                                flexShrink={0}
                                minW="16px"
                                h="16px"
                                w="16px"
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
                                    noOfLines={2}
                                    dir="ltr"
                                    textAlign="left"
                                >
                                    {renderActivityText(activity)}
                                </Text>
                                <Text 
                                    fontSize="2xs" 
                                    color={secondaryTextColor}
                                >
                                    {(() => {
                                        const at = parseActivityCreatedAt(activity.createdAt)
                                        if (!at) return '—'
                                        return formatDistanceToNow(at, { addSuffix: true })
                                    })()}
                                </Text>
                            </Flex>
                        </Flex>
                    ))}
                </VStack>
            )}
        </Box>
    )
}

export default ActivityFeed


