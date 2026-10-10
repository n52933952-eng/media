import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Flex,
  Image,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'
import API_BASE_URL from '../config/api'
import { mediaDisplayUrl } from '../utils/mediaUrl'
import { uploadMediaToR2 } from '../utils/directR2Upload'
import useShowToast from '../hooks/useShowToast'

const KINDS = [
  { id: 'text', label: 'Text' },
  { id: 'question', label: 'Question' },
  { id: 'mark', label: 'Mark' },
  { id: 'photo', label: 'Photo' },
]

export function pinnableMedia(post) {
  if (!post || post.isCollaborative) return null
  if (Array.isArray(post.images) && post.images.length > 1) return null
  const img = String(post.img || '')
  if (!img) return null
  if (/youtube|youtu\.be|dailymotion|vimeo/i.test(img)) return null
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(img) || img.includes('/video/')) return 'video'
  if (/\.(jpe?g|png|gif|webp|heic|avif)(\?|$)/i.test(img) || img.includes('/image/')) return 'photo'
  return null
}

async function pinRequest(path, options) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed')
  return data
}

function PinCard({ pin, postId, onClose }) {
  const showToast = useShowToast()
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState([])
  const [mine, setMine] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (pin.pinType !== 'question') return
    let stop = false
    pinRequest(`/api/post/${postId}/pins/${pin._id}/answers`)
      .then((data) => {
        if (stop) return
        setAnswers(data.answers || [])
        setMine(data.mine || null)
        if (data.mine?.text) setText(data.mine.text)
      })
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [pin._id, pin.pinType, postId])

  const sendAnswer = async () => {
    const line = text.trim()
    if (!line || busy) return
    setBusy(true)
    try {
      const data = await pinRequest(`/api/post/${postId}/pins/${pin._id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ text: line }),
      })
      setMine(data.answer)
      setAnswers((prev) => {
        const id = String(data.answer?._id || '')
        return [data.answer, ...prev.filter((a) => String(a._id) !== id)]
      })
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      position="absolute"
      left="8px"
      right="8px"
      bottom="8px"
      bg="blackAlpha.800"
      color="white"
      borderRadius="12px"
      p={3}
      zIndex={5}
      onClick={(e) => e.stopPropagation()}
    >
      <Flex justify="space-between" align="center" mb={1}>
        <Text fontSize="xs" fontWeight="700">
          {pin.pinType === 'question' ? 'Question' : pin.pinType === 'photo' ? 'Photo' : pin.pinType === 'mark' ? 'Mark' : 'Text'}
        </Text>
        <Button size="xs" variant="ghost" color="white" onClick={onClose}>Close</Button>
      </Flex>
      {pin.text ? <Text fontSize="sm" mb={2}>{pin.text}</Text> : null}
      {pin.pinType === 'photo' && pin.imageUrl ? (
        <Image src={mediaDisplayUrl(pin.imageUrl)} maxH="160px" mx="auto" borderRadius="8px" />
      ) : null}
      {pin.pinType === 'question' ? (
        <Box>
          <Flex gap={2}>
            <Input
              size="sm"
              value={text}
              placeholder={mine ? 'Update your answer' : 'Your answer'}
              onChange={(e) => setText(e.target.value)}
              bg="whiteAlpha.200"
              border="none"
              color="white"
              maxLength={200}
            />
            <Button size="sm" onClick={sendAnswer} isDisabled={busy || !text.trim()}>Send</Button>
          </Flex>
          {answers.slice(0, 8).map((a) => (
            <Text key={a._id} fontSize="xs" mt={1} noOfLines={2}>
              {a.user?.name || a.user?.username || 'Someone'}: {a.text}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

export function PostPinsLayer({ post, now = 0, isOwner = false, onPins }) {
  const kind = pinnableMedia(post)
  const [open, setOpen] = useState(null)
  const [editor, setEditor] = useState(false)
  if (!kind) return null
  const pins = Array.isArray(post?.pins) ? post.pins : []
  const visible = kind === 'photo'
    ? pins
    : pins.filter((p) => {
        const t = Number(p.t) || 0
        return now + 0.25 >= t && now < t + 4
      })

  return (
    <>
      <Box position="absolute" inset={0} pointerEvents="none" zIndex={3}>
        {kind === 'photo'
          ? pins.map((p) => (
              <Box
                key={p._id}
                pointerEvents="auto"
                position="absolute"
                left={`${Math.min(96, Math.max(2, (Number(p.x) || 0) * 100))}%`}
                top={`${Math.min(96, Math.max(2, (Number(p.y) || 0) * 100))}%`}
                transform="translate(-50%, -50%)"
                w="18px"
                h="18px"
                borderRadius="full"
                bg={p.pinType === 'question' ? 'blue.400' : p.pinType === 'photo' ? 'white' : 'yellow.300'}
                border="2px solid white"
                cursor="pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setOpen(p)
                }}
              />
            ))
          : visible.map((p, i) => (
              <Button
                key={p._id}
                pointerEvents="auto"
                position="absolute"
                top={`${8 + i * 28}px`}
                left="8px"
                size="xs"
                borderRadius="full"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setOpen(p)
                }}
              >
                {p.pinType === 'photo' ? 'Photo' : p.pinType === 'mark' ? 'Look' : (p.text || 'Pin').slice(0, 42)}
              </Button>
            ))}
        {isOwner ? (
          <Button
            pointerEvents="auto"
            position="absolute"
            top="8px"
            right="8px"
            size="xs"
            borderRadius="full"
            variant="solid"
            bg="blackAlpha.700"
            color="white"
            _hover={{ bg: 'blackAlpha.800' }}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setEditor(true)
            }}
          >
            Pins
          </Button>
        ) : null}
        {open ? <PinCard pin={open} postId={post._id} onClose={() => setOpen(null)} /> : null}
      </Box>
      {editor ? (
        <PostPinEditor
          post={post}
          isOpen
          onClose={() => setEditor(false)}
          onPins={onPins}
        />
      ) : null}
    </>
  )
}

export function PostPinEditor({ post, isOpen, onClose, onPins }) {
  const showToast = useShowToast()
  const kind = pinnableMedia(post)
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const [pinType, setPinType] = useState('text')
  const [text, setText] = useState('')
  const [spot, setSpot] = useState({ x: 0.5, y: 0.5 })
  const [second, setSecond] = useState(0)
  const [photoUrl, setPhotoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const pins = Array.isArray(post?.pins) ? post.pins : []
  const src = mediaDisplayUrl(String(post?.img || ''))

  const apply = (next) => {
    if (Array.isArray(next)) onPins?.(next)
  }

  const add = async () => {
    if (busy || !kind) return
    setBusy(true)
    try {
      let imageUrl = photoUrl
      if (pinType === 'photo' && fileRef.current?.files?.[0]) {
        imageUrl = await uploadMediaToR2(fileRef.current.files[0], 'posts')
      }
      const t = kind === 'video' ? (videoRef.current?.currentTime || second || 0) : undefined
      const data = await pinRequest(`/api/post/${post._id}/pins`, {
        method: 'POST',
        body: JSON.stringify({
          pinType,
          text,
          t,
          x: spot.x,
          y: spot.y,
          imageUrl,
        }),
      })
      apply(data.pins)
      setText('')
      setPhotoUrl('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (pin) => {
    if (busy) return
    setBusy(true)
    try {
      const data = await pinRequest(`/api/post/${post._id}/pins/${pin._id}`, { method: 'DELETE' })
      apply(data.pins)
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!kind) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader fontSize="md">Add to this post</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={4}>
          <Text fontSize="sm" mb={2} color="gray.500">
            {kind === 'video' ? 'Play to a second, then add a pin.' : 'Tap the photo, then add a pin.'}
          </Text>
          {kind === 'video' ? (
            <Box
              as="video"
              ref={videoRef}
              src={src}
              controls
              playsInline
              w="100%"
              maxH="240px"
              bg="black"
              borderRadius="8px"
              mb={3}
              onTimeUpdate={(e) => setSecond(e.target.currentTime || 0)}
            />
          ) : (
            <Box
              position="relative"
              mb={3}
              bg="black"
              borderRadius="8px"
              overflow="hidden"
              cursor="crosshair"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                if (!r.width || !r.height) return
                setSpot({
                  x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                  y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
                })
              }}
            >
              <Image src={src} w="100%" maxH="240px" objectFit="contain" pointerEvents="none" />
              <Box
                position="absolute"
                left={`${spot.x * 100}%`}
                top={`${spot.y * 100}%`}
                w="14px"
                h="14px"
                borderRadius="full"
                bg="yellow.300"
                border="2px solid white"
                transform="translate(-50%, -50%)"
              />
            </Box>
          )}
          <Text fontSize="xs" mb={2}>{kind === 'video' ? `At ${Math.floor(second)}s` : 'Place set'}</Text>
          <Flex gap={2} mb={2} wrap="wrap">
            {KINDS.map((k) => (
              <Button
                key={k.id}
                size="xs"
                borderRadius="full"
                variant={pinType === k.id ? 'solid' : 'outline'}
                onClick={() => setPinType(k.id)}
              >
                {k.label}
              </Button>
            ))}
          </Flex>
          {pinType !== 'photo' ? (
            <Input
              size="sm"
              mb={2}
              maxLength={120}
              placeholder={pinType === 'question' ? 'Ask something' : pinType === 'mark' ? 'Optional note' : 'Say something'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          ) : (
            <Input ref={fileRef} type="file" accept="image/*" size="sm" mb={2} p={1} />
          )}
          <Button size="sm" onClick={add} isDisabled={busy} mb={3}>Add pin</Button>
          {pins.map((p) => (
            <Flex key={p._id} align="center" gap={2} py={1}>
              <Text fontSize="sm" flex="1" noOfLines={1}>
                {kind === 'video' ? `${Math.floor(Number(p.t) || 0)}s` : 'On photo'} · {p.pinType} {p.text || ''}
              </Text>
              <Button size="xs" variant="ghost" onClick={() => remove(p)}>✕</Button>
            </Flex>
          ))}
          <Button mt={2} size="sm" variant="ghost" onClick={onClose}>Done</Button>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
