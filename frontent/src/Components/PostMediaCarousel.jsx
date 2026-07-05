import React, { useEffect, useRef, useState } from 'react'
import { Box, Image, HStack, IconButton, Text } from '@chakra-ui/react'
import { mediaDisplayUrl } from '../utils/mediaUrl.js'

const PostMediaCarousel = ({ slides = [], audioUrl = null, maxH = '480px' }) => {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)

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

  if (!slides.length) return null

  const slide = slides[index] || slides[0]
  const src = mediaDisplayUrl(slide.img)

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

  return (
    <Box position="relative" w="full" mb={3}>
      <Image src={src} alt="" w="full" maxH={maxH} objectFit="contain" bg="black" borderRadius="md" />
      {slide.name || slide.username ? (
        <Text
          position="absolute"
          left={3}
          top={3}
          fontSize="sm"
          color="white"
          bg="blackAlpha.700"
          px={2}
          py={1}
          borderRadius="md"
          maxW="55%"
          noOfLines={1}
        >
          {slide.name || slide.username}
        </Text>
      ) : null}
      {slides.length > 1 ? (
        <Text
          position="absolute"
          top={3}
          right={audioUrl ? '52px' : 3}
          fontSize="sm"
          fontWeight="bold"
          color="white"
          bg="blackAlpha.700"
          px={2}
          py={1}
          borderRadius="md"
        >
          {index + 1}/{slides.length}
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
            onClick={toggleAudio}
            icon={<Text fontSize="lg">{playing ? '🔊' : '🔇'}</Text>}
          />
        </>
      ) : null}
      {slides.length > 1 ? (
        <>
          <IconButton
            aria-label="Previous"
            position="absolute"
            left={2}
            top="50%"
            transform="translateY(-50%)"
            size="sm"
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            icon={<Text>{'‹'}</Text>}
          />
          <IconButton
            aria-label="Next"
            position="absolute"
            right={2}
            top="50%"
            transform="translateY(-50%)"
            size="sm"
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            icon={<Text>{'›'}</Text>}
          />
          <HStack justify="center" mt={2} spacing={1.5}>
            {slides.map((s, i) => (
              <Box
                key={s.key}
                w={i === index ? '8px' : '6px'}
                h={i === index ? '8px' : '6px'}
                borderRadius="full"
                bg={i === index ? 'blue.400' : 'whiteAlpha.500'}
              />
            ))}
          </HStack>
        </>
      ) : null}
    </Box>
  )
}

export default PostMediaCarousel
