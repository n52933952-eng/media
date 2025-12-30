import React, { useState, useEffect, useContext } from 'react'
import { Box, Flex, Text, Avatar, Button, VStack, Spinner, useColorModeValue } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const SuggestedChannels = () => {
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
                    localStorage.setItem('user-threads', JSON.stringify(data.current))
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
            ) : (
                <Text fontSize="sm" color={secondaryTextColor} textAlign="center">
                    No channels available
                </Text>
            )}
        </Box>
    )
}

export default SuggestedChannels

