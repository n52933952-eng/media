import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Box, Flex, Text, Avatar, Button, Image, IconButton, Spinner, SimpleGrid, useColorModeValue } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'
import { followPostHeaders } from '../utils/followRequest.js'
import API_BASE_URL from '../config/api'
import { isVideoUrl, mediaDisplayUrl, videoPosterUrl } from '../utils/mediaUrl.js'

const PAGE_SIZE = 16

function clipWords(text, max = 10) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'No posts yet'
  if (words.length <= max) return words.join(' ')
  return `${words.slice(0, max).join(' ')} …`
}

const TEXT_FLAVORS = [
  { light: '#E7F4FF', dark: '#10283A', accent: '#1DA1F2' },
  { light: '#F3EEFF', dark: '#221838', accent: '#8B6CFF' },
  { light: '#E8FBF2', dark: '#10281E', accent: '#1DBF73' },
  { light: '#FFF3E6', dark: '#2C1C10', accent: '#F0A04B' },
  { light: '#FDECEF', dark: '#2C141C', accent: '#E86B86' },
  { light: '#E7F8F8', dark: '#102628', accent: '#2BB8C7' },
]

function textFlavor(seed) {
  let n = 0
  const s = String(seed || '')
  for (let i = 0; i < s.length; i += 1) n = (n + s.charCodeAt(i) * (i + 1)) % TEXT_FLAVORS.length
  return TEXT_FLAVORS[n]
}

