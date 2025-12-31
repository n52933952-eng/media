import React, { useState, useEffect, useContext } from 'react'
import { Box, Flex, Text, Avatar, Button, VStack, Spinner, useColorModeValue } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const SuggestedChannels = ({ onUserFollowed }) => {
    const { user, setUser } = useContext(UserContext)
    const [footballAccount, setFootballAccount] = useState(null)
    const [loading, setLoading] = useState(true)
    const [followLoading, setFollowLoading] = useState(false)
    const [isFollowing, setIsFollowing] = useState(false)
    
    const showToast = useShowToast()
    
    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const hoverBg = useColorModeValue('gray.50', 'gray.700')
    
    // Fetch Football channel account
    useEffect(() => {
        const fetchFootballAccount = async () => {
            try {
                setLoading(true)
                const res = await fetch(
                    `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/Football`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && data) {
                    setFootballAccount(data)
                    // Check if user is already following
                    if (user?.following) {
                        setIsFollowing(user.following.includes(data._id))
                    }
                }
            } catch (error) {
                console.error('Error fetching Football account:', error)
            } finally {
                setLoading(false)
            }
        }
        
        fetchFootballAccount()
    }, [user])
    
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
                // Update local state
                setIsFollowing(!isFollowing)
                
                // Update user context with new following list
                if (data.current) {
                    setUser(data.current)
                    localStorage.setItem('userInfo', JSON.stringify(data.current))
                }
                
                // If following (not unfollowing), auto-post and fetch matches
                if (!isFollowing) {
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
                            if (postData.posted) {
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
                            } else if (postData.alreadyExists) {
                                console.log('ℹ️ Post already exists for today')
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
                <Flex justify="center" py={6}>
                    <Spinner size="sm" />
                </Flex>
            ) : footballAccount ? (
                <VStack spacing={3} align="stretch">
                    {/* Football Channel */}
                    <Flex
                        align="center"
                        justify="space-between"
                        p={3}
                        borderRadius="md"
                        border="1px solid"
                        borderColor={borderColor}
                        _hover={{ bg: hoverBg }}
                        transition="all 0.2s"
                    >
                        <RouterLink to="/football" style={{ flexGrow: 1 }}>
                            <Flex align="center" gap={3}>
                                <Avatar 
                                    src={footballAccount.profilePic || "https://cdn-icons-png.flaticon.com/512/53/53283.png"}
                                    size="md"
                                />
                                <VStack align="start" spacing={0} flex={1}>
                                    <Flex align="center" gap={1}>
                                        <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                            {footballAccount.name}
                                        </Text>
                                        <Text fontSize="lg">⚽</Text>
                                    </Flex>
                                    <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                                        Live football scores & updates
                                    </Text>
                                    <Text fontSize="xs" color={secondaryTextColor} mt={1}>
                                        {footballAccount.followers?.length || 0} followers
                                    </Text>
                                </VStack>
                            </Flex>
                        </RouterLink>
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
            ) : null}
            
            {/* Al Jazeera News Channel */}
            {!loading && (
                <VStack spacing={3} align="stretch" mt={4}>
                    <Flex
                        align="center"
                        justify="space-between"
                        p={3}
                        borderRadius="md"
                        border="1px solid"
                        borderColor={borderColor}
                        _hover={{ bg: hoverBg }}
                        transition="all 0.2s"
                    >
                        <RouterLink to="/news" style={{ flexGrow: 1 }}>
                            <Flex align="center" gap={3}>
                                <Avatar 
                                    src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png"
                                    size="md"
                                    bg="white"
                                    p={1}
                                />
                                <VStack align="start" spacing={0} flex={1}>
                                    <Flex align="center" gap={1}>
                                        <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                            Al Jazeera
                                        </Text>
                                        <Text fontSize="lg">📰</Text>
                                    </Flex>
                                    <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                                        🔴 Live news 24/7
                                    </Text>
                                </VStack>
                            </Flex>
                        </RouterLink>
                    </Flex>
                    
                    {/* Follow Button for Live Stream */}
                    <Button
                        onClick={async () => {
                            try {
                                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                                const res = await fetch(`${baseUrl}/api/news/post/livestream`, {
                                    method: 'POST',
                                    credentials: 'include'
                                })
                                const data = await res.json()
                                if (res.ok) {
                                    showToast('Success', '🔴 Live stream added to your feed!', 'success')
                                } else {
                                    showToast('Info', data.message || 'Already in feed', 'info')
                                }
                            } catch (error) {
                                showToast('Error', 'Failed to add live stream', 'error')
                            }
                        }}
                        colorScheme="red"
                        size="sm"
                        w="full"
                    >
                        🔴 Watch Live
                    </Button>
                    
                    <Text fontSize="xs" color={secondaryTextColor} textAlign="center">
                        Click to add live stream to your feed
                    </Text>
                </VStack>
            )}
        </Box>
    )
}

export default SuggestedChannels

