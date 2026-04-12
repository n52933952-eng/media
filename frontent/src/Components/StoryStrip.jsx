import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, memo } from 'react'
import { keyframes } from '@emotion/react'
import { Box, Flex, Text, Avatar, Image, Spinner, useColorModeValue, useDisclosure } from '@chakra-ui/react'
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

/** Chakra Avatar shows `name` initials while `src` is loading — causes a flash. Only pass name when there is no photo URL. */
function avatarDisplayName(picUrl, fallbackName) {
  const ok = typeof picUrl === 'string' && picUrl.trim().length > 0
  return ok ? undefined : fallbackName
}

/** Strip avatars for *others*: always pass `name` so the loading fallback is initials, not Chakra’s default person icon. */
function stripOtherAvatarName(u) {
  const n = (u?.name || '').trim()
  const un = (u?.username || '').trim()
  return n || un || 'User'
}

/** Compact signature so silent refetches that return the same strip do not re-render (stops avatar “flutter”). */
function stripListSignature(entries) {
  return entries
    .map((e) => {
      const id = userIdOf(e)
      const pic = String(e.user?.profilePic || '').trim()
      return `${id}\t${pic}\t${e.hasUnviewed ? 1 : 0}\t${String(e.storyId || '')}`
    })
    .sort()
    .join('\n')
}

const STRIP_REFRESH_DEBOUNCE_MS = 380

function sameStripPreviewUser(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const idA = (a._id ?? a)?.toString?.() ?? String(a._id ?? '')
  const idB = (b._id ?? b)?.toString?.() ?? String(b._id ?? '')
  return idA === idB && String(a.profilePic || '').trim() === String(b.profilePic || '').trim()
}

/**
 * Story strip face for *other* users: initials stay put; photo fades in when loaded.
 * Avoids Chakra Avatar’s loading / fallback swapping (person ↔ initials ↔ photo).
 * `openRef` stays stable so `memo` can skip re-renders when only the parent re-renders.
 */
const StableOtherStripFace = memo(
  function StableOtherStripFace({ src, label, storyUserId, previewUser, openRef }) {
    const initial = useMemo(() => {
      const s = (label || '?').trim()
      return s ? s.charAt(0).toUpperCase() : '?'
    }, [label])
    const url = typeof src === 'string' && src.trim() ? src.trim() : ''
    const [imgShown, setImgShown] = useState(false)
    const underBg = useColorModeValue('gray.200', 'gray.600')
    const underFg = useColorModeValue('gray.700', 'white')

    useEffect(() => {
      setImgShown(false)
    }, [url])

    const fireOpen = useCallback(() => {
      openRef.current?.(storyUserId, previewUser)
    }, [openRef, storyUserId, previewUser])

    return (
      <Box
        role="button"
        tabIndex={0}
        aria-label={label ? `Open story ${label}` : 'Open story'}
        onClick={fireOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fireOpen()
          }
        }}
        boxSize="16"
        borderRadius="full"
        bg={underBg}
        position="relative"
        cursor="pointer"
        overflow="hidden"
        flexShrink={0}
      >
        <Flex align="center" justify="center" position="absolute" inset={0} zIndex={1}>
          <Text fontWeight="bold" color={underFg} fontSize="xl" userSelect="none" lineHeight={1}>
            {initial}
          </Text>
        </Flex>
        {url ? (
          <Image
            src={url}
            alt=""
            position="absolute"
            inset={0}
            w="100%"
            h="100%"
            objectFit="cover"
            zIndex={2}
            opacity={imgShown ? 1 : 0}
            transition="opacity 0.18s ease-out"
            onLoad={() => setImgShown(true)}
            onError={() => setImgShown(false)}
            loading="eager"
            draggable={false}
          />
        ) : null}
      </Box>
    )
  },
  (prev, next) =>
    prev.src === next.src &&
    prev.label === next.label &&
    prev.storyUserId === next.storyUserId &&
    prev.openRef === next.openRef &&
    sameStripPreviewUser(prev.previewUser, next.previewUser)
)

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
  /** Keeps last known `profilePic` per user so silent refetches don’t briefly clear `src` (person-icon flash). */
  const stripPicByUserRef = useRef(new Map())
  /** Skip `setStrip` when silent refetch returns the same visible strip (avoids pointless re-renders). */
  const lastStripSigRef = useRef('')
  const stripRefreshDebounceRef = useRef(null)

  /** `silent`: update data without swapping the row for a spinner (avoids shrink/jump when avatar refetches). */
  const fetchStrip = useCallback(async (opts) => {
    const silent = Boolean(opts?.silent)
    if (!user?._id) {
      setStrip([])
      setLoading(false)
      setInitialFetchDone(false)
      stripPicByUserRef.current.clear()
      lastStripSigRef.current = ''
      return
    }
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/feed-strip`, { credentials: 'include' })
      const data = await res.json()
      if (res.ok) {
        const list = Array.isArray(data.stories) ? data.stories : []
        const cache = stripPicByUserRef.current
        const merged = list.map((entry) => {
          const uid = userIdOf(entry)
          const u = entry.user
          if (!u || !uid) return entry
          const raw = u.profilePic
          if (typeof raw === 'string' && raw.trim()) {
            cache.set(uid, raw.trim())
            return entry
          }
          if (raw === '' || raw === null) {
            cache.delete(uid)
            return entry
          }
          const cached = cache.get(uid)
          if (cached) {
            return { ...entry, user: { ...u, profilePic: cached } }
          }
          return entry
        })
        const sig = stripListSignature(merged)
        if (silent && sig === lastStripSigRef.current) {
          // no-op: same strip as last silent load
        } else {
          lastStripSigRef.current = sig
          setStrip(merged)
        }
      } else {
        lastStripSigRef.current = ''
        setStrip([])
      }
    } catch {
      lastStripSigRef.current = ''
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
    const onRefresh = () => {
      if (stripRefreshDebounceRef.current) clearTimeout(stripRefreshDebounceRef.current)
      stripRefreshDebounceRef.current = setTimeout(() => {
        stripRefreshDebounceRef.current = null
        fetchStrip({ silent: true })
      }, STRIP_REFRESH_DEBOUNCE_MS)
    }
    window.addEventListener('storyStripChanged', onRefresh)
    return () => {
      window.removeEventListener('storyStripChanged', onRefresh)
      if (stripRefreshDebounceRef.current) clearTimeout(stripRefreshDebounceRef.current)
    }
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

  const openViewerRef = useRef(openViewer)
  useEffect(() => {
    openViewerRef.current = openViewer
  }, [openViewer])

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
                        name={avatarDisplayName(user.profilePic, user.name || user.username)}
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
                    <Avatar
                      size="lg"
                      src={user.profilePic}
                      name={avatarDisplayName(user.profilePic, user.name || user.username)}
                      cursor="pointer"
                      onClick={onAddOpen}
                    />
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
                    <StableOtherStripFace
                      src={u.profilePic}
                      label={stripOtherAvatarName(u)}
                      storyUserId={id}
                      previewUser={u}
                      openRef={openViewerRef}
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
