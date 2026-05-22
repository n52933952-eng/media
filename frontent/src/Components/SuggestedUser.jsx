import React, { useState, useContext, useMemo, useEffect } from 'react'
import { Avatar, Box, Button, Flex, Text } from '@chakra-ui/react'
import { Link } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'
import { followPostHeaders } from '../utils/followRequest.js'

const SuggestedUser = ({ user, onFollowed, onUserFollowed, onPatchFollowState }) => {
  const showToast = useShowToast()
  const { user: currentUser, setUser } = useContext(UserContext)

  const [updating, setUpdating] = useState(false)

  /** Stable key so we resync when /me merges a new following[] after follow elsewhere */
  const followingFingerprint = useMemo(() => {
    const list = currentUser?.following
    if (!Array.isArray(list) || list.length === 0) return ''
    return [...list].map((f) => (f?.toString?.() ?? String(f))).filter(Boolean).sort().join(',')
  }, [currentUser?.following])

  const uid = user?._id?.toString?.() ?? String(user?._id ?? '')
  const derivedFollowed = useMemo(() => {
    const inSession =
      currentUser?.following?.some((id) => (id?.toString?.() ?? String(id)) === uid) ?? false
    const api = user?.isFollowedByMe
    const fromApi = typeof api === 'boolean' ? api : false
    return Boolean(fromApi || inSession)
  }, [uid, user?.isFollowedByMe, followingFingerprint, currentUser?._id])

  const [following, setFollowing] = useState(derivedFollowed)
  useEffect(() => {
    setFollowing(derivedFollowed)
  }, [derivedFollowed])

  const followed = following

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
          headers: followPostHeaders,
        }
      )

      let data = {}
      try {
        data = await res.json()
      } catch {
        showToast('Error', 'Invalid response', 'error')
        return
      }

      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }

      const wasFollowing = followed
      const nextFollowing = !wasFollowing
      onPatchFollowState?.(user._id, nextFollowing)
      
      // Update current user's following list and localStorage
      // Backend returns { action: "follow"/"unfollow", current: updatedUser, target: targetUser }
      if (setUser && data.current) {
        setUser((prev) => {
          const cur = data.current
          const merged = { ...(prev || {}), ...cur, _id: cur._id || cur.id || prev?._id }
          try {
            localStorage.setItem('userInfo', JSON.stringify(merged))
          } catch {
            void 0
          }
          return merged
        })
      } else if (setUser) {
        // Fallback: update manually if backend didn't return updated user
        setUser(prev => {
          const updated = {
            ...prev,
            following: wasFollowing
              ? prev.following.filter(id => id.toString() !== user._id.toString())
              : [...(prev.following || []), user._id]
          }
          localStorage.setItem("userInfo", JSON.stringify(updated))
          return updated
        })
      }

      // Always flip local button so UI updates even if context merge lags
      setFollowing(nextFollowing)

      // Notify parent component to remove this user from suggestions when followed
      if (!wasFollowing && onFollowed) {
        onFollowed(user._id)
      }

      // Fetch user's posts immediately when followed (for feed update)
      if (!wasFollowing && onUserFollowed) {
        onUserFollowed(user._id)
      }

      showToast(
        'Success',
        wasFollowing ? `Unfollowed ${user.name || user.username}` : `Following ${user.name || user.username}`,
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

