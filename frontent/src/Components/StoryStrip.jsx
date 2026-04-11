import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { keyframes } from '@emotion/react'
import { Box, Flex, Text, Avatar, Spinner, useColorModeValue, useDisclosure } from '@chakra-ui/react'
import { AddIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import API_BASE_URL from '../config/api'
import AddStoryModal from './AddStoryModal'
import StoryViewerModal from './StoryViewerModal'

/** Unread ring pulse — matches “live / new” feel on mobile without changing layout. */
const storyRingGlowLight = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 120, 0.5); }
  55% { box-shadow: 0 0 0 10px rgba(220, 38, 120, 0); }
  100% { box-shadow: 0 0 0 0 rgba(220, 38, 120, 0); }
`
const storyRingGlowDark = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(79, 172, 254, 0.55); }
  55% { box-shadow: 0 0 0 10px rgba(79, 172, 254, 0); }
  100% { box-shadow: 0 0 0 0 rgba(79, 172, 254, 0); }
`

function userIdOf(entry) {
  const u = entry?.user
  if (!u) return ''
  return (u._id ?? u)?.toString?.() ?? String(u)
}

export default function StoryStrip() {
  const { user } = useContext(UserContext) || {}
  const [strip, setStrip] = useState([])
  const [loading, setLoading] = useState(true)
  const { isOpen: addOpen, onOpen: onAddOpen, onClose: onAddClose } = useDisclosure()
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerUserId, setViewerUserId] = useState(null)
  const [viewerPreview, setViewerPreview] = useState(null)

  const ringUnseen = useColorModeValue(
    'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
    'linear-gradient(45deg, #4facfe, #00f2fe, #43e97b, #38f9d7)'
  )
  /** Solid ring when watched — stronger than before so “seen” is obvious (same logic as mobile: !hasUnviewed). */
  const ringSeen = useColorModeValue('gray.400', 'gray.600')
  const unseenRingAnim = useColorModeValue(
    `${storyRingGlowLight} 2.2s ease-in-out infinite`,
    `${storyRingGlowDark} 2.2s ease-in-out infinite`
  )
  const labelColor = useColorModeValue('gray.600', 'gray.400')
  const seenLabelColor = useColorModeValue('gray.500', 'gray.500')
  const newLabelColor = useColorModeValue('pink.500', 'cyan.300')
  const bgCard = useColorModeValue('gray.50', 'whiteAlpha.50')
  const stripBorder = useColorModeValue('gray.100', 'whiteAlpha.100')
  const addBadgeBorder = useColorModeValue('white', 'gray.900')
  /** After first load, keep the strip mounted so silent refetches don’t collapse the row (ref alone wouldn’t re-render). */
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  /** `silent`: update data without swapping the row for a spinner (avoids shrink/jump when avatar refetches). */
  const fetchStrip = useCallback(async (opts) => {
    const silent = Boolean(opts?.silent)
    if (!user?._id) {
      setStrip([])
      setLoading(false)
      setInitialFetchDone(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/feed-strip`, { credentials: 'include' })
      const data = await res.json()
      if (res.ok) setStrip(Array.isArray(data.stories) ? data.stories : [])
      else setStrip([])
    } catch {
      setStrip([])
    } finally {
      if (!silent) setLoading(false)
      setInitialFetchDone(true)
    }
  }, [user?._id])

  useEffect(() => {
    fetchStrip()
  }, [fetchStrip])

  useEffect(() => {
    const onRefresh = () => fetchStrip({ silent: true })
    window.addEventListener('storyStripChanged', onRefresh)
    return () => window.removeEventListener('storyStripChanged', onRefresh)
  }, [fetchStrip])

  const myId = user?._id?.toString?.() ?? String(user?._id ?? '')
  const myEntry = useMemo(
    () => strip.find((s) => userIdOf(s) === myId),
    [strip, myId]
  )

  const others = useMemo(() => {
    return strip
      .filter((s) => userIdOf(s) !== myId)
      .sort((a, b) => {
        if (a.hasUnviewed === b.hasUnviewed) return 0
        return a.hasUnviewed ? -1 : 1
      })
  }, [strip, myId])

  const openViewer = useCallback((uid, previewUser) => {
    if (!uid) return
    setViewerUserId(uid)
    setViewerPreview(previewUser || null)
    setViewerOpen(true)
  }, [])

  /** Must be stable: StoryViewerModal’s fetch effect depends on onClose; unstable fn caused infinite refetch + loading loop. */
  const closeViewer = useCallback(() => {
    setViewerOpen(false)
    setViewerUserId(null)
    setViewerPreview(null)
    fetchStrip({ silent: true })
  }, [fetchStrip])

  if (!user?._id) return null

  const AvatarRing = ({ unseen, children, ...boxProps }) => (
    <Box
      p="3px"
      borderRadius="full"
      bg={unseen ? ringUnseen : ringSeen}
      animation={unseen ? unseenRingAnim : undefined}
      {...boxProps}
    >
      <Box
        borderRadius="full"
        overflow="hidden"
        lineHeight={0}
        sx={{
          filter: unseen ? 'none' : 'grayscale(0.4) brightness(0.9)',
        }}
      >
        {children}
      </Box>
    </Box>
  )

  return (
    <>
      <Box
        mb={4}
        py={3}
        px={2}
        borderRadius="lg"
        bg={bgCard}
        borderWidth="1px"
        borderColor={stripBorder}
        minH="128px"
        position="relative"
      >
        <Flex
          align="flex-start"
          gap={4}
          overflowX="auto"
          pb={1}
          minH="104px"
          sx={{ scrollbarGutter: 'stable' }}
        >
          {loading && !initialFetchDone && (
            <Flex align="center" justify="center" minW="100%" minH="88px">
              <Spinner size="sm" thickness="3px" speed="0.65s" color="gray.400" />
            </Flex>
          )}

          {initialFetchDone && (
            <Flex direction="column" align="center" gap={1} flexShrink={0} w="72px">
              <Box position="relative">
                {myEntry ? (
                  <Box position="relative">
                    <AvatarRing unseen={!!myEntry.hasUnviewed}>
                      <Avatar
                        size="lg"
                        src={user.profilePic}
                        name={user.name || user.username}
                        cursor="pointer"
                        onClick={() => openViewer(myId, user)}
                      />
                    </AvatarRing>
                    <Flex
                      position="absolute"
                      bottom={0}
                      right={0}
                      w={6}
                      h={6}
                      borderRadius="full"
                      bg="blue.500"
                      align="center"
                      justify="center"
                      borderWidth="2px"
                      borderColor={addBadgeBorder}
                      cursor="pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddOpen()
                      }}
                    >
                      <AddIcon color="white" boxSize={2.5} />
                    </Flex>
                  </Box>
                ) : (
                  <Box position="relative">
                    <Avatar size="lg" src={user.profilePic} name={user.name || user.username} cursor="pointer" onClick={onAddOpen} />
                    <Flex
                      position="absolute"
                      bottom={0}
                      right={0}
                      w={6}
                      h={6}
                      borderRadius="full"
                      bg="blue.500"
                      align="center"
                      justify="center"
                      borderWidth="2px"
                      borderColor={addBadgeBorder}
                      cursor="pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddOpen()
                      }}
                    >
                      <AddIcon color="white" boxSize={2.5} />
                    </Flex>
                  </Box>
                )}
              </Box>
              <Text fontSize="xs" color={labelColor} textAlign="center" noOfLines={2} w="100%">
                Your story
              </Text>
              {myEntry && (
                <Text fontSize="10px" color={myEntry.hasUnviewed ? newLabelColor : seenLabelColor} textAlign="center" fontWeight="semibold">
                  {myEntry.hasUnviewed ? 'New' : 'Viewed'}
                </Text>
              )}
            </Flex>
          )}

          {initialFetchDone &&
            others.map((s) => {
              const u = s.user || {}
              const id = userIdOf(s)
              return (
                <Flex key={id || s.storyId} direction="column" align="center" gap={1} flexShrink={0} w="72px">
                  <AvatarRing unseen={!!s.hasUnviewed}>
                    <Avatar
                      size="lg"
                      src={u.profilePic}
                      name={u.name || u.username}
                      cursor="pointer"
                      onClick={() => openViewer(id, u)}
                    />
                  </AvatarRing>
                  <Text fontSize="xs" color={labelColor} textAlign="center" noOfLines={2} w="100%">
                    {u.username || u.name || 'User'}
                  </Text>
                  <Text fontSize="10px" color={s.hasUnviewed ? newLabelColor : seenLabelColor} textAlign="center" fontWeight="semibold">
                    {s.hasUnviewed ? 'New' : 'Seen'}
                  </Text>
                </Flex>
              )
            })}
        </Flex>
        {loading && initialFetchDone && (
          <Box position="absolute" top={2} right={2} pointerEvents="none">
            <Spinner size="xs" thickness="2px" speed="0.65s" color="gray.500" />
          </Box>
        )}
      </Box>

      <AddStoryModal isOpen={addOpen} onClose={onAddClose} onPosted={() => fetchStrip({ silent: true })} />
      <StoryViewerModal
        isOpen={viewerOpen}
        onClose={closeViewer}
        userId={viewerUserId}
        userPreview={viewerPreview}
      />
    </>
  )
}
