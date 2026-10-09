import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Spinner,
  Text,
  useColorModeValue,
  VStack,
} from '@chakra-ui/react'
import { useNavigate, useParams } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'
import { uploadMediaToR2 } from '../utils/directR2Upload'
import { mediaDisplayUrl } from '../utils/mediaUrl.js'
import { fmtTime, otherParty } from '../utils/videoMessage.js'

const REACTIONS = ['❤️', '😂', '🔥']

const VideoMessageWatchPage = () => {
  const { id } = useParams()
  const { user } = useContext(UserContext)
  const { socket, refreshVideoMessageUnseenCount } = useContext(SocketContext) || {}
  const showToast = useShowToast()
  const navigate = useNavigate()
  const bg = useColorModeValue('#000', '#000')
  const panel = useColorModeValue('white', '#1a1a1a')
  const muted = useColorModeValue('gray.600', 'gray.400')

  const videoRef = useRef(null)
  const noteVideoRef = useRef(null)
  const fileRef = useRef(null)
  const [item, setItem] = useState(null)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activeNote, setActiveNote] = useState(null)

  const other = item ? otherParty(item, user?._id) : null

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Not found')
      setItem(data)
      setNotes(Array.isArray(data.notes) ? data.notes : [])
      refreshVideoMessageUnseenCount?.()
    } catch (e) {
      showToast('Error', e.message || 'Failed to open', 'error')
      navigate('/video-messages')
    } finally {
      setLoading(false)
    }
  }, [id, navigate, showToast, refreshVideoMessageUnseenCount])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!socket) return
    const onNote = (payload) => {
      if (String(payload?.videoMessageId) !== String(id) || !payload?.note) return
      setNotes((prev) => {
        if (prev.some((n) => String(n._id) === String(payload.note._id))) return prev
        return [...prev, payload.note].sort((a, b) => a.t - b.t)
      })
      setItem((prev) => prev ? { ...prev, noteCount: (prev.noteCount || 0) + 1 } : prev)
    }
    const onDel = (payload) => {
      if (String(payload?.videoMessageId) !== String(id)) return
      setNotes((prev) => prev.filter((n) => String(n._id) !== String(payload.noteId)))
    }
    socket.on('videoMessage:note', onNote)
    socket.on('videoMessage:noteDeleted', onDel)
    return () => {
      socket.off('videoMessage:note', onNote)
      socket.off('videoMessage:noteDeleted', onDel)
    }
  }, [socket, id])

  const liveMarker = useMemo(() => {
    const marks = item?.markers || []
    return marks.find((m) => Math.abs((m.t || 0) - now) < 1.2) || null
  }, [item?.markers, now])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().catch(() => {})
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  const seekTo = (t) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, t)
    setNow(t)
  }

  const addReaction = async (emoji) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reaction', reaction: emoji, t: now }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (data.note) setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t))
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const addVideoNote = async (file) => {
    if (!file || busy) return
    setBusy(true)
    try {
      const tmp = document.createElement('video')
      const url = URL.createObjectURL(file)
      const durationSec = await new Promise((resolve) => {
        tmp.preload = 'metadata'
        tmp.onloadedmetadata = () => {
          const d = tmp.duration
          URL.revokeObjectURL(url)
          resolve(Number.isFinite(d) ? d : 0)
        }
        tmp.onerror = () => {
          URL.revokeObjectURL(url)
          resolve(0)
        }
        tmp.src = url
      })
      if (durationSec > 30) {
        showToast('Error', 'Reply video must be 30 seconds or less', 'error')
        return
      }
      const videoUrl = await uploadMediaToR2(file, 'video-messages', { skipCompress: true })
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video', videoUrl, duration: Math.round(durationSec), t: now }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (data.note) setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t))
      showToast('Saved', `Reply pinned at ${fmtTime(now)}`, 'success')
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openNote = (note) => {
    seekTo(note.t || 0)
    videoRef.current?.pause()
    setPlaying(false)
    if (note.type === 'video' && note.videoUrl) setActiveNote(note)
  }

  if (loading) {
    return (
      <Flex justify="center" py={20}><Spinner /></Flex>
    )
  }
  if (!item) return null

  const dur = duration || item.duration || 1

  return (
    <Box bg={bg} mx={{ base: -3, md: 0 }} borderRadius={{ md: 'lg' }} overflow="hidden">
      <Flex align="center" gap={2} px={3} py={2} bg="#111">
        <Button size="sm" variant="ghost" color="white" onClick={() => navigate('/video-messages')}>
          ← Back
        </Button>
        <Avatar size="sm" src={mediaDisplayUrl(other?.profilePic)} name={other?.name} />
        <Text color="white" fontWeight="semibold" noOfLines={1}>
          {other?.name || other?.username}
        </Text>
      </Flex>

      <Box position="relative" bg="black">
        <video
          ref={videoRef}
          src={mediaDisplayUrl(item.videoUrl)}
          playsInline
          style={{ width: '100%', maxHeight: '62vh', background: '#000' }}
          onClick={togglePlay}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime || 0)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || item.duration || 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {liveMarker && (
          <Box
            position="absolute"
            top="12px"
            left="12px"
            bg="blackAlpha.700"
            color="white"
            px={3}
            py={1}
            borderRadius="full"
            fontSize="sm"
          >
            {liveMarker.type === 'question' ? '❓' : '👀'} {liveMarker.text || 'Look here'}
          </Box>
        )}
        {activeNote && (
          <Box
            position="absolute"
            right="10px"
            bottom="10px"
            w="38%"
            minW="140px"
            bg="black"
            borderRadius="md"
            overflow="hidden"
            border="2px solid white"
          >
            <video
              ref={noteVideoRef}
              src={mediaDisplayUrl(activeNote.videoUrl)}
              autoPlay
              playsInline
              controls
              style={{ width: '100%', display: 'block' }}
              onEnded={() => setActiveNote(null)}
            />
            <Button size="xs" w="full" onClick={() => setActiveNote(null)}>Close reply</Button>
          </Box>
        )}
      </Box>

      <Box bg={panel} p={4}>
        <Flex align="center" gap={3} mb={3}>
          <IconButton
            aria-label={playing ? 'Pause' : 'Play'}
            size="sm"
            onClick={togglePlay}
            icon={<Text>{playing ? '❚❚' : '▶'}</Text>}
          />
          <Text fontSize="sm" w="84px">{fmtTime(now)} / {fmtTime(dur)}</Text>
          <Box
            flex="1"
            h="14px"
            bg="gray.600"
            borderRadius="full"
            position="relative"
            cursor="pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
              seekTo(pct * dur)
            }}
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              bottom={0}
              w={`${Math.min(100, (now / dur) * 100)}%`}
              bg="blue.400"
              borderRadius="full"
            />
            {(item.markers || []).map((m, i) => (
              <Box
                key={`m-${i}`}
                position="absolute"
                left={`${Math.min(98, (m.t / dur) * 100)}%`}
                top="-3px"
                w="8px"
                h="20px"
                bg="yellow.300"
                borderRadius="sm"
                title={m.text || 'Mark'}
                onClick={(e) => {
                  e.stopPropagation()
                  seekTo(m.t)
                }}
              />
            ))}
            {notes.map((n) => (
              <Box
                key={n._id}
                position="absolute"
                left={`${Math.min(98, (n.t / dur) * 100)}%`}
                top="-6px"
                fontSize="14px"
                lineHeight="1"
                transform="translateX(-50%)"
                cursor="pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  openNote(n)
                }}
                title={`${n.type === 'reaction' ? n.reaction : 'Video note'} @ ${fmtTime(n.t)}`}
              >
                {n.type === 'reaction' ? n.reaction : '🎥'}
              </Box>
            ))}
          </Box>
        </Flex>

        <Text fontSize="sm" color={muted} mb={3}>
          Pause at any second, then reply on that moment.
        </Text>

        <HStack spacing={2} mb={3} flexWrap="wrap">
          <Button
            colorScheme="blue"
            isLoading={busy}
            onClick={() => {
              videoRef.current?.pause()
              fileRef.current?.click()
            }}
          >
            🎥 Reply here · {fmtTime(now)}
          </Button>
          {REACTIONS.map((e) => (
            <Button key={e} size="sm" variant="outline" isDisabled={busy} onClick={() => addReaction(e)}>
              {e}
            </Button>
          ))}
        </HStack>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) addVideoNote(f)
          }}
        />

        {notes.length > 0 && (
          <VStack align="stretch" spacing={1} mt={2}>
            <Text fontSize="sm" fontWeight="bold">Replies</Text>
            {notes.map((n) => (
              <Flex
                key={n._id}
                gap={2}
                align="center"
                py={1}
                cursor="pointer"
                onClick={() => openNote(n)}
              >
                <Text w="44px" fontSize="sm" color={muted}>{fmtTime(n.t)}</Text>
                <Text>{n.type === 'reaction' ? n.reaction : '🎥 Video note'}</Text>
                <Text fontSize="sm" color={muted} noOfLines={1}>
                  {n.user?.name || n.user?.username || ''}
                </Text>
              </Flex>
            ))}
          </VStack>
        )}
      </Box>
    </Box>
  )
}

export default VideoMessageWatchPage
