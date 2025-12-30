import React, { useState, useEffect, useContext, useCallback } from 'react'
import { Box, Flex, Text, Input, InputGroup, InputLeftElement, Spinner, useColorModeValue } from '@chakra-ui/react'
import { SearchIcon } from '@chakra-ui/icons'
import SuggestedUser from './SuggestedUser'
import { UserContext } from '../context/UserContext'

const SuggestedUsers = ({ onUserFollowed }) => {
  const { user } = useContext(UserContext)
  const [loading, setLoading] = useState(true)
  const [suggestedUsers, setSuggestedUsers] = useState([])
  const [footballAccount, setFootballAccount] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)

  const bgColor = useColorModeValue('white', '#1a1a1a')
  const borderColor = useColorModeValue('gray.200', '#2d2d2d')
  const textColor = useColorModeValue('gray.600', 'gray.400')

  // Fetch Football channel account
  const fetchFootballAccount = useCallback(async () => {
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/Football`,
        {
          credentials: 'include',
        }
      )

      const data = await res.json()
      if (res.ok && data._id) {
        setFootballAccount(data)
      }
    } catch (error) {
      console.error('Error fetching Football account:', error)
    }
  }, [])

  // Fetch suggested users - memoized to prevent infinite loops
  const fetchSuggestedUsers = useCallback(async () => {
    if (!user?._id) {
      setLoading(false)
      return
    }
    
    setLoading(true)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/suggested`,
        {
          credentials: 'include',
        }
      )

      const data = await res.json()
      if (res.ok && Array.isArray(data)) {
        // Filter out Football system account from suggestions (it's in Suggested Channels)
        const filteredUsers = data.filter(u => u.username !== 'Football')
        setSuggestedUsers(filteredUsers)
      } else {
        setSuggestedUsers([])
      }
    } catch (error) {
      console.error('Error fetching suggested users:', error)
      setSuggestedUsers([])
    } finally {
      setLoading(false)
    }
  }, [user?._id])

  // Search users
  const handleSearch = async (query) => {
    setSearchQuery(query)

    if (query.trim().length === 0) {
      setSearchResults([])
      return
    }

    setSearchLoading(true)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/search?search=${encodeURIComponent(query)}`,
        {
          credentials: 'include',
        }
      )

      const data = await res.json()
      if (res.ok) {
        setSearchResults(data || [])
      }
    } catch (error) {
      console.error('Error searching users:', error)
    } finally {
      setSearchLoading(false)
    }
  }

  useEffect(() => {
    if (user?._id) {
      fetchSuggestedUsers()
      fetchFootballAccount()
    } else {
      setLoading(false)
      setSuggestedUsers([])
    }
  }, [user?._id, fetchSuggestedUsers, fetchFootballAccount])

  // Remove user from suggestions immediately when followed
  const handleUserFollowed = (followedUserId) => {
    setSuggestedUsers(prev => prev.filter(u => u._id !== followedUserId))
  }

  // Refresh suggestions when user follows/unfollows (triggered by SuggestedUser component)
  useEffect(() => {
    if (user?._id && user?.following !== undefined) {
      // Delay to ensure backend database has been updated
      const timer = setTimeout(() => {
        fetchSuggestedUsers()
      }, 1000) // Reduced delay - backend is fast
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.following?.length]) // Refresh when following list changes

  // Filter out already followed users from suggestions
  // Check both string and ObjectId comparison
  const filteredSuggestedUsers = suggestedUsers.filter(suggestedUser => {
    if (!user?.following || user.following.length === 0) return true
    // Convert both to strings for reliable comparison
    const suggestedUserId = suggestedUser._id?.toString()
    return !user.following.some(followedId => {
      const followedIdStr = followedId?.toString()
      return followedIdStr === suggestedUserId
    })
  })

  return (
    <Box
      position="sticky"
      top="120px"
      bg={bgColor}
      borderRadius="md"
      p={4}
      border="1px solid"
      borderColor={borderColor}
      maxW="280px"
      ml="auto"
    >
      {/* Search Input */}
      <InputGroup mb={4}>
        <InputLeftElement pointerEvents="none">
          <SearchIcon color="gray.400" />
        </InputLeftElement>
        <Input
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          bg={useColorModeValue('gray.50', '#2d2d2d')}
        />
      </InputGroup>

      {/* Search Results */}
      {searchQuery.trim().length > 0 && (
        <Box mb={4}>
          <Text fontSize="sm" fontWeight="bold" mb={2} color={textColor}>
            Search Results
          </Text>
          {searchLoading ? (
            <Flex justifyContent="center" p={4}>
              <Spinner size="sm" />
            </Flex>
          ) : searchResults.length > 0 ? (
            <Flex direction="column" gap={2}>
              {searchResults
                .filter(searchUser => !user?.following?.includes(searchUser._id))
                .map((searchUser) => (
                  <SuggestedUser 
                    key={searchUser._id} 
                    user={searchUser}
                    onFollowed={handleUserFollowed}
                    onUserFollowed={onUserFollowed}
                  />
                ))}
            </Flex>
          ) : (
            <Text fontSize="sm" color={textColor}>
              No users found
            </Text>
          )}
        </Box>
      )}

      {/* Suggested Users (only show when not searching) */}
      {searchQuery.trim().length === 0 && (
        <Box>
          <Text fontSize="sm" fontWeight="bold" mb={3} color={textColor}>
            Suggested for you
          </Text>

          {loading ? (
            <Flex direction="column" gap={3}>
              {[0].map((idx) => (
                <Flex key={idx} gap={2} alignItems="center">
                  <Box>
                    <Spinner size="sm" />
                  </Box>
                  <Box flex={1}>
                    <Text fontSize="sm" color={textColor}>
                      Loading...
                    </Text>
                  </Box>
                </Flex>
              ))}
            </Flex>
          ) : filteredSuggestedUsers.length > 0 ? (
            <Flex direction="column" gap={1}>
              {filteredSuggestedUsers.map((suggestedUser) => (
                <SuggestedUser 
                  key={suggestedUser._id} 
                  user={suggestedUser}
                  onFollowed={handleUserFollowed}
                  onUserFollowed={onUserFollowed}
                />
              ))}
            </Flex>
          ) : (
            <Text fontSize="sm" color={textColor}>
              No suggestions available
            </Text>
          )}
        </Box>
      )}
    </Box>
  )
}

export default SuggestedUsers

