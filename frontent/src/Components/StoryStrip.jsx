import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react'
import { keyframes } from '@emotion/react'
import { Box, Flex, Text, Image, Spinner, useColorModeValue, useDisclosure } from '@chakra-ui/react'
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

/** Same photo, different cache-busting query → same identity (avoids resetting the in-ring image). */
function profilePicIdentity(raw) {
  if (raw == null || typeof raw !== 'string') return ''
  const t = raw.trim()
  if (!t) return ''
  try {
    const u = new URL(t, 'https://example.invalid')
    u.search = ''
    u.hash = ''
    return u.href
  } catch {
    const noQ = t.split('?')[0]
    return noQ.split('#')[0]
  }
}

/** Strip avatars for *others*: label for initials fallback. */
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
      const pic = profilePicIdentity(e.user?.profilePic)
      return `${id}\t${pic}\t${e.hasUnviewed ? 1 : 0}\t${String(e.storyId || '')}`
    })
    .sort()
    .join('\n')
}

const STRIP_REFRESH_DEBOUNCE_MS = 520

/** In-ring avatar: initials under photo; photo fades in. Cached images often skip `onLoad` — detect `img.complete` too. */
function StripAvatarFace({ src, label, onClick, ariaLabel }) {
  const initial = useMemo(() => {
    const s = (label || '?').trim()
    return s ? s.charAt(0).toUpperCase() : '?'
  }, [label])
  const url = typeof src === 'string' && src.trim() ? src.trim() : ''
  const picId = useMemo(() => profilePicIdentity(url), [url])
  const [imgShown, setImgShown] = useState(false)
  const imgRef = useRef(null)
  const underBg = useColorModeValue('gray.200', 'gray.600')
  const underFg = useColorModeValue('gray.700', 'white')

  useLayoutEffect(() => {
    setImgShown(false)
    const el = imgRef.current
    if (!el || !url) return
    const showIfDecoded = () => {
      if (el.complete && el.naturalWidth > 0) setImgShown(true)
    }
    showIfDecoded()
    const t = window.setTimeout(showIfDecoded, 0)
    return () => window.clearTimeout(t)
  }, [url, picId])

  const labelText = ariaLabel || (label ? `Open story ${label}` : 'Open story')

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={labelText}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
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
          key={url}
          ref={imgRef}
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
          decoding="async"
        />
      ) : null}
    </Box>
  )
}

/** Other users — no `memo` here so `previewUser` in the click handler stays current (memo was causing stale previews). */
function OtherStripFace({ src, label, storyUserId, previewUser, openRef }) {
  const fireOpen = useCallback(() => {
    openRef.current?.(storyUserId, previewUser)
  }, [openRef, storyUserId, previewUser])

  return (
    <StripAvatarFace
      src={src}
      label={label}
      onClick={fireOpen}
      ariaLabel={label ? `Open story ${label}` : 'Open story'}
    />
  )
}

function StoryStrip() {
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
  /** Drop out-of-order responses so rapid refetches don’t flip strip state back and forth (avatar “strobing”). */
  const stripFetchGenRef = useRef(0)

  /** `silent`: update data without swapping the row for a spinner (avoids shrink/jump when avatar refetches). */
  const fetchStrip = useCallback(async (opts) => {
    const silent = Boolean(opts?.silent)
    if (!user?._id) {
      stripFetchGenRef.current += 1
      setStrip([])
      setLoading(false)
      setInitialFetchDone(false)
      stripPicByUserRef.current.clear()
      lastStripSigRef.current = ''
      return
    }
    const gen = ++stripFetchGenRef.current
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/feed-strip`, { credentials: 'include' })
      const data = await res.json()
      if (gen !== stripFetchGenRef.current) return

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
      if (gen !== stripFetchGenRef.current) return
      lastStripSigRef.current = ''
      setStrip([])
    } finally {
      if (gen === stripFetchGenRef.current) {
        if (!silent) setLoading(false)
        setInitialFetchDone(true)
      }
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
    const tie = (s) => {
      const u = s.user || {}
      return String(u.username || u.name || userIdOf(s) || '').toLowerCase()
    }
    return strip
      .filter((s) => userIdOf(s) !== myId)
      .sort((a, b) => {
        if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1
        return tie(a).localeCompare(tie(b))
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

  const selfFaceLabel = (user?.name || user?.username || 'You').trim() || 'You'

  /** One handler for the self avatar — avoids new inline fns every parent render (feed scroll). */
  const handleSelfStripClick = useCallback(() => {
    if (myEntry) openViewer(myId, user)
    else onAddOpen()
  }, [myEntry, myId, user, openViewer, onAddOpen])

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
                  <Box position="relative" zIndex={0}>
                    <Box position="relative" zIndex={1}>
                      <AvatarRing unseen={!!myEntry.hasUnviewed}>
                        <StripAvatarFace
                          src={user.profilePic}
                          label={selfFaceLabel}
                          onClick={handleSelfStripClick}
                          ariaLabel="Your story"
                        />
                      </AvatarRing>
                    </Box>
                    <Flex
                      position="absolute"
                      bottom={0}
                      right={0}
                      zIndex={3}
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
                  <Box position="relative" zIndex={0}>
                    <Box position="relative" zIndex={1}>
                      <StripAvatarFace
                        src={user.profilePic}
                        label={selfFaceLabel}
                        onClick={handleSelfStripClick}
                        ariaLabel="Add to your story"
                      />
                    </Box>
                    <Flex
                      position="absolute"
                      bottom={0}
                      right={0}
                      zIndex={3}
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
                <Flex key={id ? `story-${id}` : `story-row-${String(s.storyId)}`} direction="column" align="center" gap={1} flexShrink={0} w="72px">
                  <AvatarRing unseen={!!s.hasUnviewed}>
                    <OtherStripFace
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

/** Home feed re-renders often (infinite scroll). Story strip has no props — skip those parent updates. */
export default memo(StoryStrip)
