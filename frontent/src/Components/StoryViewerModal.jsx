import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { keyframes } from '@emotion/react'
import { formatDistanceToNow } from 'date-fns'
import {
  Box,
  Flex,
  Text,
  IconButton,
  Avatar,
  Spinner,
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  Divider,
  VStack,
  useColorModeValue,
  useDisclosure,
} from '@chakra-ui/react'
import { CloseIcon } from '@chakra-ui/icons'
import API_BASE_URL from '../config/api'
import useShowToast from '../hooks/useShowToast.js'

const loaderPulse = keyframes`
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
`

/** At least this long on screen for images (mobile-style; server often sends 5s). */
const MIN_IMAGE_MS = 8000
const MAX_SLIDE_MS = 90_000

function uid(x) {
  if (x == null) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object' && typeof x.toString === 'function') return String(x.toString())
  return String(x)
}

export default function StoryViewerModal({ isOpen, onClose, userId, userPreview }) {
  const showToast = useShowToast()
  const {
    isOpen: viewerListOpen,
    onOpen: onViewerListOpen,
    onClose: onViewerListClose,
  } = useDisclosure()
  const drawerBg = useColorModeValue('white', 'gray.900')
  const drawerBorder = useColorModeValue('gray.100', 'whiteAlpha.200')
  const drawerMuted = useColorModeValue('gray.600', 'whiteAlpha.600')
  const drawerText = useColorModeValue('gray.800', 'white')
  const drawerSub = useColorModeValue('gray.500', 'whiteAlpha.500')
  const onCloseRef = useRef(onClose)
  const showToastRef = useRef(showToast)
  const [loading, setLoading] = useState(true)
  const [story, setStory] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [viewers, setViewers] = useState([])
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const imageIntervalRef = useRef(null)
  const videoRef = useRef(null)
  const pausedRef = useRef(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const clearImageInterval = () => {
    if (imageIntervalRef.current) {
      clearInterval(imageIntervalRef.current)
      imageIntervalRef.current = null
    }
  }

  const fetchStory = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setStory(null)
    setIsOwner(false)
    setViewers([])
    setIdx(0)
    setPaused(false)
    setProgressPct(0)
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/user/${userId}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        showToastRef.current('Story', data.error || 'Could not open story', 'error')
        onCloseRef.current()
        return
      }
      setStory(data.story)
      setIsOwner(!!data.isOwner)
      setViewers(Array.isArray(data.viewers) ? data.viewers : [])
    } catch {
      showToastRef.current('Story', 'Network error', 'error')
      onCloseRef.current()
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (isOpen && userId) fetchStory()
  }, [isOpen, userId, fetchStory])

  useEffect(() => {
    if (!isOpen) {
      clearImageInterval()
      setStory(null)
      setIdx(0)
      setLoading(false)
      setPaused(false)
      setProgressPct(0)
      onViewerListClose()
    }
  }, [isOpen, onViewerListClose])

  const slides = story?.slides || []
  const slide = slides[idx]
  const slideCount = slides.length

  const finishOrAdvance = useCallback(() => {
    clearImageInterval()
    setPaused(false)
    setIdx((i) => {
      if (i >= slideCount - 1) {
        queueMicrotask(() => onCloseRef.current())
        return i
      }
      return i + 1
    })
  }, [slideCount])

  /** Image slide: timed advance + progress bar; pauses while `pausedRef` is true (hold center / Space). */
  useEffect(() => {
    clearImageInterval()
    setProgressPct(0)
    setPaused(false)
    if (!isOpen || loading || !slide || slide.type !== 'image') return

    const duration = Math.min(
      Math.max((typeof slide.durationSec === 'number' ? slide.durationSec : 5) * 1000, MIN_IMAGE_MS),
      MAX_SLIDE_MS
    )

    const startWall = Date.now()
    let pauseStartedAt = null
    let accumulatedPauseMs = 0

    imageIntervalRef.current = setInterval(() => {
      if (pausedRef.current) {
        if (pauseStartedAt == null) pauseStartedAt = Date.now()
        return
      }
      if (pauseStartedAt != null) {
        accumulatedPauseMs += Date.now() - pauseStartedAt
        pauseStartedAt = null
      }
      const elapsed = Date.now() - startWall - accumulatedPauseMs
      const p = Math.min(100, (elapsed / duration) * 100)
      setProgressPct(p)
      if (elapsed >= duration) {
        clearImageInterval()
        finishOrAdvance()
      }
    }, 32)

    return () => clearImageInterval()
  }, [isOpen, loading, slide, idx, finishOrAdvance])

  /** Video: progress from playback (ref may attach after paint). */
  useEffect(() => {
    if (!isOpen || loading || !slide || slide.type !== 'video') return
    setProgressPct(0)
    let vEl = null
    let onTime = null
    const t = window.setTimeout(() => {
      const v = videoRef.current
      if (!v) return
      vEl = v
      onTime = () => {
        const d = v.duration
        if (d && isFinite(d) && d > 0) {
          setProgressPct((v.currentTime / d) * 100)
        }
      }
      v.addEventListener('timeupdate', onTime)
    }, 0)
    return () => {
      window.clearTimeout(t)
      if (vEl && onTime) vEl.removeEventListener('timeupdate', onTime)
    }
  }, [isOpen, loading, slide?.url, idx])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (paused) v.pause()
    else v.play().catch(() => {})
  }, [paused, slide, idx])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
      if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      }
      if (e.key === 'ArrowRight') {
        clearImageInterval()
        finishOrAdvance()
      }
      if (e.key === 'ArrowLeft') {
        clearImageInterval()
        setProgressPct(0)
        setIdx((i) => (i > 0 ? i - 1 : i))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, finishOrAdvance])

  /** Release hold-to-pause if pointer leaves window. */
  useEffect(() => {
    if (!paused) return
    const up = () => setPaused(false)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [paused])

  const deleteEntireStory = async () => {
    if (!window.confirm('Delete your entire story?')) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/mine`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast('Error', data.error || 'Could not delete', 'error')
        return
      }
      showToast('Deleted', 'Story removed.', 'success')
      window.dispatchEvent(new CustomEvent('storyStripChanged'))
      onCloseRef.current()
    } catch {
      showToast('Error', 'Network error', 'error')
    }
  }

  /** One slide — matches mobile / `DELETE /api/story/mine/slide`. */
  const deleteCurrentSlide = async () => {
    if (!slide || !isOwner) return
    const n = slides.length
    if (n <= 1) {
      await deleteEntireStory()
      return
    }
    if (!window.confirm('Remove this slide from your story?')) return
    try {
      const qs = new URLSearchParams({
        index: String(idx),
        publicId: slide.publicId ? String(slide.publicId) : '',
        url: slide.url ? String(slide.url) : '',
      })
      const res = await fetch(`${API_BASE_URL}/api/story/mine/slide?${qs.toString()}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast('Error', data.error || 'Could not remove slide', 'error')
        return
      }
      if (data.deletedAll) {
        showToast('Deleted', 'Story removed.', 'success')
        window.dispatchEvent(new CustomEvent('storyStripChanged'))
        onCloseRef.current()
        return
      }
      if (data.story) {
        setStory(data.story)
        const len = data.story.slides?.length || 0
        setIdx((prev) => Math.min(prev, Math.max(0, len - 1)))
        setProgressPct(0)
        showToast('Removed', 'Slide deleted.', 'success')
        window.dispatchEvent(new CustomEvent('storyStripChanged'))
      }
    } catch {
      showToast('Error', 'Network error', 'error')
    }
  }

  const displayUser = isOpen ? story?.user || userPreview || {} : {}
  const name = displayUser.name || displayUser.username || 'Story'

  const onCenterPointerDown = (e) => {
    e.preventDefault()
    clearImageInterval()
    setPaused(true)
  }

  const onCenterPointerUp = (e) => {
    e.preventDefault()
    setPaused(false)
  }

  const storyPortal = isOpen ? (
    <Box
      position="fixed"
      inset={0}
      zIndex={2000}
      bg="black"
      display="flex"
      flexDirection="column"
      onClick={(e) => e.stopPropagation()}
    >
      <Flex align="center" justify="space-between" px={3} py={3} flexShrink={0}>
        <Flex align="center" gap={2} minW={0}>
          <Avatar size="sm" src={displayUser.profilePic} name={name} />
          <Text color="white" fontWeight="semibold" fontSize="sm" noOfLines={1}>
            {name}
          </Text>
        </Flex>
        <Flex align="center" gap={1} flexWrap="wrap" justify="flex-end">
          {isOwner && (
            <Button
              size="xs"
              variant="outline"
              borderColor="whiteAlpha.500"
              color="white"
              _hover={{ bg: 'whiteAlpha.200' }}
              onClick={onViewerListOpen}
            >
              Viewers{viewers.length > 0 ? ` (${viewers.length})` : ''}
            </Button>
          )}
          {isOwner && slide && (
            <Button
              size="xs"
              variant="outline"
              colorScheme="red"
              color="red.200"
              borderColor="red.400"
              onClick={deleteCurrentSlide}
            >
              {slideCount > 1 ? 'Remove slide' : 'Delete'}
            </Button>
          )}
          <IconButton
            aria-label="Close"
            icon={<CloseIcon />}
            size="sm"
            variant="ghost"
            color="white"
            _hover={{ bg: 'whiteAlpha.200' }}
            onClick={onClose}
          />
        </Flex>
      </Flex>

      {slideCount > 0 && (
        <Flex gap={1} px={2} pt={0} pb={2} flexShrink={0} align="stretch">
          {slides.map((_, i) => (
            <Box
              key={i}
              flex={1}
              h="3px"
              bg="whiteAlpha.300"
              borderRadius="full"
              overflow="hidden"
              position="relative"
            >
              <Box
                position="absolute"
                left={0}
                top={0}
                bottom={0}
                bg="white"
                borderRadius="full"
                width={i < idx ? '100%' : i === idx ? `${progressPct}%` : '0%'}
                transition={i === idx && slide?.type === 'image' ? 'none' : undefined}
              />
            </Box>
          ))}
        </Flex>
      )}

      <Box flex={1} position="relative" minH={0} display="flex" alignItems="center" justifyContent="center">
        {loading && (
          <Flex
            align="center"
            justify="center"
            direction="column"
            gap={3}
            animation={`${loaderPulse} 1.1s ease-in-out infinite`}
          >
            <Spinner color="white" size="xl" thickness="4px" speed="0.8s" />
            <Text color="whiteAlpha.700" fontSize="sm">
              Loading story…
            </Text>
          </Flex>
        )}

        {!loading && slide && (
          <>
            <Box
              position="absolute"
              left={0}
              top={0}
              bottom={0}
              w="28%"
              zIndex={2}
              cursor="w-resize"
              onClick={() => {
                clearImageInterval()
                setProgressPct(0)
                setPaused(false)
                setIdx((i) => (i > 0 ? i - 1 : i))
              }}
            />
            <Box
              position="absolute"
              right={0}
              top={0}
              bottom={0}
              w="28%"
              zIndex={2}
              cursor="e-resize"
              onClick={() => {
                clearImageInterval()
                setPaused(false)
                finishOrAdvance()
              }}
            />
            <Box
              position="absolute"
              left="28%"
              w="44%"
              top={0}
              bottom={0}
              zIndex={3}
              cursor="pointer"
              onPointerDown={onCenterPointerDown}
              onPointerUp={onCenterPointerUp}
              onPointerLeave={() => {
                /* keep paused until pointerup (global listener clears) */
              }}
            />

            {slide.type === 'video' ? (
              <video
                key={uid(slide.url) + String(idx)}
                ref={videoRef}
                src={slide.url}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                playsInline
                controls={false}
                muted
                autoPlay
                onLoadedMetadata={() => {
                  try {
                    videoRef.current?.play()
                  } catch {
                    /* autoplay */
                  }
                }}
                onEnded={() => {
                  clearImageInterval()
                  finishOrAdvance()
                }}
              />
            ) : (
              <Box
                as="img"
                src={slide.url}
                alt=""
                maxW="100%"
                maxH="100%"
                objectFit="contain"
                draggable={false}
              />
            )}

            {paused && (
              <Text
                position="absolute"
                top="50%"
                left="50%"
                transform="translate(-50%, -50%)"
                color="white"
                fontSize="sm"
                fontWeight="bold"
                bg="blackAlpha.700"
                px={4}
                py={2}
                borderRadius="md"
                pointerEvents="none"
                zIndex={4}
              >
                Paused · release to continue
              </Text>
            )}

            {!!slide.text && (
              <Text
                position="absolute"
                bottom={6}
                left={4}
                right={4}
                color="white"
                textAlign="center"
                fontSize="md"
                fontWeight="medium"
                textShadow="0 2px 8px rgba(0,0,0,0.8)"
                px={2}
                zIndex={2}
              >
                {slide.text}
              </Text>
            )}
          </>
        )}

        {!loading && !slide && (
          <Text color="whiteAlpha.700" fontSize="sm">
            No slides
          </Text>
        )}
      </Box>

      {!loading && slide && (
        <Text color="whiteAlpha.500" fontSize="10px" textAlign="center" pb={2} px={2}>
          Hold center (or Space) to pause · sides to skip
        </Text>
      )}
    </Box>
  ) : null

  return (
    <>
      {storyPortal && createPortal(storyPortal, document.body)}
      <Drawer
        isOpen={Boolean(isOpen && viewerListOpen && isOwner)}
        placement="bottom"
        onClose={onViewerListClose}
        size="md"
      >
        <DrawerOverlay bg="blackAlpha.700" />
        <DrawerContent bg={drawerBg} borderTopRadius="2xl" maxH="72vh">
          <DrawerCloseButton />
          <DrawerHeader borderBottomWidth="1px" borderColor={drawerBorder} color={drawerText}>
            Viewers{viewers.length > 0 ? ` (${viewers.length})` : ''}
          </DrawerHeader>
          <DrawerBody pb={8}>
            {isOwner && !viewers.length && (
              <Text color={drawerMuted} fontSize="sm">
                No views yet. When someone opens your story, they appear here with the time they watched.
              </Text>
            )}
            {isOwner && viewers.length > 0 && (
              <VStack align="stretch" spacing={0} divider={<Divider borderColor={drawerBorder} />}>
                {viewers.map((v) => {
                  const u = v.user
                  const id = uid(u?._id || u)
                  const when =
                    v.viewedAt != null
                      ? formatDistanceToNow(new Date(v.viewedAt), { addSuffix: true })
                      : ''
                  return (
                    <Flex key={id} py={3} align="center" gap={3}>
                      <Avatar src={u?.profilePic} name={u?.name || u?.username} size="sm" />
                      <Box flex={1} minW={0}>
                        <Text color={drawerText} fontWeight="medium" noOfLines={1}>
                          {u?.name || u?.username || 'User'}
                        </Text>
                        {!!when && (
                          <Text fontSize="xs" color={drawerSub}>
                            {when}
                          </Text>
                        )}
                      </Box>
                    </Flex>
                  )
                })}
              </VStack>
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  )
}
