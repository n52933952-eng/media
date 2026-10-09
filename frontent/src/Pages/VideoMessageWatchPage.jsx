import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Flex,
  HStack,
  Spinner,
  Text,
  useColorModeValue,
} from '@chakra-ui/react'
import { useNavigate, useParams } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'
import { uploadMediaToR2 } from '../utils/directR2Upload'
import { mediaDisplayUrl } from '../utils/mediaUrl.js'
import { fmtTime, otherParty, prepareLightVideo, uidOf } from '../utils/videoMessage.js'
import VideoRecordModal from '../Components/VideoRecordModal.jsx'

const REACTIONS = ['❤️', '😂', '🔥']

const VideoMessageWatchPage = () => {
  const { id } = useParams()
  const { user } = useContext(UserContext)
  const { socket, refreshVideoMessageUnseenCount } = useContext(SocketContext) || {}
  const showToast = useShowToast()
  const navigate = useNavigate()
  const panel = useColorModeValue('#f7f8fa', '#121212')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const card = useColorModeValue('white', '#1c1c1c')

  const videoRef = useRef(null)
  // One always-mounted reply player. We pre-load the next reply into it a few
  // seconds early so it starts the instant the playhead reaches its moment.
  const noteVideoRef = useRef(null)
  const primedUrlRef = useRef('')
  const fileRef = useRef(null)
  const shownRef = useRef(new Set())
  const lastTRef = useRef(0)
  const resumeAfterRef = useRef(true)
  const pinRef = useRef(0)
  const durFixedRef = useRef(false)
  const askedRef = useRef(new Set())
  const resumePlayRef = useRef(false)

  const [item, setItem] = useState(null)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyHint, setBusyHint] = useState('')
  const [activeNote, setActiveNote] = useState(null)
  const [popReaction, setPopReaction] = useState(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [askNow, setAskNow] = useState(null)

  const other = item ? otherParty(item, user?._id) : null
  const iAmSender = item ? uidOf(item.sender) === String(user?._id) : false
  const videoNotes = useMemo(() => notes.filter((n) => n.type === 'video' && n.videoUrl), [notes])

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
      setItem((prev) => (prev ? { ...prev, noteCount: (prev.noteCount || 0) + 1 } : prev))
    }
    const onDel = (payload) => {
      if (String(payload?.videoMessageId) !== String(id)) return
      setNotes((prev) => prev.filter((n) => String(n._id) !== String(payload.noteId)))
    }
    const onMarker = (payload) => {
      if (String(payload?.videoMessageId) !== String(id) || !Array.isArray(payload?.markers)) return
      setItem((prev) => (prev ? { ...prev, markers: payload.markers } : prev))
      const asks = payload.markers.filter((m) => m?.type === 'reply')
      const last = asks[asks.length - 1]
      if (!last) return
      setAskNow(last)
      showToast('Asked', 'They want a reply or a reaction here', 'info')
    }
    socket.on('videoMessage:note', onNote)
    socket.on('videoMessage:noteDeleted', onDel)
    socket.on('videoMessage:marker', onMarker)
    const onDeleted = (payload) => {
      if (String(payload?._id) === String(id)) navigate('/video-messages')
    }
    socket.on('videoMessage:deleted', onDeleted)
    return () => {
      socket.off('videoMessage:note', onNote)
      socket.off('videoMessage:noteDeleted', onDel)
      socket.off('videoMessage:marker', onMarker)
      socket.off('videoMessage:deleted', onDeleted)
    }
  }, [socket, id])

  const liveMarker = useMemo(() => {
    const marks = item?.markers || []
    return marks.find((m) => Math.abs((m.t || 0) - now) < 1.2) || null
  }, [item?.markers, now])

  /** Load a reply into the hidden player without showing it (pre-buffer). */
  const primeNote = useCallback((note) => {
    const el = noteVideoRef.current
    if (!el || !note?.videoUrl) return
    const url = mediaDisplayUrl(note.videoUrl)
    if (primedUrlRef.current === url) return
    primedUrlRef.current = url
    el.src = url
    el.load()
  }, [])

  const closeOverlay = useCallback((resume = true) => {
    setActiveNote(null)
    try {
      noteVideoRef.current?.pause()
    } catch {
      /* ignore */
    }
    const v = videoRef.current
    if (resume && v && resumeAfterRef.current) {
      resumePlayRef.current = true
      v.play().catch(() => {})
    }
  }, [])

  const takeFinite = (raw) => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 && n < 1e5 ? n : 0
  }

  const openOverlay = useCallback(
    (note, { resumeAfter = true, seek = true } = {}) => {
      if (!note || note.type !== 'video' || !note.videoUrl) {
        if (note?.type === 'reaction') {
          shownRef.current.add(String(note._id))
          setPopReaction(note)
          setTimeout(() => setPopReaction((cur) => (cur?._id === note._id ? null : cur)), 1600)
        }
        return
      }
      resumeAfterRef.current = resumeAfter
      shownRef.current.add(String(note._id))
      if (seek) {
        const v = videoRef.current
        if (v) v.currentTime = Math.max(0, Number(note.t) || 0)
      }
      videoRef.current?.pause()
      setPlaying(false)
      setActiveNote(note)
      primeNote(note)
      const el = noteVideoRef.current
      if (el) {
        try {
          el.currentTime = 0
        } catch {
          /* not loaded yet; starts from 0 anyway */
        }
        el.play().catch(() => {})
      }
    },
    [primeNote],
  )

  const handleTime = (t) => {
    const prev = lastTRef.current
    lastTRef.current = t
    setNow(t)
    if (activeNote) return
    if (t + 0.05 < prev) {
      for (const n of videoNotes) {
        if (n.t > t + 0.2) shownRef.current.delete(String(n._id))
      }
      for (const m of item?.markers || []) {
        if (m.t > t + 0.2) askedRef.current.delete(String(m.t))
      }
    }
    if (!iAmSender && !activeNote) {
      const ask = (item?.markers || []).find((m) => {
        if (m?.type !== 'reply' || askedRef.current.has(String(m.t))) return false
        return m.t >= Math.min(prev, t) - 0.05 && m.t <= Math.max(prev, t) + 0.35
      })
      if (ask) {
        askedRef.current.add(String(ask.t))
        setAskNow(ask)
      }
    }
    const hit = videoNotes.find((n) => {
      const idn = String(n._id)
      if (shownRef.current.has(idn)) return false
      return n.t >= Math.min(prev, t) - 0.05 && n.t <= Math.max(prev, t) + 0.35
    })
    if (hit) {
      openOverlay(hit, { resumeAfter: true, seek: false })
    } else {
      // Pre-buffer the next reply ~8s before its moment.
      const upcoming = videoNotes.find((n) => !shownRef.current.has(String(n._id)) && n.t > t && n.t - t < 8)
      if (upcoming) primeNote(upcoming)
    }
    const react = notes.find((n) => {
      if (n.type !== 'reaction') return false
      const idn = String(n._id)
      if (shownRef.current.has(idn)) return false
      return Math.abs((n.t || 0) - t) < 0.35
    })
    if (react) {
      shownRef.current.add(String(react._id))
      setPopReaction(react)
      setTimeout(() => setPopReaction((cur) => (cur?._id === react._id ? null : cur)), 1600)
    }
  }

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
    for (const n of videoNotes) {
      if (n.t > t + 0.2) shownRef.current.delete(String(n._id))
    }
    v.currentTime = Math.max(0, t)
    setNow(t)
    lastTRef.current = t
  }

  const askReplyHere = async () => {
    if (busy || !iAmSender) return
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/reply-prompt`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: now, text: 'Reply here' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (Array.isArray(data.markers)) setItem((prev) => (prev ? { ...prev, markers: data.markers } : prev))
      showToast('Sent', `Asked for a reply at ${fmtTime(now)}`, 'success')
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
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
      if (data.note) {
        setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t))
        openOverlay(data.note, { resumeAfter: true, seek: false })
      }
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const addVideoNote = async (file) => {
    if (!file || busy) return
    setBusy(true)
    setBusyHint('Making video light…')
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
      const light = await prepareLightVideo(file, 'note')
      setBusyHint('Uploading…')
      const videoUrl = await uploadMediaToR2(light, 'video-messages', { skipCompress: true })
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video', videoUrl, duration: Math.round(durationSec), t: pinRef.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (data.note) {
        setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t))
        openOverlay(data.note, { resumeAfter: true, seek: true })
      }
      showToast('Saved', `Reply pinned at ${fmtTime(now)}`, 'success')
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
      setBusyHint('')
    }
  }

  const deleteNote = async (note) => {
    if (!note?._id || busy) return
    if (!window.confirm('Remove this reply?')) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/notes/${note._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to remove')
      setNotes((prev) => prev.filter((n) => String(n._id) !== String(note._id)))
      setItem((prev) => (prev ? { ...prev, noteCount: Math.max(0, (prev.noteCount || 0) - 1) } : prev))
      if (activeNote && String(activeNote._id) === String(note._id)) closeOverlay(false)
    } catch (e) {
      showToast('Error', e.message || 'Failed to remove', 'error')
    }
  }

  const deleteVideo = async () => {
    if (!window.confirm('Delete this video for both of you?')) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      navigate('/video-messages')
    } catch (e) {
      showToast('Error', e.message || 'Failed to delete', 'error')
    }
  }

  if (loading) {
    return (
      <Flex justify="center" py={20}><Spinner /></Flex>
    )
  }
  if (!item) return null

  const dur = takeFinite(duration) || takeFinite(item.duration) || 1

  return (
    <Box
      maxW="620px"
      mx="auto"
      w="100%"
      minH={{ base: 'calc(100dvh - 72px)', md: 'auto' }}
      bg={panel}
      borderRadius={{ md: '16px' }}
      overflow="hidden"
    >
      <Flex align="center" gap={3} px={3} py={2.5} bg="#0b0b0b">
        <Button size="sm" variant="ghost" color="white" onClick={() => navigate('/video-messages')}>
          ← Back
        </Button>
        <Avatar size="sm" src={mediaDisplayUrl(other?.profilePic)} name={other?.name} />
        <Box minW={0} flex="1">
          <Text color="white" fontWeight="semibold" noOfLines={1} fontSize="sm">
            {other?.name || other?.username}
          </Text>
          <Text color="whiteAlpha.700" fontSize="xs">
            {notes.length} replies inside this video
          </Text>
        </Box>
        <Button size="sm" variant="ghost" color="red.300" onClick={deleteVideo}>
          Delete
        </Button>
      </Flex>

      <Box
        position="relative"
        bg="black"
        w="100%"
        h={{ base: 'min(62dvh, 520px)', md: 'min(58vh, 560px)' }}
      >
        <video
          ref={videoRef}
          src={mediaDisplayUrl(item.videoUrl)}
          poster={item.thumbnailUrl ? mediaDisplayUrl(item.thumbnailUrl) : undefined}
          playsInline
          preload="metadata"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
            filter: activeNote ? 'brightness(0.38)' : 'none',
          }}
          onClick={togglePlay}
          onTimeUpdate={(e) => handleTime(e.currentTarget.currentTime || 0)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            const known = takeFinite(v.duration) || takeFinite(item.duration)
            if (known) {
              setDuration(known)
              return
            }
            if (durFixedRef.current) return
            durFixedRef.current = true
            const fix = () => {
              v.removeEventListener('timeupdate', fix)
              const d = takeFinite(v.duration)
              try { v.currentTime = 0 } catch { /* ignore */ }
              if (d) setDuration(d)
            }
            v.addEventListener('timeupdate', fix)
            try { v.currentTime = 1e101 } catch { /* ignore */ }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        {!iAmSender && !activeNote && (askNow || liveMarker?.type === 'reply') && (
          <Box position="absolute" left="12px" right="12px" bottom="12px" bg="blackAlpha.800" color="white" px={3} py={2.5} borderRadius="xl">
            <Text fontWeight="bold" fontSize="sm">Wants a reply or a reaction here</Text>
            <Text fontSize="xs" color="whiteAlpha.800">At {fmtTime((askNow || liveMarker)?.t)} · record a video or tap a reaction</Text>
          </Box>
        )}
        {iAmSender && liveMarker && !activeNote && liveMarker.type !== 'reply' && (
          <Box position="absolute" top="12px" left="12px" bg="blackAlpha.700" color="white" px={3} py={1} borderRadius="full" fontSize="sm">
            {liveMarker.type === 'question' ? `❓ ${liveMarker.text || ''}` : `👀 ${liveMarker.text || 'Look here'}`}
          </Box>
        )}

        {popReaction && !activeNote && (
          <Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
            <Text fontSize="5xl">{popReaction.reaction}</Text>
          </Flex>
        )}

        {/* Always mounted so the next reply can buffer before its moment. */}
        <Flex
          position="absolute"
          inset={0}
          align="center"
          justify="center"
          px={4}
          display={activeNote ? 'flex' : 'none'}
        >
          <Box
            w={{ base: '58%', sm: '46%' }}
            maxW="260px"
            bg="#111"
            borderRadius="18px"
            overflow="hidden"
            boxShadow="0 16px 50px rgba(0,0,0,0.55)"
            border="2px solid rgba(255,255,255,0.85)"
          >
              <video
              ref={noteVideoRef}
              playsInline
              preload="auto"
              style={{ width: '100%', display: 'block', aspectRatio: '3 / 4', objectFit: 'cover', background: '#000' }}
              onEnded={() => {
                const endedT = Number(activeNote?.t) || 0
                const next = videoNotes.find(
                  (n) =>
                    !shownRef.current.has(String(n._id)) &&
                    Math.abs((Number(n.t) || 0) - endedT) < 0.8,
                )
                if (next) openOverlay(next, { resumeAfter: true, seek: false })
                else closeOverlay(true)
              }}
            />
            <Flex px={2} py={1.5} align="center" justify="space-between" bg="#161616">
              <Text color="white" fontSize="xs" noOfLines={1}>
                {activeNote?.user?.name || activeNote?.user?.username || 'Reply'} · {fmtTime(activeNote?.t)}
              </Text>
              <Button size="xs" variant="ghost" color="white" onClick={() => closeOverlay(true)}>
                Close
              </Button>
            </Flex>
          </Box>
        </Flex>
      </Box>

      <Box bg={card} px={{ base: 3, md: 4 }} py={4}>
        <Flex align="center" mb={2}>
          <Button size="sm" onClick={togglePlay} borderRadius="full" minW="40px">
            {playing ? '❚❚' : '▶'}
          </Button>
          <Text fontSize="sm" color={muted} ml={2} fontVariantNumeric="tabular-nums">{fmtTime(now)}</Text>
          <Box flex="1" />
          <Text fontSize="sm" color={muted} fontVariantNumeric="tabular-nums">{fmtTime(dur)}</Text>
        </Flex>
        <Box
          h="22px"
          bg="blackAlpha.300"
          borderRadius="full"
          position="relative"
          cursor="pointer"
          mb={3}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            seekTo(pct * dur)
          }}
        >
          <Box position="absolute" left={0} top="8px" h="6px" w={`${Math.min(100, (now / dur) * 100)}%`} bg="blue.400" borderRadius="full" />
          {(item.markers || []).map((m, i) => (
            <Box
              key={`m-${i}`}
              position="absolute"
              left={`${Math.min(98, (m.t / dur) * 100)}%`}
              top="4px"
              w="4px"
              h="14px"
              bg="yellow.300"
              borderRadius="sm"
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
              top="-1px"
              fontSize="13px"
              transform="translateX(-50%)"
              cursor="pointer"
              lineHeight="22px"
              onClick={(e) => {
                e.stopPropagation()
                openOverlay(n, { resumeAfter: true, seek: true })
              }}
            >
              {n.type === 'reaction' ? n.reaction : '●'}
            </Box>
          ))}
        </Box>

        <HStack spacing={2} mb={3} flexWrap="wrap">
          {iAmSender ? (
            <Button colorScheme="blue" borderRadius="full" isLoading={busy} onClick={askReplyHere}>
              Reply here · {fmtTime(now)}
            </Button>
          ) : (
            <>
              <Button
                colorScheme="red"
                borderRadius="full"
                isLoading={busy}
                loadingText={busyHint || 'Working'}
                onClick={() => {
                  const v = videoRef.current
                  const t = v ? v.currentTime || now : now
                  pinRef.current = t
                  setNow(t)
                  v?.pause()
                  setPlaying(false)
                  setRecordOpen(true)
                }}
              >
                Record · {fmtTime(now)}
              </Button>
              <Button
                variant="outline"
                borderRadius="full"
                isDisabled={busy}
                onClick={() => {
                  const v = videoRef.current
                  const t = v ? v.currentTime || now : now
                  pinRef.current = t
                  setNow(t)
                  v?.pause()
                  setPlaying(false)
                  fileRef.current?.click()
                }}
              >
                Pick video
              </Button>
            </>
          )}
          {REACTIONS.map((e) => (
            <Button key={e} size="sm" variant="outline" borderRadius="full" isDisabled={busy} onClick={() => addReaction(e)}>
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
        <VideoRecordModal
          isOpen={recordOpen}
          onClose={() => setRecordOpen(false)}
          maxSeconds={20}
          title={`Reply at ${fmtTime(now)}`}
          onReady={(file) => {
            if (file) addVideoNote(file)
            else videoRef.current?.play().catch(() => {})
          }}
        />

        {!iAmSender && (item.markers || []).some((m) => m.type === 'reply') && (
          <Box mb={3}>
            <Text fontSize="sm" fontWeight="bold" mb={1}>Asked you</Text>
            {(item.markers || []).filter((m) => m.type === 'reply').map((m, i) => (
              <Flex
                key={`ask-${i}`}
                gap={2}
                align="center"
                py={1.5}
                cursor="pointer"
                onClick={() => {
                  setAskNow(m)
                  seekTo(m.t)
                  videoRef.current?.pause()
                  setPlaying(false)
                }}
              >
                <Text w="44px" fontSize="sm" color={muted}>{fmtTime(m.t)}</Text>
                <Text fontSize="sm">Reply or reaction here</Text>
              </Flex>
            ))}
          </Box>
        )}

        {notes.length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="bold" mb={2}>Inside this video</Text>
            {notes.map((n) => (
              <Flex
                key={n._id}
                gap={2}
                align="center"
                py={1.5}
                cursor="pointer"
                onClick={() => openOverlay(n, { resumeAfter: true, seek: true })}
              >
                <Text w="44px" fontSize="sm" color={muted}>{fmtTime(n.t)}</Text>
                <Text fontSize="sm">{n.type === 'reaction' ? n.reaction : 'Video reply'}</Text>
                <Text fontSize="sm" color={muted} noOfLines={1} flex="1">
                  {n.user?.name || n.user?.username || ''}
                </Text>
                {uidOf(n.user) === String(user?._id) && (
                  <Button
                    size="xs"
                    variant="ghost"
                    color={muted}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteNote(n)
                    }}
                  >
                    ✕
                  </Button>
                )}
              </Flex>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default VideoMessageWatchPage
