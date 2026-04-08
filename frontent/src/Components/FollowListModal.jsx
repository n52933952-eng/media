import React, { useState, useEffect, useCallback, useContext } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Flex,
  Box,
  Text,
  Avatar,
  Spinner,
  Button,
  useColorModeValue,
} from '@chakra-ui/react'
import { Link } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'

const PAGE_SIZE = 12

function normalizeFollowListResponse(data) {
  if (data && typeof data === 'object' && Array.isArray(data.users)) {
    return {
      users: data.users,
      hasMore: !!data.hasMore,
      nextSkip: typeof data.nextSkip === 'number' ? data.nextSkip : data.users.length,
    }
  }
  if (Array.isArray(data)) {
    return { users: data, hasMore: false, nextSkip: data.length }
  }
  return { users: [], hasMore: false, nextSkip: 0 }
}

/**
 * Paginated followers / following list — same API contract as mobile FollowListScreen.
 */
const FollowListModal = ({
  isOpen,
  onClose,
  listType,
  userId,
  displayUsername,
  onMutated,
}) => {
  const { user: currentUser, setUser } = useContext(UserContext)
  const showToast = useShowToast()
  const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

  const bg = useColorModeValue('white', '#1a1a1a')
  const border = useColorModeValue('gray.200', '#2d2d2d')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const rowBg = useColorModeValue('gray.50', '#252525')

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [nextSkip, setNextSkip] = useState(0)
  const [actingId, setActingId] = useState(null)

  const isOwnList =
    userId &&
    currentUser?._id &&
    String(currentUser._id) === String(userId)

  const listPath =
    listType === 'following' ? `${baseUrl}/api/user/following` : `${baseUrl}/api/user/followers`

  const fetchPage = useCallback(
    async (skip, mode) => {
      const parts = [`limit=${PAGE_SIZE}`, `skip=${skip}`]
      if (userId) parts.push(`userId=${encodeURIComponent(userId)}`)
      const res = await fetch(`${listPath}?${parts.join('&')}`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load list')
      }
      const { users: page, hasMore: more, nextSkip: ns } = normalizeFollowListResponse(data)
      if (mode === 'replace') {
        setUsers(page)
      } else {
        setUsers((prev) => {
          const seen = new Set(prev.map((u) => String(u._id ?? '')))
          const merged = [...prev]
          for (const u of page) {
            const id = String(u._id ?? '')
            if (id && !seen.has(id)) {
              seen.add(id)
              merged.push(u)
            }
          }
          return merged
        })
      }
      setHasMore(more)
      setNextSkip(ns)
    },
    [listPath, userId]
  )

  useEffect(() => {
    if (!isOpen || !listType || !userId) return
    let cancelled = false
    setLoading(true)
    setUsers([])
    setHasMore(true)
    setNextSkip(0)
    ;(async () => {
      try {
        await fetchPage(0, 'replace')
      } catch (e) {
        if (!cancelled) {
          showToast('Error', e?.message || 'Failed to load list', 'error')
          setUsers([])
          setHasMore(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, listType, userId, fetchPage, showToast])

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return
    setLoadingMore(true)
    try {
      await fetchPage(nextSkip, 'append')
    } catch (e) {
      showToast('Error', e?.message || 'Failed to load more', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const handleUnfollow = async (targetId) => {
    if (!targetId) return
    setActingId(targetId)
    try {
      const res = await fetch(`${baseUrl}/api/user/follow/${targetId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }
      if (data.current) {
        setUser(data.current)
        localStorage.setItem('userInfo', JSON.stringify(data.current))
      }
      setUsers((prev) => prev.filter((u) => String(u._id) !== String(targetId)))
      showToast('Success', 'Unfollowed', 'success')
      onMutated?.()
    } catch (e) {
      showToast('Error', e?.message || 'Failed', 'error')
    } finally {
      setActingId(null)
    }
  }

  const handleRemoveFollower = async (followerId) => {
    if (!followerId) return
    setActingId(followerId)
    try {
      const res = await fetch(`${baseUrl}/api/user/follower/${followerId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('Error', data.error || 'Failed to remove', 'error')
        return
      }
      if (data.current) {
        setUser(data.current)
        localStorage.setItem('userInfo', JSON.stringify(data.current))
      }
      setUsers((prev) => prev.filter((u) => String(u._id) !== String(followerId)))
      showToast('Success', 'Removed follower', 'success')
      onMutated?.()
    } catch (e) {
      showToast('Error', e?.message || 'Failed', 'error')
    } finally {
      setActingId(null)
    }
  }

  const titleBase = listType === 'following' ? 'Following' : 'Followers'
  const title =
    displayUsername && userId && !isOwnList
      ? `@${displayUsername} · ${titleBase}`
      : titleBase

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" scrollBehavior="inside" isCentered>
      <ModalOverlay />
      <ModalContent bg={bg} maxH="85vh">
        <ModalHeader borderBottomWidth="1px" borderColor={border}>
          {title}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6} pt={2}>
          {loading ? (
            <Flex justify="center" py={12}>
              <Spinner size="lg" />
            </Flex>
          ) : users.length === 0 ? (
            <Text textAlign="center" color={muted} py={10}>
              {listType === 'following' ? 'No accounts followed yet' : 'No followers yet'}
            </Text>
          ) : (
            <>
              {users.map((item) => {
                const uid = item._id?.toString()
                const busy = actingId === uid
                return (
                  <Flex
                    key={uid || item.username}
                    align="center"
                    gap={3}
                    p={3}
                    mb={2}
                    borderRadius="md"
                    bg={rowBg}
                    borderWidth="1px"
                    borderColor={border}
                  >
                    <Box
                      as={Link}
                      to={`/${item.username}`}
                      onClick={onClose}
                      display="flex"
                      alignItems="center"
                      gap={3}
                      flex={1}
                      minW={0}
                    >
                      <Avatar src={item.profilePic} name={item.name} size="md" />
                      <Box minW={0}>
                        <Text fontWeight="semibold" noOfLines={1}>
                          {item.name || 'User'}
                        </Text>
                        <Text fontSize="sm" color={muted} noOfLines={1}>
                          @{item.username}
                        </Text>
                      </Box>
                    </Box>
                    {isOwnList && listType === 'following' && (
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={busy}
                        onClick={() => handleUnfollow(uid)}
                      >
                        Unfollow
                      </Button>
                    )}
                    {isOwnList && listType === 'followers' && (
                      <Button
                        size="sm"
                        colorScheme="red"
                        variant="outline"
                        isLoading={busy}
                        onClick={() => handleRemoveFollower(uid)}
                      >
                        Remove
                      </Button>
                    )}
                  </Flex>
                )
              })}
              {hasMore && (
                <Flex justify="center" pt={4}>
                  <Button size="sm" onClick={loadMore} isLoading={loadingMore} variant="ghost">
                    Load more
                  </Button>
                </Flex>
              )}
            </>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default FollowListModal
