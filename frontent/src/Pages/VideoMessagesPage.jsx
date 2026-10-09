import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  useColorModeValue,
  useDisclosure,
  VStack,
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'
import { uploadMediaToR2 } from '../utils/directR2Upload'
import { mediaDisplayUrl } from '../utils/mediaUrl.js'
import { captureVideoThumb, fmtTime, otherParty, prepareLightVideo, uidOf } from '../utils/videoMessage.js'
import VideoRecordModal from '../Components/VideoRecordModal.jsx'

const PAGE = 15

function isUnseen(item, meId) {
  const me = String(meId)
  if (uidOf(item.receiver) === me && !item.seenAt) return true
  if (uidOf(item.sender) === me && item.senderHasNewNotes) return true
  return false
}

async function videoDurationOf(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      const d = v.duration
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    v.src = url
  })
}

const VideoMessagesPage = () => {
  const { user } = useContext(UserContext)
  const { socket, videoMessageUnseenCount, setVideoMessageUnseenCount } = useContext(SocketContext) || {}
  const showToast = useShowToast()
  const navigate = useNavigate()
  const bg = useColorModeValue('gray.50', '#101010')
  const card = useColorModeValue('white', '#1a1a1a')
  const border = useColorModeValue('#e1e4ea', '#2d3548')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const hoverBg = useColorModeValue('gray.100', '#222')

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const cursorRef = useRef(null)
  const fetchingRef = useRef(false)

  const sendModal = useDisclosure()
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState([])
  const [searching, setSearching] = useState(false)
  const [pickedUser, setPickedUser] = useState(null)
  const [pickedFile, setPickedFile] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendHint, setSendHint] = useState('')
  const [recordOpen, setRecordOpen] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(async (more = false) => {
    if (fetchingRef.current) return
    if (more && !cursorRef.current) return
    fetchingRef.current = true
    if (more) setLoadingMore(true)
    try {
      let url = `${API_BASE_URL}/api/video-message?limit=${PAGE}`
      if (more && cursorRef.current) url += `&cursor=${encodeURIComponent(cursorRef.current)}`
      const res = await fetch(url, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      const page = Array.isArray(data.items) ? data.items : []
      cursorRef.current = data.nextCursor || null
      setHasMore(!!data.hasMore)
      setItems((prev) => {
        if (!more) return page
        const seen = new Set(prev.map((x) => String(x._id)))
        const out = [...prev]
        for (const row of page) {
          if (row?._id && !seen.has(String(row._id))) {
            seen.add(String(row._id))
            out.push(row)
          }
        }
        return out
      })
    } catch (e) {
      showToast('Error', e.message || 'Failed to load', 'error')
    } finally {
      fetchingRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [showToast])

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    if (!socket) return
    const onNew = (row) => {
      if (!row?._id) return
      setItems((prev) => {
        if (prev.some((x) => String(x._id) === String(row._id))) return prev
        return [row, ...prev]
      })
    }
    const onNote = (payload) => {
      const id = String(payload?.videoMessageId || '')
      if (!id) return
      setItems((prev) =>
        prev.map((x) =>
          String(x._id) === id
            ? { ...x, noteCount: (x.noteCount || 0) + 1, senderHasNewNotes: uidOf(x.sender) === String(user?._id) }
            : x,
        ),
      )
    }
    const onDeleted = (payload) => {
      const id = String(payload?._id || '')
      if (!id) return
      setItems((prev) => prev.filter((x) => String(x._id) !== id))
    }
    const onSeen = (payload) => {
      const id = String(payload?._id || '')
      if (!id) return
      setItems((prev) =>
        prev.map((x) => (String(x._id) === id ? { ...x, seenAt: payload.seenAt || new Date().toISOString() } : x)),
      )
    }
    socket.on('videoMessage:new', onNew)
    socket.on('videoMessage:note', onNote)
    socket.on('videoMessage:deleted', onDeleted)
    socket.on('videoMessage:seen', onSeen)
    return () => {
      socket.off('videoMessage:new', onNew)
      socket.off('videoMessage:note', onNote)
      socket.off('videoMessage:deleted', onDeleted)
      socket.off('videoMessage:seen', onSeen)
    }
  }, [socket, setVideoMessageUnseenCount, user?._id])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setPeople([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/user/following?q=${encodeURIComponent(q)}&limit=12`,
          { credentials: 'include' },
        )
        const data = await res.json()
        const list = Array.isArray(data) ? data : data?.users || []
        setPeople(list.filter((u) => String(u?._id) !== String(user?._id)).slice(0, 12))
      } catch {
        setPeople([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, user?._id])

  const handleSend = async () => {
    if (!pickedUser?._id || !pickedFile || sending) return
    setSending(true)
    try {
      const duration = await videoDurationOf(pickedFile)
      if (duration > 600) {
        showToast('Error', 'Video must be 10 minutes or less', 'error')
        return
      }
      setSendHint('Making video light…')
      const light = await prepareLightVideo(pickedFile, 'main')
      setSendHint('Uploading…')
      const thumbFile = await captureVideoThumb(light)
      const [videoUrl, thumbnailUrl] = await Promise.all([
        uploadMediaToR2(light, 'video-messages', { skipCompress: true }),
        thumbFile ? uploadMediaToR2(thumbFile, 'video-messages') : Promise.resolve(''),
      ])
      const res = await fetch(`${API_BASE_URL}/api/video-message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverId: pickedUser._id,
          videoUrl,
          thumbnailUrl: thumbnailUrl || undefined,
          duration: Math.round(duration),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setItems((prev) => [data, ...prev.filter((x) => String(x._id) !== String(data._id))])
      sendModal.onClose()
      setQuery('')
      setPeople([])
      setPickedUser(null)
      setPickedFile(null)
      showToast('Sent', 'Video message sent', 'success')
    } catch (e) {
      showToast('Error', e.message || 'Failed to send', 'error')
    } finally {
      setSending(false)
      setSendHint('')
    }
  }

  return (
    <Box bg={bg} minH="calc(100vh - 72px)" px={{ base: 2, md: 0 }} py={4} maxW="620px" mx="auto" w="100%">
      <Flex justify="space-between" align="center" mb={4}>
        <Heading size="md">Video Messages</Heading>
        <Button size="sm" colorScheme="blue" onClick={sendModal.onOpen}>
          + Send video
        </Button>
      </Flex>
      <Text fontSize="sm" color={muted} mb={4}>
        Private 1-to-1. Reply inside any second of the video.
      </Text>

      {loading ? (
        <Flex justify="center" py={16}><Spinner /></Flex>
      ) : items.length === 0 ? (
        <Box bg={card} border="1px solid" borderColor={border} borderRadius="lg" p={8} textAlign="center">
          <Text fontSize="2xl" mb={2}>📹</Text>
          <Text fontWeight="bold" mb={1}>No video messages yet</Text>
          <Text fontSize="sm" color={muted}>Send a video to one person. They can reply on any moment.</Text>
        </Box>
      ) : (
        <VStack spacing={2} align="stretch">
          {items.map((item) => {
            const other = otherParty(item, user?._id)
            const unseen = isUnseen(item, user?._id)
            const mine = uidOf(item.sender) === String(user?._id)
            return (
              <Flex
                key={item._id}
                bg={card}
                border="1px solid"
                borderColor={unseen ? 'blue.400' : border}
                borderRadius="lg"
                p={3}
                gap={3}
                cursor="pointer"
                align="center"
                onClick={() => {
                  if (unseen) setVideoMessageUnseenCount?.((n) => Math.max(0, (n || 0) - 1))
                  navigate(`/video-messages/${item._id}`)
                }}
              >
                <Box
                  w="72px"
                  h="96px"
                  borderRadius="md"
                  overflow="hidden"
                  bg="black"
                  flexShrink={0}
                  position="relative"
                >
                  {item.thumbnailUrl ? (
                    <Box
                      as="img"
                      src={mediaDisplayUrl(item.thumbnailUrl)}
                      alt=""
                      w="100%"
                      h="100%"
                      objectFit="cover"
                    />
                  ) : (
                    <video
                      src={`${mediaDisplayUrl(item.videoUrl)}#t=0.4`}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                  <Text position="absolute" left="6px" bottom="4px" color="white" fontSize="xs" textShadow="0 1px 4px #000">
                    ▶ {fmtTime(item.duration)}
                  </Text>
                </Box>
                <Avatar src={mediaDisplayUrl(other?.profilePic)} name={other?.name || other?.username} size="sm" />
                <Box flex="1" minW={0}>
                  <HStack>
                    <Text fontWeight={unseen ? 'bold' : 'semibold'} noOfLines={1}>
                      {other?.name || other?.username || 'User'}
                    </Text>
                    {unseen && <Badge colorScheme="blue">new</Badge>}
                  </HStack>
                  <Text fontSize="sm" color={muted}>
                    {mine ? (item.seenAt ? 'Seen' : 'Not opened yet') : 'Sent you'} · {fmtTime(item.duration)} · {item.noteCount || 0} replies
                  </Text>
                </Box>
                <Text fontSize="lg">▶</Text>
                <Button
                  size="xs"
                  variant="ghost"
                  colorScheme="red"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!window.confirm('Delete this video for both of you?')) return
                    try {
                      const res = await fetch(`${API_BASE_URL}/api/video-message/${item._id}`, {
                        method: 'DELETE',
                        credentials: 'include',
                      })
                      const data = await res.json().catch(() => ({}))
                      if (!res.ok) throw new Error(data.error || 'Failed to delete')
                      setItems((prev) => prev.filter((x) => String(x._id) !== String(item._id)))
                    } catch (err) {
                      showToast('Error', err.message || 'Failed to delete', 'error')
                    }
                  }}
                >
                  Delete
                </Button>
              </Flex>
            )
          })}
          {hasMore && (
            <Button variant="ghost" isLoading={loadingMore} onClick={() => load(true)}>
              Load more
            </Button>
          )}
        </VStack>
      )}

      <Modal isOpen={sendModal.isOpen} onClose={sendModal.onClose} isCentered>
        <ModalOverlay />
        <ModalContent bg={card}>
          <ModalHeader>Send video message</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <Text fontSize="sm" mb={2}>To</Text>
            {pickedUser ? (
              <Flex align="center" gap={2} mb={3}>
                <Avatar size="sm" src={mediaDisplayUrl(pickedUser.profilePic)} name={pickedUser.name} />
                <Text flex="1">{pickedUser.name || pickedUser.username}</Text>
                <Button size="xs" onClick={() => setPickedUser(null)}>Change</Button>
              </Flex>
            ) : (
              <>
                <Input
                  placeholder="Search people you follow"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  mb={2}
                />
                {searching && <Spinner size="sm" mb={2} />}
                <VStack align="stretch" spacing={1} maxH="180px" overflowY="auto" mb={3}>
                  {people.map((p) => (
                    <Flex
                      key={p._id}
                      gap={2}
                      align="center"
                      p={2}
                      borderRadius="md"
                      cursor="pointer"
                      _hover={{ bg: hoverBg }}
                      onClick={() => {
                        setPickedUser(p)
                        setPeople([])
                        setQuery('')
                      }}
                    >
                      <Avatar size="sm" src={mediaDisplayUrl(p.profilePic)} name={p.name} />
                      <Box>
                        <Text fontSize="sm" fontWeight="semibold">{p.name || p.username}</Text>
                        <Text fontSize="xs" color={muted}>@{p.username}</Text>
                      </Box>
                    </Flex>
                  ))}
                </VStack>
              </>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
            />
            <Flex gap={2} mb={3}>
              <Button size="sm" variant="outline" flex="1" onClick={() => fileRef.current?.click()}>
                Pick video
              </Button>
              <Button size="sm" colorScheme="red" variant="outline" flex="1" onClick={() => setRecordOpen(true)}>
                Record
              </Button>
            </Flex>
            {pickedFile && (
              <Text fontSize="sm" color={muted} mb={3} noOfLines={1}>
                Ready: {pickedFile.name}
              </Text>
            )}
            <VideoRecordModal
              isOpen={recordOpen}
              onClose={() => setRecordOpen(false)}
              maxSeconds={180}
              title="Record video message"
              onReady={(file) => setPickedFile(file)}
            />

            <Button
              colorScheme="blue"
              w="full"
              isDisabled={!pickedUser || !pickedFile}
              isLoading={sending}
              loadingText={sendHint || 'Sending'}
              onClick={handleSend}
            >
              Send
            </Button>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default VideoMessagesPage
