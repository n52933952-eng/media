import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  const timerRef = useRef(null)
  const videoRef = useRef(null)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  /** Depends only on userId so parent re-renders (e.g. story strip refetch) do not retrigger fetch. */
  const fetchStory = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setStory(null)
    setIsOwner(false)
    setViewers([])
    setIdx(0)
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
      clearTimer()
      setStory(null)
      setIdx(0)
      setLoading(false)
      onViewerListClose()
    }
  }, [isOpen, onViewerListClose])

  const slides = story?.slides || []
  const slide = slides[idx]
  const slideCount = slides.length

  const finishOrAdvance = useCallback(() => {
    clearTimer()
    setIdx((i) => {
      if (i >= slideCount - 1) {
        queueMicrotask(() => onCloseRef.current())
        return i
      }
      return i + 1
    })
  }, [slideCount])

  useEffect(() => {
    if (!isOpen || !slide || slide.type === 'video') return
    const sec = typeof slide.durationSec === 'number' ? slide.durationSec : 5
    const ms = Math.min(Math.max(sec * 1000, 800), 60_000)
    clearTimer()
    timerRef.current = window.setTimeout(finishOrAdvance, ms)
    return () => clearTimer()
  }, [isOpen, slide, idx, finishOrAdvance])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
      if (e.key === 'ArrowRight') finishOrAdvance()
      if (e.key === 'ArrowLeft') {
        clearTimer()
        setIdx((i) => (i > 0 ? i - 1 : i))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, finishOrAdvance])

  const deleteMine = async () => {
    if (!window.confirm('Delete your entire story? This cannot be undone.')) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/mine`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast('Error', data.error || 'Could not delete', 'error')
        return
      }
      showToast('Deleted', 'Your story was removed.', 'success')
      window.dispatchEvent(new CustomEvent('storyStripChanged'))
      onCloseRef.current()
    } catch {
      showToast('Error', 'Network error', 'error')
    }
  }

  const displayUser = isOpen ? story?.user || userPreview || {} : {}
  const name = displayUser.name || displayUser.username || 'Story'

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
        <Flex align="center" gap={1}>
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
          {isOwner && (
            <Button size="xs" variant="outline" colorScheme="red" color="red.200" borderColor="red.400" onClick={deleteMine}>
              Delete
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
        <Flex gap={1} px={2} pt={0} pb={2} flexShrink={0}>
          {slides.map((_, i) => (
            <Box
              key={i}
              flex={1}
              h="2px"
              bg={i < idx ? 'white' : i === idx ? 'whiteAlpha.900' : 'whiteAlpha.300'}
              borderRadius="full"
            />
          ))}
        </Flex>
      )}

      <Box flex={1} position="relative" minH={0} display="flex" alignItems="center" justifyContent="center">
        {loading && (
          <Spinner color="white" size="xl" thickness="4px" />
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
                clearTimer()
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
              onClick={finishOrAdvance}
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
                    /* autoplay policy */
                  }
                }}
                onEnded={finishOrAdvance}
              />
            ) : (
              <Box
                as="img"
                src={slide.url}
                alt=""
                maxW="100%"
                maxH="100%"
                objectFit="contain"
              />
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
