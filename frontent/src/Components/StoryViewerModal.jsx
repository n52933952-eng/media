import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Box, Flex, Text, IconButton, Avatar, Spinner, Button } from '@chakra-ui/react'
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
  const [loading, setLoading] = useState(true)
  const [story, setStory] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [viewers, setViewers] = useState([])
  const [idx, setIdx] = useState(0)
  const timerRef = useRef(null)
  const videoRef = useRef(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

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
        showToast('Story', data.error || 'Could not open story', 'error')
        onClose()
        return
      }
      setStory(data.story)
      setIsOwner(!!data.isOwner)
      setViewers(Array.isArray(data.viewers) ? data.viewers : [])
    } catch {
      showToast('Story', 'Network error', 'error')
      onClose()
    } finally {
      setLoading(false)
    }
  }, [userId, onClose, showToast])

  useEffect(() => {
    if (isOpen && userId) fetchStory()
  }, [isOpen, userId, fetchStory])

  useEffect(() => {
    if (!isOpen) {
      clearTimer()
      setStory(null)
      setIdx(0)
      setLoading(false)
    }
  }, [isOpen])

  const slides = story?.slides || []
  const slide = slides[idx]
  const slideCount = slides.length

  const finishOrAdvance = useCallback(() => {
    clearTimer()
    setIdx((i) => {
      if (i >= slideCount - 1) {
        queueMicrotask(() => onClose())
        return i
      }
      return i + 1
    })
  }, [slideCount, onClose])

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
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') finishOrAdvance()
      if (e.key === 'ArrowLeft') {
        clearTimer()
        setIdx((i) => (i > 0 ? i - 1 : i))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose, finishOrAdvance])

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
      onClose()
    } catch {
      showToast('Error', 'Network error', 'error')
    }
  }

  if (!isOpen) return null

  const displayUser = story?.user || userPreview || {}
  const name = displayUser.name || displayUser.username || 'Story'

  const node = (
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

      {isOwner && viewers.length > 0 && (
        <Flex px={4} pb={4} flexWrap="wrap" gap={2} align="center" flexShrink={0}>
          <Text color="whiteAlpha.700" fontSize="xs">
            Seen by {viewers.length}
          </Text>
          {viewers.slice(0, 8).map((v) => {
            const u = v.user
            const id = uid(u?._id || u)
            return (
              <Avatar key={id} size="xs" src={u?.profilePic} name={u?.name || u?.username} />
            )
          })}
          {viewers.length > 8 && (
            <Text color="whiteAlpha.600" fontSize="xs">
              +{viewers.length - 8}
            </Text>
          )}
        </Flex>
      )}
    </Box>
  )

  return createPortal(node, document.body)
}
