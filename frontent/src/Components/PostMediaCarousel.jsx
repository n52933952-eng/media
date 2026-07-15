import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Image, HStack, IconButton, Text, Avatar, useColorModeValue } from '@chakra-ui/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons'
import { mediaDisplayUrl } from '../utils/mediaUrl.js'

const SWIPE_THRESHOLD_PX = 48

/** Fixed frame — same box size for every slide (portrait, landscape, square). */
export const FEED_CAROUSEL_FRAME_H = '320px'
export const POST_DETAIL_CAROUSEL_FRAME_H = '400px'

const PostMediaCarousel = ({
  slides = [],
  audioUrl = null,
  frameHeight = FEED_CAROUSEL_FRAME_H,
}) => {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)
  const dragStartX = useRef(null)
  const containerRef = useRef(null)

  const arrowBg = useColorModeValue('blackAlpha.600', 'blackAlpha.700')
  const dotActive = useColorModeValue('blue.400', 'blue.300')
  const dotIdle = useColorModeValue('whiteAlpha.600', 'whiteAlpha.500')

  useEffect(() => {
    setIndex(0)
    setPlaying(false)
  }, [slides?.length, audioUrl])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return undefined
    const onEnded = () => setPlaying(false)
    el.addEventListener('ended', onEnded)
    return () => el.removeEventListener('ended', onEnded)
  }, [audioUrl])

  // Stop music when carousel leaves the viewport (scroll away) or tab hides
  useEffect(() => {
    if (!audioUrl) return undefined
    const root = containerRef.current
    if (!root) return undefined

    const pauseAudio = () => {
      const el = audioRef.current
      if (el && !el.paused) el.pause()
      setPlaying(false)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || entry.intersectionRatio < 0.25) {
          pauseAudio()
        }
      },
      { threshold: [0, 0.25, 0.5] },
    )
    observer.observe(root)

    const onVisibility = () => {
      if (document.hidden) pauseAudio()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      pauseAudio()
    }
  }, [audioUrl])

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + slides.length) % slides.length)
  }, [slides.length])

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % slides.length)
  }, [slides.length])

  useEffect(() => {
    const onKey = (e) => {
      if (slides.length <= 1) return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length, goPrev, goNext])

  if (!slides.length) return null

  const slide = slides[index] || slides[0]
  const src = mediaDisplayUrl(slide.img)
  const multi = slides.length > 1
  const distinctUsers = new Set(
    slides.map((x) => String(x.userId || '')).filter(Boolean),
  ).size
  // Owner-only carousel: no name badge (author is already in the post header)
  const showSlideAttribution = distinctUsers > 1

  const toggleAudio = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      setPlaying(false)
    } else {
      el.play().then(() => setPlaying(true)).catch(() => {})
    }
  }

  const onPointerDown = (e) => {
    dragStartX.current = e.clientX
  }

  const onPointerUp = (e) => {
    if (dragStartX.current == null || slides.length <= 1) return
    const delta = e.clientX - dragStartX.current
    dragStartX.current = null
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return
    if (delta < 0) goNext()
    else goPrev()
  }

  const onImageTap = (e) => {
    if (slides.length <= 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    if (ratio < 0.28) goPrev()
    else if (ratio > 0.72) goNext()
  }

  return (
    <Box position="relative" w="full" mb={2} ref={containerRef} tabIndex={0} outline="none">
      <Box
        position="relative"
        h={frameHeight}
        w="full"
        bg="black"
        borderRadius="md"
        overflow="hidden"
        display="flex"
        alignItems="center"
        justifyContent="center"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragStartX.current = null }}
        cursor="pointer"
        sx={{ cursor: 'pointer !important', '& img': { cursor: 'pointer !important' } }}
        userSelect="none"
      >
        <Image
          src={src}
          alt={slide.name || slide.username || 'Post slide'}
          maxH="100%"
          maxW="100%"
          w="auto"
          h="auto"
          objectFit="contain"
          onClick={onImageTap}
          draggable={false}
        />

        {showSlideAttribution && (slide.name || slide.username || slide.profilePic) ? (
          <HStack
            position="absolute"
            left={3}
            bottom={3}
            spacing={2}
            bg={arrowBg}
            px={2}
            py={1}
            borderRadius="md"
            maxW="70%"
          >
            {slide.profilePic ? (
              <Avatar src={slide.profilePic} name={slide.name || slide.username} size="xs" />
            ) : null}
            {(slide.name || slide.username) ? (
              <Text fontSize="sm" color="white" noOfLines={1}>
                {slide.name || slide.username}
              </Text>
            ) : null}
          </HStack>
        ) : null}

        {multi ? (
          <Text
            position="absolute"
            top={3}
            right={audioUrl ? '52px' : 3}
            fontSize="sm"
            fontWeight="bold"
            color="white"
            bg={arrowBg}
            px={2}
            py={1}
            borderRadius="md"
          >
            {index + 1} / {slides.length}
          </Text>
        ) : null}

        {audioUrl ? (
          <>
            <audio ref={audioRef} src={mediaDisplayUrl(audioUrl)} loop preload="metadata" />
            <IconButton
              aria-label={playing ? 'Pause music' : 'Play music'}
              position="absolute"
              top={3}
              right={3}
              size="sm"
              borderRadius="full"
              bg={arrowBg}
              color="white"
              _hover={{ bg: arrowBg }}
              onClick={(e) => {
                e.stopPropagation()
                toggleAudio()
              }}
              icon={<Text fontSize="lg">{playing ? '🔊' : '🔇'}</Text>}
            />
          </>
        ) : null}

        {multi ? (
          <>
            <IconButton
              aria-label="Previous slide"
              position="absolute"
              left={2}
              top="50%"
              transform="translateY(-50%)"
              size="sm"
              borderRadius="full"
              bg={arrowBg}
              color="white"
              _hover={{ bg: arrowBg, transform: 'translateY(-50%) scale(1.05)' }}
              onClick={(e) => {
                e.stopPropagation()
                goPrev()
              }}
              icon={<ChevronLeftIcon boxSize={5} />}
            />
            <IconButton
              aria-label="Next slide"
              position="absolute"
              right={2}
              top="50%"
              transform="translateY(-50%)"
              size="sm"
              borderRadius="full"
              bg={arrowBg}
              color="white"
              _hover={{ bg: arrowBg, transform: 'translateY(-50%) scale(1.05)' }}
              onClick={(e) => {
                e.stopPropagation()
                goNext()
              }}
              icon={<ChevronRightIcon boxSize={5} />}
            />
          </>
        ) : null}
      </Box>

      {multi ? (
        <HStack justify="center" mt={2} spacing={2} flexWrap="wrap">
          {slides.map((s, i) => {
            const thumbSrc = mediaDisplayUrl(s.img)
            // Collab with different people: avatar tabs. Same-user carousel: photo thumbs.
            const useAvatarTab = distinctUsers > 1 && !!s.profilePic
            return (
              <Box
                key={s.key}
                as="button"
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => setIndex(i)}
                p={0}
                border="none"
                bg="transparent"
                cursor="pointer"
                opacity={i === index ? 1 : 0.55}
                transform={i === index ? 'scale(1.08)' : 'scale(1)'}
                transition="all 0.15s ease"
              >
                {useAvatarTab ? (
                  <Avatar
                    src={s.profilePic}
                    name={s.name || s.username}
                    size="sm"
                    borderWidth="2px"
                    borderColor={i === index ? dotActive : 'transparent'}
                  />
                ) : thumbSrc ? (
                  <Box
                    w="36px"
                    h="36px"
                    borderRadius="full"
                    overflow="hidden"
                    borderWidth="2px"
                    borderColor={i === index ? dotActive : 'transparent'}
                  >
                    <Image
                      src={thumbSrc}
                      alt=""
                      w="100%"
                      h="100%"
                      objectFit="cover"
                      draggable={false}
                    />
                  </Box>
                ) : (
                  <Box
                    w={i === index ? '10px' : '8px'}
                    h={i === index ? '10px' : '8px'}
                    borderRadius="full"
                    bg={i === index ? dotActive : dotIdle}
                  />
                )}
              </Box>
            )
          })}
        </HStack>
      ) : null}
    </Box>
  )
}

export default PostMediaCarousel
