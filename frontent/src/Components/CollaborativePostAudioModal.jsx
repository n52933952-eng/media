import React, { useState, useRef, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Text,
  Input,
  Flex,
  Box,
} from '@chakra-ui/react'
import useShowToast from '../hooks/useShowToast.js'
import { getPostCarouselAudio, isCarouselPost } from '../utils/postCarousel.js'

const apiBase = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

const CollaborativePostAudioModal = ({ isOpen, onClose, post, onSaved }) => {
  const showToast = useShowToast()
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [file, setFile] = useState(null)
  const inputRef = useRef()

  const hasExistingAudio = !!getPostCarouselAudio(post)
  const isCarousel = isCarouselPost(post)

  useEffect(() => {
    if (isOpen) setFile(null)
  }, [isOpen, post?._id])

  const handlePick = (e) => {
    const picked = e.target.files?.[0]
    if (!picked) return
    if (!picked.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg)$/i.test(picked.name)) {
      showToast('Invalid file', 'Please select an audio file (MP3, etc.)', 'error')
      return
    }
    setFile(picked)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleSave = async () => {
    if (!post?._id || !file) {
      showToast('Error', 'Please select an audio file', 'error')
      return
    }
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('audio', file)
      const res = await fetch(`${apiBase()}/api/post/collaborative/${post._id}/audio`, {
        method: 'PUT',
        credentials: 'include',
        body: formData,
      })
      const data = await res.json()
      const updated = data?.post ?? data
      if (res.ok && updated?._id) {
        showToast('Success', 'Music added', 'success')
        onSaved?.(updated)
        onClose()
      } else {
        showToast('Error', data.error || 'Failed to upload audio', 'error')
      }
    } catch (err) {
      showToast('Error', err.message || 'Failed to upload audio', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!post?._id || !hasExistingAudio) return
    setRemoving(true)
    try {
      const res = await fetch(`${apiBase()}/api/post/collaborative/${post._id}/audio`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json()
      const updated = data?.post ?? data
      if (res.ok && updated?._id) {
        showToast('Success', 'Music removed', 'success')
        onSaved?.(updated)
        onClose()
      } else {
        showToast('Error', data.error || 'Failed to remove audio', 'error')
      }
    } catch (err) {
      showToast('Error', err.message || 'Failed to remove audio', 'error')
    } finally {
      setRemoving(false)
    }
  }

  const busy = saving || removing

  return (
    <Modal isOpen={isOpen} onClose={onClose} blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{hasExistingAudio ? 'Change music' : 'Add music'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text fontSize="sm" color="gray.500" mb={4}>
            {isCarousel
              ? 'Optional background music for your carousel post (owner only).'
              : 'Optional background music for this collaborative post (owner only).'}
          </Text>
          <Input
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"
            hidden
            ref={inputRef}
            onChange={handlePick}
          />
          <Flex align="center" gap={2} mb={2}>
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} isDisabled={busy}>
              Pick audio file
            </Button>
            {file ? <Text fontSize="sm">🎵 {file.name}</Text> : null}
          </Flex>
        </ModalBody>
        <ModalFooter gap={2} flexWrap="wrap">
          {hasExistingAudio ? (
            <Button colorScheme="red" variant="ghost" onClick={handleRemove} isLoading={removing} mr="auto">
              Remove music
            </Button>
          ) : (
            <Box flex={1} />
          )}
          <Button onClick={onClose} isDisabled={busy}>Cancel</Button>
          <Button colorScheme="blue" onClick={handleSave} isLoading={saving} isDisabled={busy || !file}>
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default CollaborativePostAudioModal