const ExplorePage = () => {
  const { user: currentUser, setUser } = useContext(UserContext)
  const showToast = useShowToast()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [followingId, setFollowingId] = useState('')
  const usersRef = useRef([])
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const sentinelRef = useRef(null)
  usersRef.current = users
  const cardBg = useColorModeValue('white', 'gray.800')
  const border = useColorModeValue('gray.200', 'gray.700')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const emptyBg = useColorModeValue('#EEF4FF', '#15202B')
  const isDark = useColorModeValue(false, true)

  const load = useCallback(async (mode = 'reset') => {
    if (mode === 'more') {
      if (loadingMoreRef.current || !hasMoreRef.current) return
      loadingMoreRef.current = true
      setLoadingMore(true)
    } else {
      setLoading(true)
      hasMoreRef.current = true
      setHasMore(true)
    }
    try {
      const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
      const exclude =
        mode === 'more'
          ? usersRef.current.map((u) => String(u._id || '')).filter(Boolean).slice(0, 80).join(',')
          : ''
      const q = exclude
        ? `?limit=${PAGE_SIZE}&exclude=${encodeURIComponent(exclude)}`
        : `?limit=${PAGE_SIZE}`
      const res = await fetch(`${base}/api/user/explore${q}`, { credentials: 'include' })
      const data = await res.json()
      const next = Array.isArray(data?.users) ? data.users : []
      const more = data?.hasMore === true && next.length > 0
      hasMoreRef.current = more
      setHasMore(more)
      const deduped = []
      const seenUser = new Set()
      const seenName = new Set()
      const seenPost = new Set()
      for (const u of (mode === 'more' ? [...usersRef.current, ...next] : next)) {
        const id = String(u?._id || '')
        const postId = String(u?.latestPost?._id || '')
        const name = String(u?.name || '').trim().toLowerCase() || String(u?.username || '').trim().toLowerCase()
        if (!id || seenUser.has(id)) continue
        if (name && seenName.has(name)) continue
        if (postId && seenPost.has(postId)) continue
        seenUser.add(id)
        if (name) seenName.add(name)
        if (postId) seenPost.add(postId)
        deduped.push(u)
      }
      if (mode === 'more' && deduped.length === usersRef.current.length) {
        hasMoreRef.current = false
        setHasMore(false)
      }
      setUsers(deduped)
    } catch (e) {
      showToast('Error', e?.message || 'Could not load people', 'error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
      loadingMoreRef.current = false
    }
  }, [showToast])

  const country = String(currentUser?.country || '')
  useEffect(() => { load('reset') }, [load, country])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load('more')
    }, { rootMargin: '240px' })
    io.observe(el)
    return () => io.disconnect()
  }, [load, users.length])

  const follow = async (target) => {
    const targetId = String(target?._id || '')
    if (!targetId || !currentUser?._id || followingId) return
    setFollowingId(targetId)
    try {
      const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
      const res = await fetch(`${base}/api/user/follow/${targetId}`, {
        method: 'POST',
        credentials: 'include',
        headers: followPostHeaders,
      })
      const data = await res.json()
      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }
      if (data.current) {
        const next = { ...currentUser, following: data.current.following, followers: data.current.followers }
        localStorage.setItem('userInfo', JSON.stringify(next))
        setUser(next)
      }
      setUsers((prev) => prev.filter((u) => String(u._id) !== targetId))
      showToast('Success', `Following ${target?.name || target?.username || 'user'}`, 'success')
    } catch (e) {
      showToast('Error', e?.message || 'Follow failed', 'error')
    } finally {
      setFollowingId('')
    }
  }

  return (
    <Box py={{ base: 2, md: 4 }} px={{ base: 1, sm: 0 }} maxW="720px" mx="auto" w="100%">
      <Flex align="center" justify="space-between" mb={{ base: 2, md: 4 }} px={{ base: 1, md: 0 }}>
        <Text fontSize={{ base: 'lg', md: 'xl' }} fontWeight="bold">Explore people</Text>
        <IconButton aria-label="Refresh" icon={<Text fontSize="lg">↻</Text>} onClick={() => load('reset')} variant="ghost" />
      </Flex>
      {loading && users.length === 0 ? (
        <Flex justify="center" py={16}><Spinner /></Flex>
      ) : users.length === 0 ? (
        <Text color={muted} textAlign="center" py={10}>No people to show yet. Tap refresh.</Text>
      ) : (
        <>
        <SimpleGrid columns={{ base: 2, lg: 3 }} spacing={{ base: 1.5, md: 2 }}>
          {users.map((item) => {
            const preview = item.latestPost
            const raw = String(preview?.img || '').trim()
            const img = mediaDisplayUrl(raw)
            const text = String(preview?.text || '').trim()
            const video = isVideoUrl(img)
            const poster = video ? videoPosterUrl(img) : ''
            const displayName = String(item.name || item.username || 'User').trim()
            const avatarUrl = String(item.profilePic || '').trim()
            const channelUrl = String(preview?.channelPic || '').trim()
            const imgIsAvatar = !!raw && (raw === avatarUrl || raw === channelUrl || img === avatarUrl || img === channelUrl)
            const photo = img && !imgIsAvatar ? img : ''
            const snippet = clipWords(text, 20)
            const wordCount = snippet.replace(' …', '').trim().split(/\s+/).filter(Boolean).length
            const shortQuote = wordCount <= 3
            const sameAsName = !!text && (text === item.username || text === item.name || text === displayName)
            const nameOnly = !photo && !video && (!text || sameAsName)
            const flavor = textFlavor(String(item._id || displayName))
            const letter = displayName[0]?.toUpperCase() || '?'
            return (
              <Box key={item._id}>
                <Box borderRadius="full" overflow="hidden" bg={cardBg} borderWidth="1px" borderColor={border}>
                {(() => {
                  if (nameOnly) {
                    return (
                      <Flex
                        w="100%"
                        pt="100%"
                        position="relative"
                        bg={emptyBg}
                        cursor="pointer"
                        onClick={() => item.username && navigate(`/${item.username}`)}
                      >
                        <Flex position="absolute" inset={0} align="center" justify="center">
                          <Text color="blue.400" fontSize="5xl" fontWeight="extrabold" lineHeight="1">{letter}</Text>
                        </Flex>
                      </Flex>
                    )
                  }
                  if (video && photo) {
                    return (
                      <Box
                        position="relative"
                        w="100%"
                        pt="100%"
                        overflow="hidden"
                        bg="black"
                        cursor="pointer"
                        onClick={() => item.username && navigate(`/${item.username}`)}
                      >
                        {poster ? (
                          <Image
                            src={poster}
                            alt=""
                            position="absolute"
                            inset={0}
                            w="100%"
                            h="100%"
                            objectFit="contain"
                          />
                        ) : (
                          <Box
                            as="video"
                            src={photo}
                            muted
                            preload="metadata"
                            playsInline
                            position="absolute"
                            inset={0}
                            w="100%"
                            h="100%"
                            objectFit="contain"
                          />
                        )}
                        <Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
                          <Flex
                            w="36px"
                            h="36px"
                            borderRadius="full"
                            bg="blackAlpha.700"
                            border="2px solid"
                            borderColor="whiteAlpha.800"
                            align="center"
                            justify="center"
                          >
                            <Text color="white" fontSize="sm" ml="2px">▶</Text>
                          </Flex>
                        </Flex>
                      </Box>
                    )
                  }
                  if (photo) {
                    return (
                      <Box
                        w="100%"
                        pt="100%"
                        position="relative"
                        bg={emptyBg}
                        cursor="pointer"
                        onClick={() => item.username && navigate(`/${item.username}`)}
                      >
                        <Image src={photo} alt="" position="absolute" inset={0} w="100%" h="100%" objectFit="contain" />
                      </Box>
                    )
                  }
                  return (
                    <Box
                      bg={isDark ? flavor.dark : flavor.light}
                      borderColor={flavor.accent}
                      w="100%"
                      pt="100%"
                      position="relative"
                      overflow="hidden"
                      cursor="pointer"
                      onClick={() => item.username && navigate(`/${item.username}`)}
                    >
                      <Box position="absolute" top="-28px" right="-18px" w="84px" h="84px" borderRadius="full" bg={flavor.accent} opacity={0.22} />
                      <Box position="absolute" bottom="-24px" left="-16px" w="62px" h="62px" borderRadius="full" bg={flavor.accent} opacity={0.16} />
                      <Text position="absolute" top={1} left={3} color={flavor.accent} fontSize="4xl" lineHeight="1" fontWeight="extrabold" opacity={0.75}>
                        “
                      </Text>
                      <Text
                        position="absolute"
                        top={10}
                        left={3}
                        right={3}
                        bottom={3}
                        fontSize={shortQuote ? 'lg' : 'sm'}
                        fontWeight="bold"
                        lineHeight="1.35"
                        textAlign={shortQuote ? 'center' : 'left'}
                        noOfLines={shortQuote ? 3 : 5}
                      >
                        {snippet}
                      </Text>
                    </Box>
                  )
                })()}
                </Box>
                <Flex align="center" gap={2} px={1} pt={2}>
                  <Avatar
                    size="xs"
                    src={item.profilePic || undefined}
                    name={item.name || item.username}
                    cursor="pointer"
                    onClick={() => item.username && navigate(`/${item.username}`)}
                  />
                  <Text
                    flex={1}
                    minW={0}
                    fontSize="sm"
                    fontWeight="bold"
                    noOfLines={1}
                    cursor="pointer"
                    onClick={() => item.username && navigate(`/${item.username}`)}
                  >
                    {displayName}
                  </Text>
                  <Button
                    size="xs"
                    minW="auto"
                    px={{ base: 2, md: 3 }}
                    flexShrink={0}
                    borderRadius="full"
                    colorScheme="blue"
                    isLoading={followingId === String(item._id)}
                    onClick={() => follow(item)}
                  >
                    Follow
                  </Button>
                </Flex>
              </Box>
            )
          })}
        </SimpleGrid>
        <Box ref={sentinelRef} h="1px" />
        {loadingMore ? (
          <Flex justify="center" py={4}><Spinner size="sm" /></Flex>
        ) : hasMore ? (
          <Button variant="ghost" onClick={() => load('more')} mt={2}>Load more</Button>
        ) : null}
        </>
      )}
    </Box>
  )
}

export default ExplorePage
