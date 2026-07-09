import React, { useState, useEffect, useMemo } from 'react'
import {
  Box,
  Input,
  Text,
  VStack,
  HStack,
  Avatar,
  Spinner,
  Button,
  IconButton,
  useColorModeValue,
} from '@chakra-ui/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons'
import API_BASE_URL from '../config/api'
import { SYSTEM_COLLABORATOR_USERNAMES } from '../utils/collaborators'

const DEFAULT_PAGE_SIZE = 6

/**
 * Following list + debounced search, paginated rows (avoids long scroll lists).
 */
const CollaboratorPicker = ({
  excludeUserIds = [],
  onSelectUser,
  pageSize = DEFAULT_PAGE_SIZE,
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [followingUsers, setFollowingUsers] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false)
  const [page, setPage] = useState(0)

  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const bg = useColorModeValue('white', 'gray.800')
  const panelBg = useColorModeValue('gray.50', 'gray.900')
  const textColor = useColorModeValue('gray.800', 'white')
  const mutedColor = useColorModeValue('gray.600', 'gray.400')
  const rowHover = useColorModeValue('gray.100', 'gray.700')

  const exclude = useMemo(
    () => new Set((excludeUserIds || []).filter(Boolean).map((id) => String(id))),
    [excludeUserIds],
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
        if (!q) return true
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
          { credentials: 'include' },
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

  useEffect(() => {
    setPage(0)
  }, [searchQuery, excludeKey])

  const canPick = (u) => {
    const id = u._id?.toString()
    return (
      id &&
      !exclude.has(id) &&
      !SYSTEM_COLLABORATOR_USERNAMES.has(u.username || '')
    )
  }

  const visibleUsers = useMemo(
    () => searchResults.filter(canPick),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchResults, excludeKey],
  )

  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageUsers = visibleUsers.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  )

  const listLabel = (() => {
    const q = searchQuery.trim()
    if (!q) return 'People you follow'
    if (q.length < 2) return 'Matching people you follow'
    return 'Search results'
  })()

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
        spacing={3}
        bg={bg}
        _hover={{ bg: rowHover }}
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
        <Button
          size="xs"
          colorScheme="blue"
          variant="outline"
          type="button"
          onClick={() => onSelectUser(u)}
        >
          Add
        </Button>
      </HStack>
    )
  }

  return (
    <VStack align="stretch" spacing={2}>
      <Input
        size="sm"
        placeholder="Search people to add…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        bg={bg}
        borderColor={borderColor}
      />

      <Box
        borderWidth="1px"
        borderColor={borderColor}
        borderRadius="md"
        bg={panelBg}
        p={2}
        minH="120px"
      >
        {isSearching || isLoadingFollowing ? (
          <HStack justify="center" py={6}>
            <Spinner size="sm" />
            <Text fontSize="sm" color={mutedColor}>Loading…</Text>
          </HStack>
        ) : visibleUsers.length === 0 ? (
          <Text fontSize="sm" color={mutedColor} textAlign="center" py={6}>
            {!searchQuery.trim() && followingUsers.length === 0
              ? 'You are not following anyone yet. Search by name (2+ letters).'
              : searchQuery.trim().length === 1
                ? 'Type another letter to search everyone.'
                : 'No users found.'}
          </Text>
        ) : (
          <>
            <HStack justify="space-between" mb={2} px={1}>
              <Text fontSize="xs" fontWeight="600" color={mutedColor}>
                {listLabel} · {visibleUsers.length}
              </Text>
              {totalPages > 1 && (
                <Text fontSize="xs" color={mutedColor}>
                  {safePage + 1} / {totalPages}
                </Text>
              )}
            </HStack>
            <VStack align="stretch" spacing={2}>
              {pageUsers.map((u) => (
                <Row key={u._id} u={u} />
              ))}
            </VStack>
            {totalPages > 1 && (
              <HStack justify="center" mt={3} spacing={2}>
                <IconButton
                  aria-label="Previous page"
                  icon={<ChevronLeftIcon />}
                  size="sm"
                  variant="outline"
                  isDisabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setPage(0)}
                  isDisabled={safePage === 0}
                >
                  First
                </Button>
                <IconButton
                  aria-label="Next page"
                  icon={<ChevronRightIcon />}
                  size="sm"
                  variant="outline"
                  isDisabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                />
              </HStack>
            )}
          </>
        )}
      </Box>
    </VStack>
  )
}

export default CollaboratorPicker
