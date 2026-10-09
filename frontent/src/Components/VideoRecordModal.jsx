import React, { useEffect, useRef, useState } from 'react'
import {
  Button,
  Flex,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'
import useShowToast from '../hooks/useShowToast'

function pickMime() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) return t
  }
  return ''
}

const VideoRecordModal = ({ isOpen, onClose, onReady, maxSeconds = 30, title = 'Record video' }) => {
  const showToast = useShowToast()
  const liveRef = useRef(null)
  const streamRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const tickRef = useRef(null)
  const [live, setLive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const stopTracks = () => {
    streamRef.current?.getTracks?.().forEach((t) => t.stop())
    streamRef.current = null
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    recRef.current = null
    setLive(false)
    setRecording(false)
    setSeconds(0)
  }

  useEffect(() => {
    if (!isOpen) {
      stopTracks()
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {
            facingMode: 'user',
            width: { ideal: 720 },
            height: { ideal: 1280 },
            frameRate: { ideal: 24, max: 30 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (liveRef.current) liveRef.current.srcObject = stream
        setLive(true)
      } catch (e) {
        showToast('Camera', e?.message || 'Cannot open camera. Allow camera + mic, or pick a file.', 'error')
        onClose()
      }
    })()
    return () => {
      cancelled = true
      stopTracks()
    }
  }, [isOpen])

  const finish = (file) => {
    stopTracks()
    onClose()
    if (file) onReady(file)
  }

  const startRec = () => {
    const stream = streamRef.current
    if (!stream) return
    chunksRef.current = []
    const mime = pickMime()
    let rec
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900_000 }) : new MediaRecorder(stream)
    } catch {
      showToast('Error', 'This browser cannot record video. Pick a file instead.', 'error')
      return
    }
    recRef.current = rec
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm'
      const blob = new Blob(chunksRef.current, { type })
      const ext = type.includes('mp4') ? 'mp4' : 'webm'
      const file = new File([blob], `video-message-${Date.now()}.${ext}`, { type })
      finish(file)
    }
    rec.start(250)
    setRecording(true)
    setSeconds(0)
    tickRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1
        if (next >= maxSeconds) {
          recRef.current?.state === 'recording' && recRef.current.stop()
        }
        return next
      })
    }, 1000)
  }

  const stopRec = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop()
  }

  return (
    <Modal isOpen={isOpen} onClose={() => finish(null)} isCentered size="sm">
      <ModalOverlay bg="blackAlpha.800" />
      <ModalContent bg="#111" color="white" overflow="hidden">
        <ModalBody p={0}>
          <Text px={4} pt={3} pb={2} fontWeight="bold">{title}</Text>
          <video
            ref={liveRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', background: '#000' }}
          />
          <Flex px={4} py={3} align="center" justify="space-between" gap={2}>
            <Text fontSize="sm" color={recording ? 'red.300' : 'whiteAlpha.700'}>
              {live ? (recording ? `● ${seconds}s / ${maxSeconds}s` : 'Ready') : 'Opening camera…'}
            </Text>
            {recording ? (
              <Button colorScheme="red" size="sm" onClick={stopRec}>Stop</Button>
            ) : (
              <Button colorScheme="red" size="sm" isDisabled={!live} onClick={startRec}>
                Record
              </Button>
            )}
            <Button size="sm" variant="ghost" color="white" onClick={() => finish(null)}>Cancel</Button>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default VideoRecordModal
