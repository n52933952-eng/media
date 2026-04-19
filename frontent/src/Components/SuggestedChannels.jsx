import React, { useState, useEffect, useContext, useRef } from 'react'
import { Box, Flex, Text, Avatar, Button, VStack, Spinner, useColorModeValue, SimpleGrid } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'
import FootballIcon from './FootballIcon'
import ChessChallenge from './ChessChallenge'
import CardChallenge from './CardChallenge'
import RaceChallenge from './RaceChallenge'

const SuggestedChannels = () => {
    const { user } = useContext(UserContext)
    const navigate = useNavigate()
    const [footballAccount, setFootballAccount] = useState(null)
    const [weatherAccount, setWeatherAccount] = useState(null)
    const [channels, setChannels] = useState([])
    const [loading, setLoading] = useState(true)
    const [streamLoading, setStreamLoading] = useState({})
    const [expandedChannel, setExpandedChannel] = useState(null) // Track which channel is expanded
    const expandedChannelRef = useRef(null) // Ref for scrolling to expanded channel details
    
    const showToast = useShowToast()

    const apiBase = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

    // Refresh Football/Weather profile snippets (optional follower counts) when logged in
    useEffect(() => {
        if (!user?._id) return
        let cancelled = false
        const run = async () => {
            try {
                const [fRes, wRes] = await Promise.all([
                    fetch(`${apiBase}/api/user/getUserPro/Football`, { credentials: 'include' }),
                    fetch(`${apiBase}/api/user/getUserPro/Weather`, { credentials: 'include' }),
                ])
                if (cancelled) return
                if (fRes.ok) {
                    const d = await fRes.json()
                    if (!d.error) setFootballAccount(d)
                }
                if (wRes.ok) {
                    const d = await wRes.json()
                    if (!d.error) setWeatherAccount(d)
                }
            } catch (e) {
                console.error('[SuggestedChannels] refresh channel profiles:', e)
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [user?._id, apiBase])
    
    const bgColor = useColorModeValue('white', '#1a1a1a')
    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const hoverBg = useColorModeValue('gray.50', 'gray.700')
    
    // Fetch Football channel account and all live channels (with caching to avoid unnecessary refetches)
    useEffect(() => {
        const fetchData = async (useCache = true) => {
            try {
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                const CACHE_KEY = 'suggestedChannelsCache'
                const CACHE_DURATION = 10 * 60 * 1000 // 10 minutes
                
                // Check cache first
                if (useCache) {
                    try {
                        const cached = localStorage.getItem(CACHE_KEY)
                        if (cached) {
                            const cacheData = JSON.parse(cached)
                            const now = Date.now()
                            
                            // Use cache if it's less than 10 minutes old
                            if (cacheData.timestamp && (now - cacheData.timestamp < CACHE_DURATION)) {
                                console.log('📦 [SuggestedChannels] Using cached data')
                                if (cacheData.footballAccount) {
                                    setFootballAccount(cacheData.footballAccount)
                                }
                                if (cacheData.channels) {
                                    setChannels(cacheData.channels)
                                }
                                setLoading(false)
                                
                                // Fetch fresh data in background (don't show loading)
                                fetchData(false)
                                return
                            }
                        }
                    } catch (error) {
                        console.error('Error reading cache:', error)
                    }
                }
                
                // Fetch fresh data
                if (!useCache || !loading) {
                    setLoading(true)
                }
                
                // Fetch Football account
                const footballRes = await fetch(
                    `${baseUrl}/api/user/getUserPro/Football`,
                    { credentials: 'include' }
                )
                const footballData = await footballRes.json()
                
                if (footballRes.ok && footballData) {
                    setFootballAccount(footballData)
                }
                
                // Fetch Weather account
                const weatherRes = await fetch(
                    `${baseUrl}/api/user/getUserPro/Weather`,
                    { credentials: 'include' }
                )
                const weatherData = await weatherRes.json()
                
                if (weatherRes.ok && weatherData) {
                    setWeatherAccount(weatherData)
                }
                
                // Fetch all live channels
                const channelsRes = await fetch(`${baseUrl}/api/news/channels`, {
                    credentials: 'include'
                })
                const channelsData = await channelsRes.json()
                
                if (channelsRes.ok && channelsData.channels) {
                    setChannels(channelsData.channels)
                }
                
                // Cache the data after fetching
                if (footballRes.ok && footballData && channelsRes.ok && channelsData.channels) {
                    try {
                        const cacheData = {
                            footballAccount: footballData,
                            channels: channelsData.channels,
                            timestamp: Date.now()
                        }
                        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData))
                        console.log('💾 [SuggestedChannels] Data cached')
                    } catch (error) {
                        console.error('Error caching data:', error)
                    }
                }
            } catch (error) {
                console.error('Error fetching data:', error)
            } finally {
                setLoading(false)
            }
        }
        
        fetchData(true) // Start with cache check
    }, []) // Only run on mount, not when user changes
    
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
                Explore
            </Text>
            
            {/* Loading */}
            {loading ? (
                <Box minH="400px" display="flex" alignItems="center" justifyContent="center">
                    <Spinner size="sm" />
                </Box>
            ) : (
                <>
                    {footballAccount && (
                    <>
                    {/* Compact Grid: Football & Weather */}
                    <SimpleGrid columns={2} spacing={2} mb={3}>
                        {/* Football Channel */}
                        <VStack spacing={2} align="stretch">
                            <Box
                                bg={cardBg}
                                borderRadius="md"
                                p={2}
                                border="1px solid"
                                borderColor={borderColor}
                                _hover={{ bg: hoverBg, borderColor: 'blue.300' }}
                                transition="all 0.2s"
                                cursor="pointer"
                                onClick={() => navigate('/football')}
                                position="relative"
                            >
                                <VStack spacing={1}>
                                    <FootballIcon size="32px" />
                                    <Text fontSize="2xs" fontWeight="semibold" color={textColor} textAlign="center" noOfLines={1}>
                                        Football
                                    </Text>
                                    <Text fontSize="2xs" color={secondaryTextColor} textAlign="center" noOfLines={2}>
                                        Live scores & fixtures
                                    </Text>
                                </VStack>
                            </Box>
                            
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    navigate('/football')
                                }}
                                colorScheme="blue"
                                size="sm"
                                w="full"
                            >
                                Visit page
                            </Button>
                        </VStack>

                        {/* Weather Channel */}
                        <VStack spacing={2} align="stretch">
                            <Box
                                bg={cardBg}
                                borderRadius="md"
                                p={2}
                                border="1px solid"
                                borderColor={borderColor}
                                _hover={{ bg: hoverBg, borderColor: 'blue.300' }}
                                transition="all 0.2s"
                                cursor="pointer"
                                onClick={() => {
                                    if (weatherAccount) {
                                        navigate(`/weather`)
                                    } else {
                                        showToast('Info', 'Weather feature coming soon!', 'info')
                                    }
                                }}
                                position="relative"
                                opacity={weatherAccount ? 1 : 0.7}
                            >
                                <VStack spacing={1}>
                                    <Text fontSize="2xl">🌤️</Text>
                                    <Text fontSize="2xs" fontWeight="semibold" color={textColor} textAlign="center" noOfLines={1}>
                                        Weather
                                    </Text>
                                    <Text fontSize="2xs" color={secondaryTextColor} textAlign="center" noOfLines={2}>
                                        {weatherAccount ? 'Forecasts & cities' : 'Coming soon'}
                                    </Text>
                                </VStack>
                            </Box>
                            
                            {weatherAccount ? (
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        navigate('/weather')
                                    }}
                                    colorScheme="blue"
                                    size="sm"
                                    w="full"
                                >
                                    Visit page
                                </Button>
                            ) : (
                                <Button size="sm" w="full" isDisabled opacity={0.5}>
                                    Coming soon
                                </Button>
                            )}
                        </VStack>
                    </SimpleGrid>
                    </>
                    )}

                    {/* Chess, Go Fish & Street Race — compact row */}
                    <Flex gap={2} w="full" align="stretch" mb={3}>
                        <Box flex="1" minW={0}>
                            <ChessChallenge compact />
                        </Box>
                        <Box flex="1" minW={0}>
                            <CardChallenge compact />
                        </Box>
                        <Box flex="1" minW={0}>
                            <RaceChallenge compact />
                        </Box>
                    </Flex>
                    
                    {/* Live Stream Channels */}
                    {footballAccount && channels.length > 0 && (
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
            )}
        </Box>
    )
}

export default SuggestedChannels

