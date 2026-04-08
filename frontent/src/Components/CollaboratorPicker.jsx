import React, { useState, useEffect, useMemo } from 'react'
import {
  Box,
  Input,
  Text,
  VStack,
  HStack,
  Avatar,
  Spinner,
  useColorModeValue,
} from '@chakra-ui/react'
import API_BASE_URL from '../config/api'
import { SYSTEM_COLLABORATOR_USERNAMES } from '../utils/collaborators'

/**
 * Same behavior as mobile CollaboratorPicker: following list + debounced search (300ms, 2+ chars).
 * @param {{ excludeUserIds: string[], onSelectUser: (u: object) => void }} props
 */
const CollaboratorPicker = ({ excludeUserIds = [], onSelectUser }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [followingUsers, setFollowingUsers] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false)

  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const bg = useColorModeValue('white', 'gray.800')
  const textColor = useColorModeValue('gray.800', 'white')
  const mutedColor = useColorModeValue('gray.600', 'gray.400')
  const rowHover = useColorModeValue('gray.50', 'gray.700')

  const exclude = useMemo(
    () => new Set((excludeUserIds || []).filter(Boolean).map((id) => String(id))),
    [excludeUserIds]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setIsLoadingFollowing(true)
      try {
        const res = await fetch(`${API_BASE_URL}/api/user/following`, { credentials: 'include' })
        const data = await res.json()
        if (!cancelled && res.ok && Array.isArray(data)) {
          setFollowingUsers(data)
        } else if (!cancelled) setFollowingUsers([])
      } catch {
        if (!cancelled) setFollowingUsers([])
      } finally {
        if (!cancelled) setIsLoadingFollowing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const excludeKey = excludeUserIds.join('|')

  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      const filtered = followingUsers.filter((u) => {
        const id = u._id?.toString()
        if (!id || exclude.has(id)) return false
        if (SYSTEM_COLLABORATOR_USERNAMES.has(u.username || '')) return false
        const nameMatch = u.name?.toLowerCase().includes(q.toLowerCase())
        const usernameMatch = u.username?.toLowerCase().includes(q.toLowerCase())
        return nameMatch || usernameMatch
      })
      setSearchResults(filtered)
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/user/search?search=${encodeURIComponent(q)}`,
          { credentials: 'include' }
        )
        const data = await res.json()
        const list = res.ok && Array.isArray(data) ? data : []
        const filtered = list.filter((u) => {
          const id = u._id?.toString()
          return (
            id &&
            !exclude.has(id) &&
            !SYSTEM_COLLABORATOR_USERNAMES.has(u.username || '')
          )
        })
        setSearchResults(filtered)
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, followingUsers, excludeKey, exclude])

  const showFollowingBlock = !searchQuery.trim() && followingUsers.length > 0
  const showSearchBlock = searchQuery.trim().length >= 1 && searchResults.length > 0

  const canPick = (u) => {
    const id = u._id?.toString()
    return (
      id &&
      !exclude.has(id) &&
      !SYSTEM_COLLABORATOR_USERNAMES.has(u.username || '')
    )
  }

  const Row = ({ u }) => {
    const id = u._id?.toString()
    return (
      <HStack
        key={id}
        w="full"
        p={2}
        borderRadius="md"
        borderWidth="1px"
        borderColor={borderColor}
        cursor="pointer"
        _hover={{ bg: rowHover }}
        onClick={() => onSelectUser(u)}
        spacing={3}
      >
        <Avatar size="sm" src={u.profilePic} name={u.name || u.username} />
        <Box flex={1} minW={0} textAlign="left">
          <Text fontSize="sm" fontWeight="600" color={textColor} noOfLines={1}>
            {u.name || u.username}
          </Text>
          <Text fontSize="xs" color={mutedColor} noOfLines={1}>
            @{u.username}
          </Text>
        </Box>
        <Text fontSize="sm" fontWeight="600" color="blue.400">
          Add
        </Text>
      </HStack>
    )
  }

  return (
    <VStack align="stretch" spacing={2} mt={2}>
      <Input
        size="sm"
        placeholder="Search people to add as contributors…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        bg={bg}
        borderColor={borderColor}
      />
      {isSearching && <Spinner size="sm" alignSelf="center" />}

      {showFollowingBlock && (
        <Box>
          <Text fontSize="xs" fontWeight="600" color={mutedColor} mb={2}>
            People you follow
          </Text>
          {isLoadingFollowing ? (
            <Spinner size="sm" />
          ) : (
            <VStack align="stretch" spacing={2}>
              {followingUsers.filter(canPick).map((fu) => (
                <Row key={fu._id} u={fu} />
              ))}
            </VStack>
          )}
        </Box>
      )}

      {showSearchBlock && searchQuery.trim().length >= 1 && (
        <Box>
          <Text fontSize="xs" fontWeight="600" color={mutedColor} mb={2}>
            {searchQuery.trim().length < 2 ? 'Matching people you follow' : 'Search results'}
          </Text>
          <VStack align="stretch" spacing={2}>
            {searchResults.filter(canPick).map((r) => (
              <Row key={r._id} u={r} />
            ))}
          </VStack>
        </Box>
      )}

      {searchQuery.trim().length >= 1 && searchResults.length === 0 && !isSearching && (
        <Text fontSize="sm" color={mutedColor} textAlign="center">
          {searchQuery.trim().length === 1
            ? 'Type another letter to search everyone, or pick from the list above.'
            : 'No users found.'}
        </Text>
      )}

      {!searchQuery && !isLoadingFollowing && followingUsers.length === 0 && (
        <Text fontSize="sm" color={mutedColor} textAlign="center">
          You are not following anyone yet. Search by name (2+ letters) to add contributors.
        </Text>
      )}
    </VStack>
  )
}

export default CollaboratorPicker
