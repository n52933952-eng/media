import React, { useState, useEffect } from 'react'
import { Box, Button, Flex, Text, Avatar, VStack, useColorModeValue, Spinner } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import useShowToast from '../hooks/useShowToast'

const KidsMovies = ({ onUserFollowed }) => {
    const [kidsAccount, setKidsAccount] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isFollowing, setIsFollowing] = useState(false)
    const [followLoading, setFollowLoading] = useState(false)

    const showToast = useShowToast()

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const hoverBg = useColorModeValue('gray.50', '#252525')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    useEffect(() => {
        fetchKidsAccount()
    }, [])

    const fetchKidsAccount = async () => {
        try {
            setLoading(true)
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            
            // First, initialize Kids account if it doesn't exist
            await fetch(`${baseUrl}/api/kids/init`, {
                method: 'POST',
                credentials: 'include'
            })
            
            // Then fetch the account
            const res = await fetch(`${baseUrl}/api/user/getUserPro/KidsMovies`, {
                credentials: 'include'
            })
            const data = await res.json()
            if (res.ok && data._id) {
                setKidsAccount(data)
                // Check if already following
                try {
                    const userStr = localStorage.getItem('user-threds')
                    if (userStr) {
                        const currentUser = JSON.parse(userStr)
                        if (currentUser?.following?.includes(data._id)) {
                            setIsFollowing(true)
                        }
                    }
                } catch (error) {
                    console.error('Error parsing user from localStorage:', error)
                }
            }
        } catch (error) {
            console.error('Error fetching Kids account:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleFollowToggle = async () => {
        if (!kidsAccount) return

        try {
            setFollowLoading(true)
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"

            // If not following, fetch cartoons first, then follow
            if (!isFollowing) {
                // Trigger cartoon post creation
                const cartoonRes = await fetch(`${baseUrl}/api/kids/post/random`, {
                    method: 'POST',
                    credentials: 'include'
                })
                const cartoonData = await cartoonRes.json()
                
                if (!cartoonRes.ok) {
                    showToast('Error', cartoonData.error || 'Failed to load cartoon', 'error')
                    return
                }
            }

            // Follow/Unfollow
            const res = await fetch(`${baseUrl}/api/user/follow/${kidsAccount._id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            })

            const data = await res.json()
            if (res.ok) {
                setIsFollowing(!isFollowing)
                showToast('Success', data.message, 'success')
                
                // Update local storage
                try {
                    const userStr = localStorage.getItem('user-threds')
                    if (userStr) {
                        const currentUser = JSON.parse(userStr)
                        if (!isFollowing) {
                            currentUser.following = [...(currentUser.following || []), kidsAccount._id]
                        } else {
                            currentUser.following = currentUser.following.filter(id => id !== kidsAccount._id)
                        }
                        localStorage.setItem('user-threds', JSON.stringify(currentUser))
                    }
                } catch (error) {
                    console.error('Error updating localStorage:', error)
                }
                
                // Notify parent to refresh
                if (onUserFollowed) {
                    onUserFollowed()
                }
            } else {
                showToast('Error', data.error || 'Action failed', 'error')
            }
        } catch (error) {
            console.error('Error:', error)
            showToast('Error', 'Something went wrong', 'error')
        } finally {
            setFollowLoading(false)
        }
    }

    if (loading) {
        return (
            <Box
                bg={bgColor}
                borderRadius="md"
                p={4}
                border="1px solid"
                borderColor={borderColor}
                mt={4}
            >
                <Flex justify="center">
                    <Spinner size="sm" />
                </Flex>
            </Box>
        )
    }

    if (!kidsAccount) return null

    return (
        <Box
            bg={bgColor}
            borderRadius="md"
            p={4}
            border="1px solid"
            borderColor={borderColor}
            mt={4}
        >
            <Text fontSize="sm" fontWeight="bold" mb={3} color={textColor}>
                🎬 Kids Movies
            </Text>

            <VStack spacing={3} align="stretch">
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
                    <RouterLink to="/kids" style={{ flexGrow: 1 }}>
                        <Flex align="center" gap={3}>
                            <Avatar
                                src="https://img.icons8.com/fluency/96/000000/kids.png"
                                size="md"
                            />
                            <VStack align="start" spacing={0} flex={1}>
                                <Flex align="center" gap={1}>
                                    <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                        Kids Movies
                                    </Text>
                                    <Text fontSize="lg">🎬</Text>
                                </Flex>
                                <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                                    Fun cartoons & movies!
                                </Text>
                            </VStack>
                        </Flex>
                    </RouterLink>
                </Flex>

                <Button
                    onClick={handleFollowToggle}
                    isLoading={followLoading}
                    colorScheme={isFollowing ? 'gray' : 'blue'}
                    size="sm"
                    w="full"
                >
                    {isFollowing ? 'Following' : 'Follow'}
                </Button>

                <Text fontSize="xs" color={secondaryTextColor} textAlign="center">
                    Click Follow to get random cartoons in your feed!
                </Text>
            </VStack>
        </Box>
    )
}

export default KidsMovies

