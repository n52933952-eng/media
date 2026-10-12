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
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'
import { uploadMediaToR2 } from '../utils/directR2Upload'
import { mediaDisplayUrl } from '../utils/mediaUrl.js'
import { fmtTime, otherParty, partyLabel, prepareLightVideo, uidOf } from '../utils/videoMessage.js'
import VideoRecordModal from '../Components/VideoRecordModal.jsx'

const REACTIONS = ['❤️', '😂', '🔥', '😮', '😢', '👏', '😍', '🎉', '👍', '💯', '🙏', '😭', '🤣', '😎', '💪', '✨']

const VideoMessageWatchPage = () => {
  const { id } = useParams()
  const listPreview = useLocation().state?.preview
  const openedFromList = useRef(!!listPreview?.videoUrl)
  const { user } = useContext(UserContext)
  const { socket, setVideoMessageUnseenCount } = useContext(SocketContext) || {}
  const showToast = useShowToast()
  const navigate = useNavigate()
  const panel = useColorModeValue('#f7f8fa', '#121212')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const card = useColorModeValue('white', '#1c1c1c')

  const videoRef = useRef(null)
  const frameRef = useRef(null)
  // One always-mounted reply player. We pre-load the next reply into it a few
  // seconds early so it starts the instant the playhead reaches its moment.
  const noteVideoRef = useRef(null)
  const primedUrlRef = useRef('')
  const fileRef = useRef(null)
  const shownRef = useRef(new Set())
  const lastTRef = useRef(0)
  const resumeAfterRef = useRef(true)
  const replyLockRef = useRef(false)
  const pinnedTRef = useRef(0)
  const pinRef = useRef(0)
  const barRef = useRef(null)
  const dragRef = useRef(false)
  const durFixedRef = useRef(false)
  const replyTRef = useRef(0)
  const replyPrevRef = useRef(0)
  const askedRef = useRef(new Set())
  const resumePlayRef = useRef(false)

  const [item, setItem] = useState(listPreview?.videoUrl ? listPreview : null)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(!listPreview?.videoUrl)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(() => {
    const saved = Number(listPreview?.duration)
    return Number.isFinite(saved) && saved > 0 && saved < 1e5 ? saved : 0
  })
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activeNote, setActiveNote] = useState(null)
  const [popReaction, setPopReaction] = useState(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [replySaving, setReplySaving] = useState(false)
  const [askNow, setAskNow] = useState(null)
  const [videoFull, setVideoFull] = useState(false)

  const other = item ? otherParty(item, user?._id) : null
  const face = item?.isGroup
    ? (item.members || []).find((m) => uidOf(m) !== String(user?._id)) || null
    : other
  const iAmSender = item ? uidOf(item.sender) === String(user?._id) : false
  const videoNotes = useMemo(() => notes.filter((n) => n.type === 'video' && n.videoUrl), [notes])

  const load = useCallback(async () => {
    let lastErr = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/video-message/${id}`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Not found')
        setItem(data)
        setNotes(Array.isArray(data.notes) ? data.notes : [])
        const savedDur = Number(data.duration)
        if (Number.isFinite(savedDur) && savedDur > 0 && savedDur < 1e5) setDuration(savedDur)
        if (typeof data.unseenCount === 'number') setVideoMessageUnseenCount?.(data.unseenCount)
        setLoading(false)
        return
      } catch (e) {
        lastErr = e
        const dropped = /fetch|network/i.test(e?.message || '')
        if (dropped && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 600))
          continue
        }
        break
      }
    }
    if (!openedFromList.current) {
      showToast('Error', lastErr?.message || 'Failed to open', 'error')
      navigate('/video-messages')
    }
    setLoading(false)
  }, [id, navigate, showToast, setVideoMessageUnseenCount])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onFs = () => setVideoFull(document.fullscreenElement === frameRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleVideoFull = () => {
    const el = frameRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
      return
    }
    const req = el.requestFullscreen || el.webkitRequestFullscreen
    if (req) req.call(el).catch(() => {})
  }

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
    const v = videoRef.current
    const pin = pinnedTRef.current
    if (v) {
      try {
        if (Math.abs((v.currentTime || 0) - pin) > 0.2) v.currentTime = pin
      } catch {
        /* ignore */
      }
    }
    lastTRef.current = pin
    setNow(pin)
    replyLockRef.current = false
    setActiveNote(null)
    try {
      noteVideoRef.current?.pause()
    } catch {
      /* ignore */
    }
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
      const v = videoRef.current
      const noteT = Math.max(0, Number(note.t) || 0)
      pinnedTRef.current = noteT + 0.15
      replyLockRef.current = true
      resumeAfterRef.current = resumeAfter
      shownRef.current.add(String(note._id))
      replyTRef.current = 0
      replyPrevRef.current = 0
      for (const n of notes) {
        if (String(n.onNote) === String(note._id)) shownRef.current.delete(String(n._id))
      }
      if (seek && v) {
        try { v.currentTime = noteT } catch { /* ignore */ }
      }
      if (v) {
        try { v.currentTime = noteT } catch { /* ignore */ }
      }
      v?.pause()
      setPlaying(false)
      setActiveNote(note)
      setNow(noteT)
      primeNote(note)
      const el = noteVideoRef.current
      if (el) {
        const start = () => {
          el.removeEventListener('loadeddata', start)
          try {
            if ((el.currentTime || 0) > 0.05) el.currentTime = 0
          } catch {
            /* ignore */
          }
          el.play().catch(() => {})
        }
        if (el.readyState >= 2) start()
        else el.addEventListener('loadeddata', start)
      }
    },
    [primeNote, notes],
  )

  const handleTime = (t) => {
    if (dragRef.current) {
      lastTRef.current = t
      setNow(t)
      return
    }
    if (replyLockRef.current) {
      const v = videoRef.current
      const pin = pinnedTRef.current
      if (v && !v.paused) v.pause()
      if (v && Math.abs((v.currentTime || 0) - pin) > 0.25) {
        try { v.currentTime = pin } catch { /* keep the original on its second */ }
      }
      return
    }
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
      return
    }
    // A long jump is a seek. A normal step still catches the icon we just reached.
    if (t - prev > 2.5) return
    if (!iAmSender && !activeNote) {
      const ask = (item?.markers || []).find((m) => {
        if (m?.type !== 'reply' || askedRef.current.has(String(m.t))) return false
        return m.t > prev - 0.08 && m.t <= t + 0.08
      })
      if (ask) {
        askedRef.current.add(String(ask.t))
        setAskNow(ask)
      }
    }
    const hit = videoNotes.find((n) => {
      const idn = String(n._id)
      if (shownRef.current.has(idn)) return false
      return n.t > prev - 0.08 && n.t <= t + 0.08
    })
    if (hit) {
      openOverlay(hit, { resumeAfter: true, seek: false })
    } else {
      // Pre-buffer the next reply ~8s before its moment.
      const upcoming = videoNotes.find((n) => !shownRef.current.has(String(n._id)) && n.t > t && n.t - t < 8)
      if (upcoming) primeNote(upcoming)
    }
    const react = notes.find((n) => {
      if (n.type !== 'reaction' || n.onNote) return false
      const idn = String(n._id)
      if (shownRef.current.has(idn)) return false
      return n.t > prev - 0.08 && n.t <= t + 0.08
    })
    if (react) {
      shownRef.current.add(String(react._id))
      setPopReaction(react)
      setTimeout(() => setPopReaction((cur) => (cur?._id === react._id ? null : cur)), 1600)
    }
  }

  const togglePlay = () => {
    const reply = activeNote?.type === 'video' ? noteVideoRef.current : null
    if (reply) {
      videoRef.current?.pause()
      if (reply.paused) reply.play().catch(() => {})
      else reply.pause()
      return
    }
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

  const seekTo = (t, { soft = false } = {}) => {
    const v = videoRef.current
    const target = Math.max(0, Number(t) || 0)
    const known = takeFinite(v?.duration) || takeFinite(dur)
    const at = known ? Math.min(known, target) : target
    if (!v) return
    const keepPlaying = !v.paused || replyLockRef.current
    if (replyLockRef.current) {
      replyLockRef.current = false
      setActiveNote(null)
      try { noteVideoRef.current?.pause() } catch { /* ignore */ }
    }
    if (!soft) {
      for (const n of notes) {
        if (n.onNote) continue
        const idn = String(n._id)
        if ((Number(n.t) || 0) > at + 0.25) shownRef.current.delete(idn)
        else shownRef.current.add(idn)
      }
    }
    try { v.currentTime = at } catch { /* ignore */ }
    setNow(at)
    lastTRef.current = at
    if (!soft && keepPlaying) v.play().catch(() => {})
  }

  const handleReplyTime = (t) => {
    const parentId = String(activeNote?._id || '')
    if (!parentId || activeNote?.type !== 'video') return
    const prev = replyPrevRef.current
    replyPrevRef.current = t
    replyTRef.current = t
    if (t + 0.05 < prev) {
      for (const n of notes) {
        if (String(n.onNote) === parentId && n.t > t + 0.2) shownRef.current.delete(String(n._id))
      }
      return
    }
    if (t - prev > 2.5) return
    const react = notes.find((n) => {
      if (n.type !== 'reaction' || String(n.onNote) !== parentId) return false
      const idn = String(n._id)
      if (shownRef.current.has(idn)) return false
      return n.t > prev - 0.08 && n.t <= t + 0.08
    })
    if (!react) return
    shownRef.current.add(String(react._id))
    setPopReaction(react)
    setTimeout(() => setPopReaction((cur) => (String(cur?._id) === String(react._id) ? null : cur)), 1600)
  }

  const goToNote = (note) => {
    if (!note) return
    if (note.type === 'reaction' && note.onNote) {
      const parent = notes.find((n) => String(n._id) === String(note.onNote) && n.type === 'video')
      if (parent) {
        openOverlay(parent, { resumeAfter: true, seek: true })
        return
      }
    }
    const t = Math.max(0, Number(note.t) || 0)
    if (note.type === 'video' && note.videoUrl) {
      openOverlay(note, { resumeAfter: true, seek: true })
      return
    }
    seekTo(t)
    if (note.type === 'reaction') {
      shownRef.current.add(String(note._id))
      setPopReaction(note)
      setTimeout(() => setPopReaction((cur) => (String(cur?._id) === String(note._id) ? null : cur)), 1600)
    }
  }

  const timeFromBar = (clientX) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect?.width) return now
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return pct * (dur || 0)
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

  const removeReplyHere = async (t) => {
    if (busy || !iAmSender) return
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/reply-prompt/remove`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to remove')
      if (Array.isArray(data.markers)) setItem((prev) => (prev ? { ...prev, markers: data.markers } : prev))
    } catch (e) {
      showToast('Error', e.message || 'Failed to remove', 'error')
    } finally {
      setBusy(false)
    }
  }

  const addReaction = async (emoji) => {
    if (busy) return
    const reply = activeNote?.type === 'video' ? activeNote : null
    const t = reply ? replyTRef.current || 0 : now
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-message/${id}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reaction',
          reaction: emoji,
          t,
          ...(reply ? { onNote: reply._id } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (data.note) {
        setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t))
        if (data.note.onNote) {
          shownRef.current.add(String(data.note._id))
          setPopReaction(data.note)
          setTimeout(() => setPopReaction((cur) => (String(cur?._id) === String(data.note._id) ? null : cur)), 1600)
        } else {
          openOverlay(data.note, { resumeAfter: true, seek: false })
        }
      }
    } catch (e) {
      showToast('Error', e.message || 'Failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const addVideoNote = async (file, fromRecord = false) => {
    if (!file || busy) return
    setBusy(true)
    if (fromRecord) setReplySaving(true)
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
      setReplySaving(false)
      setBusy(false)
    }
  }

  const deleteNote = async (note) => {
    if (!note?._id || busy) return
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
      mx="auto"
      w="100%"
      h={{ lg: 'calc(100dvh - 88px)' }}
      minH={{ base: 0, lg: 0 }}
      display="flex"
      flexDirection="column"
      bg={panel}
      borderRadius={{ md: '16px' }}
      overflow={{ base: 'visible', lg: 'hidden' }}
    >
      <Flex align="center" gap={{ base: 2, sm: 3 }} px={{ base: 2, sm: 3 }} py={2.5} bg="#0b0b0b" w="100%" minW={0} flexWrap="nowrap">
        <Button size="sm" variant="ghost" color="white" flexShrink={0} px={{ base: 2, sm: 3 }} onClick={() => navigate('/video-messages')}>
          ←
        </Button>
        <Avatar size="sm" flexShrink={0} src={mediaDisplayUrl(face?.profilePic)} name={face?.name || partyLabel(item, user?._id)} />
        <Box minW={0} flex="1" overflow="hidden">
          <Text color="white" fontWeight="semibold" noOfLines={1} fontSize="sm" wordBreak="normal">
            {partyLabel(item, user?._id)}
          </Text>
          <Text color="whiteAlpha.700" fontSize="xs" noOfLines={1} wordBreak="normal">
            {notes.length} replies
          </Text>
        </Box>
        <Button size="sm" variant="ghost" color="red.300" flexShrink={0} px={{ base: 2, sm: 3 }} onClick={deleteVideo}>
          Delete
        </Button>
      </Flex>

      <HStack spacing={2} px={3} py={2} bg="#0b0b0b" flexWrap="wrap" justify="center">
        {iAmSender ? (
          <Button colorScheme="blue" borderRadius="full" size="sm" onClick={askReplyHere}>
            Reply here
          </Button>
        ) : null}
        <Button
          colorScheme="red"
          borderRadius="full"
          size="sm"
          position="relative"
          isDisabled={replySaving}
          onClick={() => {
            if (replySaving) return
            const v = videoRef.current
            const t = v ? v.currentTime || now : now
            pinRef.current = t
            setNow(t)
            v?.pause()
            setPlaying(false)
            setRecordOpen(true)
          }}
        >
          <Text as="span" opacity={replySaving ? 0 : 1}>Record</Text>
          {replySaving ? <Spinner size="sm" position="absolute" color="white" /> : null}
        </Button>
        {!iAmSender ? (
          <Button
            variant="outline"
            borderRadius="full"
            size="sm"
            color="white"
            borderColor="whiteAlpha.700"
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
        ) : null}
      </HStack>

      <Flex flex={{ lg: '1' }} minH={{ lg: 0 }} direction={{ base: 'column', lg: 'row' }} align="stretch" overflow={{ lg: 'hidden' }}>
      <Box flex={{ base: '0 0 auto', lg: '1' }} minW={0} minH={{ lg: 0 }} display="flex" flexDirection="column">
      <Box
        ref={frameRef}
        position="relative"
        bg="black"
        w="100%"
        flex={{ lg: '1' }}
        h={{ base: 'clamp(180px, 42vw, 300px)', lg: 'auto' }}
        minH={{ lg: '180px' }}
        sx={{
          '&:fullscreen, &:-webkit-full-screen': {
            width: '100%',
            height: '100%',
            maxHeight: 'none',
          },
        }}
      >
        <video
          ref={videoRef}
          src={mediaDisplayUrl(item.videoUrl)}
          poster={item.thumbnailUrl ? mediaDisplayUrl(item.thumbnailUrl) : undefined}
          playsInline
          preload="auto"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
            filter: 'none',
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
              v.removeEventListener('seeked', fix)
              const d = takeFinite(v.duration)
              try { v.currentTime = 0 } catch { /* ignore */ }
              if (d) setDuration(d)
            }
            v.addEventListener('seeked', fix)
            try { v.currentTime = 1e101 } catch { /* ignore */ }
          }}
          onDurationChange={(e) => {
            const d = takeFinite(e.currentTarget.duration) || takeFinite(item.duration)
            if (d) setDuration(d)
          }}
          onPlay={(e) => {
            if (replyLockRef.current) {
              e.currentTarget.pause()
              return
            }
            setPlaying(true)
          }}
          onPause={() => {
            if (replyLockRef.current) return
            setPlaying(false)
          }}
        />


        {!iAmSender && !activeNote && (askNow || liveMarker?.type === 'reply') && (
          <Box position="absolute" left="max(56px, calc(env(safe-area-inset-left, 0px) + 9vw + 18px))" right="12px" bottom="max(8px, env(safe-area-inset-bottom, 0px))" bg="blackAlpha.800" color="white" px={3} py={2.5} borderRadius="xl">
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
        <Box position="absolute" inset={0} bg="black" display={activeNote ? 'block' : 'none'}>
          <video
            ref={noteVideoRef}
            playsInline
            preload="auto"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
            onClick={(e) => {
              e.stopPropagation()
              togglePlay()
            }}
            onPlay={() => {
              if (replyLockRef.current) setPlaying(true)
            }}
            onPause={() => {
              if (replyLockRef.current) setPlaying(false)
            }}
            onTimeUpdate={(e) => handleReplyTime(e.currentTarget.currentTime || 0)}
            onEnded={(e) => {
              const endedAt = e.currentTarget.currentTime || 0
              if (endedAt < 0.2) return
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
          <Flex position="absolute" top="10px" left="10px" right="10px" align="center" justify="space-between">
            <Text color="white" fontSize="xs" bg="blackAlpha.600" px={2.5} py={1} borderRadius="full" noOfLines={1}>
              Reply · {activeNote?.user?.name || activeNote?.user?.username || ''}
            </Text>
            <Button size="xs" borderRadius="full" bg="blackAlpha.600" color="white" onClick={() => closeOverlay(true)}>
              Close
            </Button>
          </Flex>
          {popReaction && String(popReaction.onNote) === String(activeNote?._id) && (
            <Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
              <Text fontSize="5xl">{popReaction.reaction}</Text>
            </Flex>
          )}
        </Box>
        <Box
          as="button"
          type="button"
          aria-label={videoFull ? 'Exit full video' : 'Watch full video'}
          position="absolute"
          left="max(8px, env(safe-area-inset-left, 0px))"
          bottom="max(8px, env(safe-area-inset-bottom, 0px))"
          zIndex={8}
          w="clamp(36px, 9vw, 44px)"
          h="clamp(36px, 9vw, 44px)"
          minW="36px"
          minH="36px"
          flexShrink={0}
          borderRadius="full"
          bg="blackAlpha.600"
          border="1px solid"
          borderColor="whiteAlpha.400"
          color="white"
          fontSize="clamp(16px, 4.2vw, 20px)"
          fontWeight="700"
          lineHeight="1"
          display="flex"
          alignItems="center"
          justifyContent="center"
          onClick={(e) => {
            e.stopPropagation()
            toggleVideoFull()
          }}
        >
          {videoFull ? '✕' : '⛶'}
        </Box>
      </Box>

      <Box bg={card} px={{ base: 3, md: 4 }} pt={3} pb={2} flexShrink={0}>
        <Flex align="center" mb={2}>
          <Button size="sm" onClick={togglePlay} borderRadius="full" minW="40px">
            {playing ? '❚❚' : '▶'}
          </Button>
          <Text fontSize="sm" color={muted} ml={2} fontVariantNumeric="tabular-nums">{fmtTime(now)}</Text>
          <Box flex="1" />
          <Text fontSize="sm" color={muted} fontVariantNumeric="tabular-nums">{fmtTime(dur)}</Text>
        </Flex>
        <Box
          ref={barRef}
          h="28px"
          bg="blackAlpha.200"
          borderRadius="full"
          position="relative"
          cursor="pointer"
          mb={3}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            dragRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seekTo(timeFromBar(e.clientX), { soft: true })
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return
            seekTo(timeFromBar(e.clientX), { soft: true })
          }}
          onPointerUp={(e) => {
            if (!dragRef.current) return
            dragRef.current = false
            seekTo(timeFromBar(e.clientX), { soft: false })
          }}
          onPointerCancel={(e) => {
            if (!dragRef.current) return
            dragRef.current = false
            seekTo(timeFromBar(e.clientX), { soft: false })
          }}
        >
          <Box position="absolute" left="0" right="0" top="11px" h="6px" bg="blackAlpha.300" borderRadius="full" />
          <Box position="absolute" left={0} top="11px" h="6px" w={`${Math.min(100, (now / dur) * 100)}%`} bg="blue.400" borderRadius="full" />
          <Box
            position="absolute"
            top="7px"
            left={`${Math.min(100, (now / dur) * 100)}%`}
            w="14px"
            h="14px"
            bg="white"
            borderRadius="full"
            border="2px solid"
            borderColor="blue.400"
            transform="translateX(-50%)"
            pointerEvents="none"
          />
          {(item.markers || []).map((m, i) => (
            <Box
              key={`m-${i}`}
              position="absolute"
              left={`${Math.min(98, (m.t / dur) * 100)}%`}
              top="50%"
              w="8px"
              h="8px"
              bg="yellow.300"
              borderRadius="full"
              transform="translate(-50%, -50%)"
              zIndex={2}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                seekTo(m.t)
              }}
            />
          ))}
          {notes.filter((n) => !n.onNote).map((n) => (
            <Flex
              key={n._id}
              position="absolute"
              left={`${Math.min(98, (n.t / dur) * 100)}%`}
              top="50%"
              transform="translate(-50%, -50%)"
              w="22px"
              h="22px"
              borderRadius="full"
              bg="white"
              align="center"
              justify="center"
              fontSize="13px"
              lineHeight="1"
              boxShadow="0 1px 4px rgba(0,0,0,0.25)"
              cursor="pointer"
              zIndex={2}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                goToNote(n)
              }}
            >
              {n.type === 'reaction' ? n.reaction : '🎥'}
            </Flex>
          ))}
        </Box>
      </Box>
      </Box>

      <Box
        w={{ base: '100%', lg: '320px' }}
        h={{ lg: '100%' }}
        flex={{ lg: '0 0 320px' }}
        alignSelf="stretch"
        minH={0}
        overflow={{ base: 'visible', lg: 'hidden' }}
        display="flex"
        flexDirection="column"
        bg={card}
        borderLeftWidth={{ lg: '1px' }}
        borderTopWidth={{ base: '1px', lg: 0 }}
        borderColor="whiteAlpha.200"
        px={3}
        pt={3}
        pb={2}
      >
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
            if (file) addVideoNote(file, true)
            else videoRef.current?.play().catch(() => {})
          }}
        />

        {(item.markers || []).some((m) => m.type === 'reply') && (
          <Box mb={3} flexShrink={0} maxH="88px" overflowY="auto">
            <Text fontSize="sm" fontWeight="bold" mb={1}>{iAmSender ? 'Reply here' : 'Asked you'}</Text>
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
                <Text fontSize="sm" flex="1">Reply or reaction here</Text>
                {iAmSender && (
                  <Button
                    size="xs"
                    variant="ghost"
                    color={muted}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeReplyHere(m.t)
                    }}
                  >
                    ✕
                  </Button>
                )}
              </Flex>
            ))}
          </Box>
        )}

        <Box flex={{ lg: '1' }} minH={{ lg: 0 }} display="flex" flexDirection="column" overflow="hidden">
          {notes.length > 0 && (
            <Text fontSize="sm" fontWeight="bold" mb={1} flexShrink={0}>Inside this video</Text>
          )}
          <Box flex={{ lg: '1' }} minH={{ lg: 0 }} maxH={{ base: '180px', lg: 'none' }} overflowY="auto" pr={1}>
            {notes.map((n) => (
              <Flex
                key={n._id}
                gap={2}
                align="center"
                py={1.5}
                cursor="pointer"
                onClick={() => goToNote(n)}
              >
                <Text w="44px" fontSize="sm" color={muted}>{fmtTime(n.t)}</Text>
                <Text fontSize="sm">{n.type === 'reaction' ? n.reaction : 'Video reply'}{n.onNote ? ' · on reply' : ''}</Text>
                <Text fontSize="sm" color={muted} noOfLines={1} flex="1">
                  {n.user?.name || n.user?.username || ''}
                </Text>
                {(n.type === 'reaction' || iAmSender || uidOf(n.user) === String(user?._id)) && (
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
        </Box>

        <Box
          display="grid"
          gridTemplateColumns="repeat(8, minmax(0, 1fr))"
          gap={{ base: 1.5, sm: 2 }}
          mt={{ lg: 'auto' }}
          pt={3}
          pb={3}
          flexShrink={0}
        >
          {REACTIONS.map((e) => (
            <Button
              key={e}
              variant="outline"
              borderRadius="full"
              w="100%"
              h={{ base: '38px', sm: '44px' }}
              minW={0}
              fontSize={{ base: '18px', sm: '22px' }}
              p={0}
              onClick={() => addReaction(e)}
            >
              {e}
            </Button>
          ))}
        </Box>
      </Box>
      </Flex>
    </Box>
  )
}

export default VideoMessageWatchPage
