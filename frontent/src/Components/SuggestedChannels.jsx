import React, { useState, useEffect, useContext, useRef } from 'react'
import { Box, Flex, Text, Avatar, Button, VStack, Spinner, useColorModeValue, Grid, GridItem, SimpleGrid } from '@chakra-ui/react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { PostContext } from '../context/PostContext'
import useShowToast from '../hooks/useShowToast'
import FootballIcon from './FootballIcon'

const SuggestedChannels = ({ onUserFollowed }) => {
    const { user, setUser } = useContext(UserContext)
    const { setFollowPost } = useContext(PostContext)
    const navigate = useNavigate()
    const [footballAccount, setFootballAccount] = useState(null)
    const [footballPostId, setFootballPostId] = useState(null) // Store latest Football post ID
    const [channels, setChannels] = useState([])
    const [loading, setLoading] = useState(true)
    const [followLoading, setFollowLoading] = useState(false)
    const [isFollowing, setIsFollowing] = useState(false)
    const [streamLoading, setStreamLoading] = useState({})
    const [expandedChannel, setExpandedChannel] = useState(null) // Track which channel is expanded
    const expandedChannelRef = useRef(null) // Ref for scrolling to expanded channel details
    
    const showToast = useShowToast()
    
    const bgColor = useColorModeValue('white', '#1a1a1a')
    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const hoverBg = useColorModeValue('gray.50', 'gray.700')
    
    // Fetch Football channel account and all live channels (only on mount, not on user changes)
    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true)
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                
                // Fetch Football account
                const footballRes = await fetch(
                    `${baseUrl}/api/user/getUserPro/Football`,
                    { credentials: 'include' }
                )
                const footballData = await footballRes.json()
                
                if (footballRes.ok && footballData) {
                    setFootballAccount(footballData)
                    
                    // Fetch latest Football post
                    try {
                        const postsRes = await fetch(
                            `${baseUrl}/api/post/user/id/${footballData._id}?limit=1`,
                            { credentials: 'include' }
                        )
                        const postsData = await postsRes.json()
                        if (postsRes.ok && postsData.posts && postsData.posts.length > 0) {
                            // Get the latest post (first one, sorted by date)
                            const latestPost = postsData.posts[0]
                            setFootballPostId(latestPost._id)
                        }
                    } catch (error) {
                        console.error('Error fetching Football post:', error)
                    }
                }
                
                // Fetch all live channels
                const channelsRes = await fetch(`${baseUrl}/api/news/channels`, {
                    credentials: 'include'
                })
                const channelsData = await channelsRes.json()
                
                if (channelsRes.ok && channelsData.channels) {
                    setChannels(channelsData.channels)
                }
            } catch (error) {
                console.error('Error fetching data:', error)
            } finally {
                setLoading(false)
            }
        }
        
        fetchData()
    }, []) // Only run on mount, not when user changes
    
    // Update isFollowing state when user.following changes (without refetching everything)
    useEffect(() => {
        if (footballAccount && user?.following) {
            setIsFollowing(user.following.includes(footballAccount._id))
        }
    }, [user?.following, footballAccount?._id]) // Only update follow status, don't refetch channels
    
    // Handle channel click - navigate to channel post page
    const handleChannelClick = async (channel) => {
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            
            // Find the latest post for this channel
            // Channel posts are created by the channel's system account (username matches channel username)
            const channelUsername = channel.username
            
            if (channelUsername) {
                // Fetch user profile to get user ID
                const userRes = await fetch(
                    `${baseUrl}/api/user/getUserPro/${channelUsername}`,
                    { credentials: 'include' }
                )
                const userData = await userRes.json()
                
                if (userRes.ok && userData?._id) {
                    // Fetch latest post from this channel
                    const postsRes = await fetch(
                        `${baseUrl}/api/post/user/id/${userData._id}?limit=1`,
                        { credentials: 'include' }
                    )
                    const postsData = await postsRes.json()
                    
                    if (postsRes.ok && postsData.posts && postsData.posts.length > 0) {
                        const latestPost = postsData.posts[0]
                        navigate(`/${channelUsername}/post/${latestPost._id}`)
                    } else {
                        // No post found, show message
                        showToast('Info', 'No posts from this channel yet', 'info')
                    }
                } else {
                    showToast('Error', 'Channel not found', 'error')
                }
            }
        } catch (error) {
            console.error('Error navigating to channel post:', error)
            showToast('Error', 'Could not load channel post', 'error')
        }
    }
    
    // Handle live stream button click
    const handleStreamClick = async (channelId, streamIndex = 0) => {
        const loadingKey = `${channelId}-${streamIndex}`
        try {
            setStreamLoading(prev => ({ ...prev, [loadingKey]: true }))
            
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const res = await fetch(
                `${baseUrl}/api/news/post/livestream?channelId=${channelId}&streamIndex=${streamIndex}`,
                {
                    method: 'POST',
                    credentials: 'include'
                }
            )
            const data = await res.json()
            
            if (res.ok) {
                const channel = channels.find(c => c.id === channelId)
                const stream = channel?.streams[streamIndex]
                showToast('Success', `🔴 ${channel?.name} added to your feed!`, 'success')
                
                // Scroll to top of page to see the new post in feed
                window.scrollTo({ top: 0, behavior: 'smooth' })
            } else {
                showToast('Info', data.message || 'Already in feed', 'info')
            }
        } catch (error) {
            console.error('Error creating stream post:', error)
            showToast('Error', 'Failed to add live stream', 'error')
        } finally {
            setStreamLoading(prev => ({ ...prev, [loadingKey]: false }))
        }
    }
    
    // Auto-scroll to expanded channel details when a channel is clicked
    useEffect(() => {
        if (expandedChannel && expandedChannelRef.current) {
            // Small delay to ensure the expanded section is rendered
            setTimeout(() => {
                expandedChannelRef.current?.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest' 
                })
            }, 100)
        }
    }, [expandedChannel])
    
    // Handle follow/unfollow
    const handleFollowToggle = async () => {
        if (!footballAccount) return
        
        try {
            setFollowLoading(true)
            
            const res = await fetch(
                `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/follow/${footballAccount._id}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                }
            )
            
            const data = await res.json()
            
            if (res.ok) {
                const wasFollowing = isFollowing
                
                // Update local state
                setIsFollowing(!isFollowing)
                
                // Update user context with new following list
                if (data.current) {
                    setUser(data.current)
                    localStorage.setItem('userInfo', JSON.stringify(data.current))
                }
                
                // If UNFOLLOWING, remove Football posts from feed immediately
                if (wasFollowing) {
                    setFollowPost(prev => {
                        // Remove all posts from Football account
                        const filtered = prev.filter(p => {
                            const postedById = p.postedBy?._id?.toString() || p.postedBy?.toString()
                            const footballId = footballAccount._id?.toString()
                            return postedById !== footballId
                        })
                        console.log(`🗑️ [SuggestedChannels] Removed ${prev.length - filtered.length} Football post(s) from feed`)
                        return filtered
                    })
                }
                
                // If following (not unfollowing), auto-post and fetch matches
                if (!wasFollowing) {
                    const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                    
                    // Step 1: Post immediately with whatever matches are available
                    setTimeout(() => {
                    fetch(`${baseUrl}/api/football/post/manual`, {
                        method: 'POST',
                        credentials: 'include'
                        })
                        .then(res => res.json())
                        .then(postData => {
                            console.log('📬 Post result:', postData)
                                if (postData.posted && postData.post) {
                                // Save scroll position to prevent page jumping
                                const scrollY = window.scrollY
                                
                                // Add post to feed immediately (fallback if socket doesn't work)
                                setFollowPost(prev => {
                                    // Check if post already exists
                                    const exists = prev.some(p => {
                                        const prevId = p._id?.toString()
                                        const newId = postData.post._id?.toString()
                                        return prevId === newId
                                    })
                                    if (exists) {
                                        console.log('⚠️ [SuggestedChannels] Post already in feed, skipping')
                                        return prev
                                    }
                                    // Add to top of feed
                                    console.log('✅ [SuggestedChannels] Added Football post to feed immediately')
                                    return [postData.post, ...prev]
                                })
                                
                                // Restore scroll position after state update
                                requestAnimationFrame(() => {
                                    window.scrollTo({ top: scrollY, behavior: 'instant' })
                                })
                                
                                // Also call onUserFollowed callback if provided
                                if (onUserFollowed) {
                                    onUserFollowed(footballAccount._id)
                                }
                                
                                if (postData.noMatches) {
                                    // No matches available, start fetching in background
                                    console.log('⚽ No matches found, fetching from API...')
                                    showToast('Info', 'Fetching latest matches...', 'info')
                                    
                                    fetch(`${baseUrl}/api/football/fetch/manual`, {
                                        method: 'POST',
                                        credentials: 'include'
                                    })
                                    .then(() => {
                                        showToast('Success', 'Matches loaded! Check Football page', 'success')
                                    })
                                    .catch(err => console.log('Background fetch error:', err))
                                }
                            } else if (postData.alreadyExists || postData.postId) {
                                // Post already exists, fetch it and add to feed
                                console.log('ℹ️ Post already exists for today, fetching and adding to feed...')
                                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                                
                                // Fetch the existing post
                                fetch(`${baseUrl}/api/post/getPost/${postData.postId}`, {
                                    credentials: 'include'
                                })
                                .then(res => res.json())
                                .then(postRes => {
                                    if (postRes && postRes.post) {
                                        // Save scroll position to prevent page jumping
                                        const scrollY = window.scrollY
                                        
                                        setFollowPost(prev => {
                                            const exists = prev.some(p => {
                                                const prevId = p._id?.toString()
                                                const newId = postRes.post._id?.toString()
                                                return prevId === newId
                                            })
                                            if (exists) return prev
                                            console.log('✅ [SuggestedChannels] Added existing Football post to feed')
                                            return [postRes.post, ...prev]
                                        })
                                        
                                        // Restore scroll position after state update
                                        requestAnimationFrame(() => {
                                            window.scrollTo({ top: scrollY, behavior: 'instant' })
                                        })
                                    }
                                })
                                .catch(err => console.error('Error fetching existing post:', err))
                            }
                        })
                        .catch(err => {
                            console.error('Post error:', err)
                            showToast('Error', 'Could not create post', 'error')
                        })
                    }, 500) // 500ms delay to ensure follow is saved
                }
                
                showToast(
                    'Success',
                    isFollowing 
                        ? 'Unfollowed Football channel' 
                        : '⚽ Following Football! You\'ll now see live match updates in your feed',
                    'success'
                )
            } else {
                showToast('Error', data.error || 'Failed to update follow status', 'error')
            }
        } catch (error) {
            console.error('Error toggling follow:', error)
            showToast('Error', 'Failed to update follow status', 'error')
        } finally {
            setFollowLoading(false)
        }
    }
    
    return (
        <Box
            position="sticky"
            top="80px"
            bg={bgColor}
            borderRadius="md"
            p={4}
            border="1px solid"
            borderColor={borderColor}
            maxW="280px"
        >
            {/* Header */}
            <Text fontSize="sm" fontWeight="bold" mb={3} color={textColor}>
                Suggested Channels
            </Text>
            
            {/* Loading */}
            {loading ? (
                <Box minH="400px" display="flex" alignItems="center" justifyContent="center">
                    <Spinner size="sm" />
                </Box>
            ) : footballAccount ? (
                <>
                    <VStack spacing={3} align="stretch">
                        {/* Football Channel */}
                        <Flex
                            align="center"
                            justify="space-between"
                            p={3}
                            borderRadius="md"
                            border="1px solid"
                            borderColor={borderColor}
                            _hover={{ bg: hoverBg, cursor: 'pointer' }}
                            transition="all 0.2s"
                            onClick={() => {
                                // Always navigate to Football page
                                navigate('/football')
                            }}
                        >
                            <Flex align="center" gap={3} flex={1}>
                                <FootballIcon size="48px" />
                                <VStack align="start" spacing={0} flex={1}>
                                    <Flex align="center" gap={1}>
                                        <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                            {footballAccount.name}
                                        </Text>
                                        <Text fontSize="lg" color="white" filter="drop-shadow(0 0 1px rgba(0,0,0,0.5))">⚽</Text>
                                    </Flex>
                                    <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                                        Live football scores & updates
                                    </Text>
                                    <Text fontSize="xs" color={secondaryTextColor} mt={1}>
                                        {footballAccount.followers?.length || 0} followers
                                    </Text>
                                </VStack>
                            </Flex>
                        </Flex>
                        
                        {/* Follow Button */}
                        <Button
                            onClick={handleFollowToggle}
                            isLoading={followLoading}
                            colorScheme={isFollowing ? 'gray' : 'blue'}
                            size="sm"
                            w="full"
                        >
                            {isFollowing ? 'Following' : 'Follow'}
                        </Button>
                        
                        {/* Info text */}
                        {!isFollowing && (
                            <Text fontSize="xs" color={secondaryTextColor} textAlign="center">
                                Follow to see live match updates in your feed
                            </Text>
                        )}
                    </VStack>
                    
                    {/* Live Stream Channels */}
                    {channels.length > 0 && (
                        <VStack spacing={4} align="stretch" mt={4}>
                            <Flex align="center" gap={2} mb={2}>
                                <Text fontSize="sm" fontWeight="bold" color={textColor}>
                                    🔴 Live Channels
                                </Text>
                            </Flex>
                            
                            {/* Compact Icon Grid */}
                            <SimpleGrid columns={3} spacing={2} mb={3}>
                                {channels.map((channel) => (
                                    <Box
                                        key={channel.id}
                                        bg={expandedChannel === channel.id ? hoverBg : cardBg}
                                        borderRadius="md"
                                        p={2}
                                        border="1px solid"
                                        borderColor={expandedChannel === channel.id ? 'blue.400' : borderColor}
                                        _hover={{ bg: hoverBg, borderColor: 'blue.300' }}
                                        transition="all 0.2s"
                                        position="relative"
                                        cursor="pointer"
                                        onClick={() => setExpandedChannel(expandedChannel === channel.id ? null : channel.id)}
                                    >
                                        <VStack spacing={1}>
                                            <Avatar 
                                                name={channel.name}
                                                size="sm"
                                                bg="blue.500"
                                                color="white"
                                                fontWeight="bold"
                                                cursor="pointer"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setExpandedChannel(expandedChannel === channel.id ? null : channel.id)
                                                }}
                                                _hover={{ transform: 'scale(1.1)' }}
                                                transition="transform 0.2s"
                                            />
                                            <Text 
                                                fontSize="2xs" 
                                                color={textColor} 
                                                textAlign="center" 
                                                noOfLines={1}
                                                cursor="pointer"
                                                onClick={() => setExpandedChannel(expandedChannel === channel.id ? null : channel.id)}
                                            >
                                                {channel.name.length > 10 ? channel.name.substring(0, 8) + '...' : channel.name}
                                            </Text>
                                        </VStack>
                                    </Box>
                                ))}
                            </SimpleGrid>
                            
                            {/* Expanded Channel Details */}
                            {expandedChannel && (
                                <Box
                                    ref={expandedChannelRef}
                                    bg={cardBg}
                                    borderRadius="md"
                                    p={3}
                                    border="1px solid"
                                    borderColor={borderColor}
                                    animation="slideDown 0.2s ease-out"
                                >
                                    {(() => {
                                        const channel = channels.find(c => c.id === expandedChannel)
                                        if (!channel) return null
                                        
                                        return (
                                            <>
                                                {/* Channel Header */}
                                                <Flex align="center" gap={3} mb={3}>
                                                    <Avatar 
                                                        name={channel.name}
                                                        size="md"
                                                        bg="blue.500"
                                                        color="white"
                                                        fontWeight="bold"
                                                    />
                                                    <VStack align="start" spacing={0} flex={1}>
                                                        <Flex align="center" gap={1}>
                                                            <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                                                {channel.name}
                                                            </Text>
                                                            <Text fontSize="lg">
                                                                {channel.category === 'news' ? '📰' : 
                                                                 channel.category === 'kids' ? '🧒' : '🎬'}
                                                            </Text>
                                                        </Flex>
                                                        <Flex align="center" gap={1} mt={1}>
                                                            <Box w="8px" h="8px" bg="red.500" borderRadius="full" />
                                                            <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                                                                {channel.bio}
                                                            </Text>
                                                        </Flex>
                                                    </VStack>
                                                </Flex>
                                                
                                                {/* Stream Buttons */}
                                                <VStack spacing={2} align="stretch">
                                                    {channel.streams.map((stream, index) => {
                                                        const loadingKey = `${channel.id}-${index}`
                                                        const isLoading = streamLoading[loadingKey]
                                                        
                                                        // Map button colors
                                                        const colorMap = {
                                                            'red': 'red',
                                                            'blue': 'blue',
                                                            'purple': 'purple',
                                                            'green': 'green',
                                                            'orange': 'orange',
                                                            'teal': 'teal'
                                                        }
                                                        
                                                        return (
                                                            <Button
                                                                key={index}
                                                                onClick={() => handleStreamClick(channel.id, index)}
                                                                isLoading={isLoading}
                                                                colorScheme={colorMap[stream.buttonColor] || 'blue'}
                                                                size="sm"
                                                                w="full"
                                                                leftIcon={<Box w="8px" h="8px" bg="red.500" borderRadius="full" />}
                                                            >
                                                                Watch Live {stream.name && `(${stream.name})`}
                                                            </Button>
                                                        )
                                                    })}
                                                    
                                                    {channel.streams.length > 1 && (
                                                        <Text fontSize="xs" color={secondaryTextColor} textAlign="center" mt={1}>
                                                            Choose your language
                                                        </Text>
                                                    )}
                                                </VStack>
                                            </>
                                        )
                                    })()}
                                </Box>
                            )}
                        </VStack>
                    )}
                </>
            ) : null}
        </Box>
    )
}

export default SuggestedChannels

