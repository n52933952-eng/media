import React, { useState, useContext, useMemo } from 'react'
import { Avatar, Box, Button, Flex, Text } from '@chakra-ui/react'
import { Link } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const SuggestedUser = ({ user, onFollowed, onUserFollowed, onPatchFollowState }) => {
  const showToast = useShowToast()
  const { user: currentUser, setUser } = useContext(UserContext)

  const [updating, setUpdating] = useState(false)

  /** Stable key so we recompute when /me merges a new following[] after mobile follow */
  const followingFingerprint = useMemo(() => {
    const list = currentUser?.following
    if (!Array.isArray(list) || list.length === 0) return ''
    return [...list].map((f) => (f?.toString?.() ?? String(f))).filter(Boolean).sort().join(',')
  }, [currentUser?.following])

  /**
   * Show Unfollow if either the server row says so OR your session following[] contains them
   * (covers: followed on mobile → web /me refreshed; search row still loading isFollowedByMe).
   */
  const followed = useMemo(() => {
    const uid = user?._id?.toString?.() ?? String(user?._id ?? '')
    const inSession =
      currentUser?.following?.some((id) => (id?.toString?.() ?? String(id)) === uid) ?? false
    const api = user?.isFollowedByMe
    const fromApi = typeof api === 'boolean' ? api : false
    return Boolean(fromApi || inSession)
  }, [user?._id, user?.isFollowedByMe, followingFingerprint, currentUser?._id])

  const handleFollow = async () => {
    if (!currentUser) {
      showToast('Error', 'Must be logged in to follow', 'error')
      return
    }

    if (user._id === currentUser._id) {
      showToast('Error', 'Cannot follow yourself', 'error')
      return
    }

    setUpdating(true)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/follow/${user._id}`,
        {
          credentials: 'include',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      const data = await res.json()

      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }

      const nextFollowing = !followed
      onPatchFollowState?.(user._id, nextFollowing)
      
      // Update current user's following list and localStorage
      // Backend returns { action: "follow"/"unfollow", current: updatedUser, target: targetUser }
      if (setUser && data.current) {
        // Use the updated user from backend response (most reliable)
        setUser(data.current)
        localStorage.setItem("userInfo", JSON.stringify(data.current))
      } else if (setUser) {
        // Fallback: update manually if backend didn't return updated user
        setUser(prev => {
          const updated = {
            ...prev,
            following: followed
              ? prev.following.filter(id => id.toString() !== user._id.toString())
              : [...(prev.following || []), user._id]
          }
          localStorage.setItem("userInfo", JSON.stringify(updated))
          return updated
        })
      }

      // Notify parent component to remove this user from suggestions when followed
      if (!followed && onFollowed) {
        onFollowed(user._id)
      }

      // Fetch user's posts immediately when followed (for feed update)
      if (!followed && onUserFollowed) {
        onUserFollowed(user._id)
      }

      showToast(
        'Success',
        followed ? `Unfollowed ${user.name || user.username}` : `Following ${user.name || user.username}`,
        'success'
      )
    } catch (error) {
      console.error('Error following/unfollowing:', error)
      showToast('Error', 'Failed to update follow status', 'error')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Flex 
      gap={2} 
      justifyContent="space-between" 
      alignItems="center" 
      mb={3}
      transition="opacity 0.2s ease, transform 0.2s ease"
      _hover={{ opacity: 0.9 }}
    >
      <Flex gap={2} as={Link} to={`/${user.username}`} flex={1} minW={0}>
        <Avatar src={user.profilePic} name={user.name || user.username} size="sm" flexShrink={0} />
        <Box minW={0} flex={1}>
          <Text fontSize="sm" fontWeight="bold" noOfLines={1}>
            {user.username}
          </Text>
          <Text color="gray.500" fontSize="xs" noOfLines={1}>
            {user.name}
          </Text>
        </Box>
      </Flex>

      <Button
        size="sm"
        colorScheme={followed ? 'gray' : 'blue'}
        variant={followed ? 'outline' : 'solid'}
        onClick={handleFollow}
        isLoading={updating}
        isDisabled={updating}
        flexShrink={0}
        transition="all 0.2s ease"
      >
        {followed ? 'Unfollow' : 'Follow'}
      </Button>
    </Flex>
  )
}

export default SuggestedUser

