import React, { useRef, useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  Text,
  Textarea,
  Flex,
  Box,
  Image,
  CloseButton,
  Progress,
  useColorModeValue,
} from '@chakra-ui/react'
import useShowToast from '../hooks/useShowToast.js'
import API_BASE_URL from '../config/api'
import { compressVideo, needsCompression } from '../utils/videoCompress'

const MAX_FILES = 20
const MAX_CAPTION = 300

export default function AddStoryModal({ isOpen, onClose, onPosted }) {
  const showToast = useShowToast()
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [caption, setCaption] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  const reset = () => {
    setPreviews((prev) => {
      prev.forEach((u) => {
        if (u && String(u).startsWith('blob:')) URL.revokeObjectURL(u)
      })
      return []
    })
    setFiles([])
    setCaption('')
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (loading) return
    reset()
    onClose()
  }

  const removeAt = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setPreviews((prev) => {
      const url = prev[index]
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleFileChange = async (e) => {
    const picked = Array.from(e.target.files || [])
    if (fileInputRef.current) fileInputRef.current.value = ''

    if (!picked.length) return

    const next = [...files]
    const nextPreviews = [...previews]

    for (const file of picked) {
      if (next.length >= MAX_FILES) {
        showToast('Limit', `You can add up to ${MAX_FILES} items per upload.`, 'error')
        break
      }
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        showToast('Invalid file', `${file.name} is not an image or video.`, 'error')
        continue
      }
      const maxSize = 100 * 1024 * 1024
      if (file.size > maxSize) {
        showToast('Too large', `${file.name} exceeds 100MB.`, 'error')
        continue
      }

      let useFile = file
      if (file.type.startsWith('video/') && needsCompression(file)) {
        try {
          showToast('Compressing', `Optimizing ${file.name}…`, 'info')
          useFile = await compressVideo(file, {
            maxSizeMB: 95,
            quality: file.size / (1024 * 1024) > 50 ? 'low' : 'medium',
            timeout: 110000,
          })
        } catch {
          if (file.size <= maxSize) {
            useFile = file
          } else {
            showToast('Skip', `${file.name} could not be compressed.`, 'warning')
            continue
          }
        }
      }

      next.push(useFile)
      nextPreviews.push(URL.createObjectURL(useFile))
    }

    setFiles(next)
    setPreviews(nextPreviews)
  }

  const submit = () => {
    if (!files.length) {
      showToast('Add media', 'Choose at least one photo or video.', 'error')
      return
    }

    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    const t = caption.trim().slice(0, MAX_CAPTION)
    if (t) fd.append('text', t)

    setLoading(true)
    setProgress(0)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/api/story/create`)
    xhr.withCredentials = true
    xhr.timeout = 1_200_000

    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) setProgress((ev.loaded / ev.total) * 100)
    })

    xhr.onload = () => {
      setLoading(false)
      setProgress(0)
      try {
        const data = JSON.parse(xhr.responseText || '{}')
        if (xhr.status >= 200 && xhr.status < 300 && !data.error) {
          showToast('Story', 'Your story was shared.', 'success')
          window.dispatchEvent(new CustomEvent('storyStripChanged'))
          onPosted?.()
          reset()
          onClose()
        } else {
          showToast('Error', data.error || 'Could not create story', 'error')
        }
      } catch {
        showToast('Error', 'Could not create story', 'error')
      }
    }

    xhr.onerror = () => {
      setLoading(false)
      setProgress(0)
      showToast('Error', 'Network error while uploading.', 'error')
    }

    xhr.ontimeout = () => {
      setLoading(false)
      setProgress(0)
      showToast('Timeout', 'Upload took too long. Try fewer or smaller files.', 'error')
    }

    xhr.send(fd)
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" isCentered>
      <ModalOverlay />
      <ModalContent bg={useColorModeValue('white', 'gray.900')}>
        <ModalHeader>Add to your story</ModalHeader>
        <ModalCloseButton isDisabled={loading} />
        <ModalBody>
          <Text fontSize="sm" color="gray.500" mb={3}>
            Photos or short videos (max 20s each on the server). Up to {MAX_FILES} items.
          </Text>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            isDisabled={loading}
            mb={3}
          >
            Choose files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={handleFileChange}
          />

          {!!files.length && (
            <Flex wrap="wrap" gap={2} mb={4}>
              {files.map((f, i) => (
                <Box
                  key={`${f.name}-${i}`}
                  position="relative"
                  w="72px"
                  h="72px"
                  borderRadius="md"
                  overflow="hidden"
                  borderWidth="1px"
                  borderColor={border}
                >
                  {f.type.startsWith('video/') ? (
                    <Box
                      as="video"
                      src={previews[i]}
                      w="100%"
                      h="100%"
                      objectFit="cover"
                      muted
                      playsInline
                    />
                  ) : (
                    <Image src={previews[i]} w="100%" h="100%" objectFit="cover" alt="" />
                  )}
                  <CloseButton
                    size="sm"
                    position="absolute"
                    top={0}
                    right={0}
                    bg="blackAlpha.700"
                    color="white"
                    _hover={{ bg: 'blackAlpha.800' }}
                    onClick={() => removeAt(i)}
                    isDisabled={loading}
                  />
                </Box>
              ))}
            </Flex>
          )}

          <Text fontSize="xs" color="gray.500" mb={1}>
            Caption (optional, applies to all slides)
          </Text>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
            placeholder="Write something…"
            rows={3}
            isDisabled={loading}
          />
          {loading && (
            <Box mt={3}>
              <Progress value={progress} size="sm" borderRadius="md" hasStripe isAnimated />
            </Box>
          )}
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={handleClose} isDisabled={loading}>
            Cancel
          </Button>
          <Button colorScheme="blue" onClick={submit} isLoading={loading} isDisabled={!files.length}>
            Share story
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
