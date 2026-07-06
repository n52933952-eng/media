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
  Image,
  Input,
  Flex,
  Box,
} from '@chakra-ui/react'
import { BsFileImageFill } from 'react-icons/bs'
import useShowToast from '../hooks/useShowToast.js'
import { UserContext } from '../context/UserContext'
import { useContext } from 'react'
import { getMyCollaboratorImage } from '../utils/postCarousel.js'

const apiBase = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

const AddCollaboratorPhotoModal = ({ isOpen, onClose, post, onSaved }) => {
  const { user } = useContext(UserContext)
  const showToast = useShowToast()
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState('')
  const [file, setFile] = useState(null)
  const inputRef = useRef()

  const currentUserId = user?._id != null ? String(user._id) : ''
  const hasExistingPhoto = !!getMyCollaboratorImage(post, currentUserId)

  useEffect(() => {
    if (isOpen) {
      setFile(null)
      setPreview('')
    }
  }, [isOpen, post?._id])

  const handlePick = (e) => {
    const picked = e.target.files?.[0]
    if (!picked) return
    if (!picked.type.startsWith('image/')) {
      showToast('Invalid file', 'Collaborative posts only support photos', 'error')
      return
    }
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleSave = async () => {
    if (!post?._id || !file) {
      showToast('Error', 'Please select a photo', 'error')
      return
    }
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${apiBase()}/api/post/collaborative/${post._id}/contributor-image`, {
        method: 'PUT',
        credentials: 'include',
        body: formData,
      })
      const data = await res.json()
      const updated = data?.post ?? data
      if (res.ok && updated?._id) {
        showToast('Success', hasExistingPhoto ? 'Photo updated' : 'Photo added', 'success')
        onSaved?.(updated)
        onClose()
      } else {
        showToast('Error', data.error || 'Failed to upload photo', 'error')
      }
    } catch (err) {
      showToast('Error', err.message || 'Failed to upload photo', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{hasExistingPhoto ? 'Change your photo' : 'Add your photo'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text fontSize="sm" color="gray.500" mb={4}>
            One photo per person on collaborative posts. Photos only — no videos.
          </Text>
          <Input type="file" accept="image/*" hidden ref={inputRef} onChange={handlePick} />
          <Flex align="center" gap={2} mb={3}>
            <BsFileImageFill onClick={() => inputRef.current?.click()} cursor="pointer" fontSize="20px" />
            <Text fontSize="sm">{file ? file.name : 'Select photo'}</Text>
          </Flex>
          {preview ? (
            <Box borderRadius="md" overflow="hidden" bg="black">
              <Image src={preview} alt="" maxH="320px" w="full" objectFit="contain" />
            </Box>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button mr={3} onClick={handleClose}>Cancel</Button>
          <Button colorScheme="blue" onClick={handleSave} isLoading={saving} isDisabled={!file}>
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default AddCollaboratorPhotoModal
