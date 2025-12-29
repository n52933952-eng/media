import React, { useState, useContext } from 'react'
import { Avatar, Box, Button, Flex, Text, useToast } from '@chakra-ui/react'
import { Link } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const SuggestedUser = ({ user }) => {
  const toast = useToast()
  const showToast = useShowToast()
  const { user: currentUser, setUser } = useContext(UserContext)
  
  const [following, setFollowing] = useState(
    currentUser?.following?.includes(user._id) || false
  )
  const [updating, setUpdating] = useState(false)

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

      // Update local state
      setFollowing(!following)
      
      // Update current user's following list
      if (setUser) {
        setUser(prev => {
          if (following) {
            // Unfollow: remove from following
            return {
              ...prev,
              following: prev.following.filter(id => id !== user._id)
            }
          } else {
            // Follow: add to following
            return {
              ...prev,
              following: [...prev.following, user._id]
            }
          }
        })
      }

      showToast(
        'Success',
        following ? `Unfollowed ${user.name || user.username}` : `Following ${user.name || user.username}`,
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
    <Flex gap={2} justifyContent="space-between" alignItems="center" mb={3}>
      <Flex gap={2} as={Link} to={`/${user.username}`} flex={1}>
        <Avatar src={user.profilePic} name={user.name || user.username} size="sm" />
        <Box>
          <Text fontSize="sm" fontWeight="bold">
            {user.username}
          </Text>
          <Text color="gray.500" fontSize="xs">
            {user.name}
          </Text>
        </Box>
      </Flex>

      <Button
        size="sm"
        colorScheme={following ? 'gray' : 'blue'}
        variant={following ? 'outline' : 'solid'}
        onClick={handleFollow}
        isLoading={updating}
        isDisabled={updating}
      >
        {following ? 'Unfollow' : 'Follow'}
      </Button>
    </Flex>
  )
}

export default SuggestedUser

