import React,{useState,useRef,useContext,useEffect,useCallback} from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  Textarea,
  Text,
  Input,
  Image,
  CloseButton,
  Flex,
  Box,
  Button,
  SimpleGrid,
  useColorModeValue
} from "@chakra-ui/react";
import { BsFileImageFill } from "react-icons/bs";
import useShowToast from '../hooks/useShowToast.js'
import { compressVideo, needsCompression } from '../utils/videoCompress'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'
import { isCarouselPost, MAX_POST_CAROUSEL_IMAGES } from '../utils/postCarousel.js'

const MAX_CHAR = 500
const apiBase = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

const EditPost = ({post, isOpen, onClose, onUpdate}) => {
  const{user}=useContext(UserContext)
  const{setFollowPost}=useContext(PostContext)
  const isCollaborative = !!post?.isCollaborative
  const isCarousel = isCarouselPost(post)
  const captionOnlyEdit = isCollaborative
  
  const[postText,setPostText]=useState(post?.text || '')
  const[image,setImage]=useState(null)
  const[imagePreview,setImagePreview]=useState(post?.img || '')
  const[loading,setLoading]=useState(false)
  const[uploadProgress,setUploadProgress]=useState(0)
  const[isUploading,setIsUploading]=useState(false)
  const[carouselSlots,setCarouselSlots]=useState([])

  const imageInput = useRef()
  const carouselInputRef = useRef()
  const carouselReplaceIndexRef = useRef(-1)
  const showToast = useShowToast()
  const[remaingChar,setRemaingChar]=useState(MAX_CHAR - (post?.text?.length || 0))

  const resetCarouselSlots = useCallback(() => {
    if (!isCarouselPost(post)) {
      setCarouselSlots([])
      return
    }
    const urls = Array.isArray(post?.images) ? post.images.map(String).filter(Boolean) : []
    setCarouselSlots(urls.map((url, index) => ({
      key: `existing-${index}-${url}`,
      kind: 'existing',
      url,
    })))
  }, [post])

  useEffect(() => {
    if (post) {
      setPostText(post.text || '')
      setImagePreview(post.img || '')
      setRemaingChar(MAX_CHAR - (post.text?.length || 0))
      setImage(null)
      resetCarouselSlots()
    }
  }, [post, resetCarouselSlots])

  const handleTextChange = (e) => {
    const inputText = e.target.value
    if(inputText.length > MAX_CHAR){
      const tranc = inputText.slice(0,MAX_CHAR)
      setPostText(tranc)
      setRemaingChar(0)
    }else{
      setPostText(inputText)
      setRemaingChar(MAX_CHAR - inputText.length)
    }
  }

  const handleCarouselFile = (event) => {
    const picked = event.target.files?.[0]
    const replaceAt = carouselReplaceIndexRef.current
    carouselReplaceIndexRef.current = -1
    if (carouselInputRef.current) carouselInputRef.current.value = ''

    if (!picked) return
    if (!picked.type.startsWith('image/')) {
      showToast('Invalid file', 'Carousel posts only support photos', 'error')
      return
    }

    const newSlot = {
      key: `new-${Date.now()}-${Math.random()}`,
      kind: 'new',
      file: picked,
      preview: URL.createObjectURL(picked),
    }

    if (replaceAt >= 0) {
      setCarouselSlots((prev) => prev.map((slot, i) => (i === replaceAt ? newSlot : slot)))
    } else if (carouselSlots.length < MAX_POST_CAROUSEL_IMAGES) {
      setCarouselSlots((prev) => [...prev, newSlot])
    } else {
      showToast('Limit reached', `Maximum ${MAX_POST_CAROUSEL_IMAGES} photos`, 'error')
    }
  }

  const pickCarouselPhoto = (replaceIndex = -1) => {
    carouselReplaceIndexRef.current = replaceIndex
    carouselInputRef.current?.click()
  }

  const removeCarouselSlot = (index) => {
    setCarouselSlots((prev) => {
      const slot = prev[index]
      if (slot?.kind === 'new' && slot.preview?.startsWith('blob:')) {
        URL.revokeObjectURL(slot.preview)
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleImageChange = async (event) => {
    const file = event.target.files[0]
    
    if (!file) return

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      showToast("Invalid file type", "Please select an image or video file", "error")
      return
    }

    const maxSize = 100 * 1024 * 1024
    const fileSizeMB = file.size / (1024 * 1024)
    
    if (file.size > maxSize) {
      showToast("File too large", `File (${fileSizeMB.toFixed(1)}MB) exceeds the 100MB limit.`, "error")
      if (imageInput.current) imageInput.current.value = ''
      return
    }

    setImage(file)
    const previewURL = URL.createObjectURL(file)
    setImagePreview(previewURL)
    setUploadProgress(0)
    setIsUploading(false)

    if (needsCompression(file)) {
      setIsUploading(true)
      setUploadProgress(10)
      const compressionTimeout = setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        showToast("Compression taking too long", "Using original file.", "warning", 5000)
      }, 120000)
      
      try {
        showToast("Compressing video", "Please wait...", "info", 5000)
        const compressedFile = await compressVideo(file, {
          maxSizeMB: 95,
          quality: fileSizeMB > 50 ? 'low' : 'medium',
          timeout: 110000,
          progressCallback: (progress) => setUploadProgress(10 + (progress * 0.8)),
        })
        clearTimeout(compressionTimeout)
        setImage(compressedFile)
        if (previewURL.startsWith('blob:')) URL.revokeObjectURL(previewURL)
        setImagePreview(URL.createObjectURL(compressedFile))
        setUploadProgress(100)
        setIsUploading(false)
        showToast("Compression complete", "Video ready to upload", "success")
      } catch (error) {
        clearTimeout(compressionTimeout)
        setUploadProgress(0)
        setIsUploading(false)
        if (file.size > 100 * 1024 * 1024) {
          setImage(null)
          setImagePreview(post?.img || '')
          showToast("File too large", "File exceeds 100MB limit.", "error")
          if (imageInput.current) imageInput.current.value = ''
        } else {
          showToast("Compression failed", "You can still use the original video.", "warning", 5000)
        }
      }
    }
    
    if (imageInput.current) imageInput.current.value = ''
  }

  const handleRemoveImage = () => {
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImage(null)
    setImagePreview('')
    if (imageInput.current) imageInput.current.value = ''
  }

  const finishUpdate = (updatedPost) => {
    if (updatedPost && setFollowPost) {
      setFollowPost(prev => prev.map(p => p._id === post._id ? updatedPost : p))
    }
    showToast("Success", "Post updated successfully", "success")
    onClose()
    onUpdate?.(updatedPost)
    setImage(null)
    setUploadProgress(0)
    setLoading(false)
  }

  const handleUpdatePost = async() => {
    if (isUploading && !image) {
      showToast("Please wait", "File is still processing.", "warning")
      return
    }

    const trimmed = postText.trim()
    const hasRemoteMedia = isCarousel ? carouselSlots.length > 0 : !!imagePreview
    const willUploadNew = !captionOnlyEdit && !isCarousel && !!(image && image instanceof File)

    if (!trimmed && !hasRemoteMedia && !willUploadNew) {
      showToast("Error", "Post cannot be empty", "error")
      return
    }
    if (isCarousel && carouselSlots.length === 0 && !trimmed) {
      showToast("Error", "Post cannot be empty", "error")
      return
    }

    if (isCollaborative && image && image instanceof File) {
      showToast("Info", "Use “Change your photo” on the post to update your image.", "info")
      return
    }

    setLoading(true)
    setUploadProgress(0)
    
    try {
      if (isCarousel) {
        const formData = new FormData()
        formData.append('text', trimmed)
        const imageSlots = carouselSlots.map((slot) =>
          slot.kind === 'existing' ? { kind: 'keep', url: slot.url } : { kind: 'new' }
        )
        formData.append('imageSlots', JSON.stringify(imageSlots))
        for (const slot of carouselSlots) {
          if (slot.kind === 'new' && slot.file) {
            formData.append('images', slot.file)
          }
        }

        const res = await fetch(`${apiBase()}/api/post/carousel/${post._id}/images`, {
          method: 'PUT',
          credentials: 'include',
          body: formData,
        })
        const data = await res.json()
        if (res.ok && (data.post || data._id)) {
          finishUpdate(data.post ?? data)
        } else {
          showToast("Error", data.error || "Failed to update post", "error")
          setLoading(false)
        }
        return
      }

      const formData = new FormData()
      formData.append('text', postText)
      
      if (image && image instanceof File && !isCollaborative) {
        formData.append('file', image)
        
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress((e.loaded / e.total) * 100)
        })
        xhr.open('PUT', `${apiBase()}/api/post/${post._id}`)
        xhr.withCredentials = true
        xhr.timeout = 1200000
        
        xhr.ontimeout = () => {
          showToast("Upload timeout", "Please try again.", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        xhr.onerror = () => {
          showToast("Upload error", "Network error during upload.", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText)
              if (data.error) {
                showToast("Error", data.error, "error")
                setLoading(false)
                return
              }
              finishUpdate(data.post)
            } catch {
              showToast("Error", "Failed to parse server response", "error")
              setLoading(false)
            }
          } else {
            showToast("Error", "Failed to update post", "error")
            setLoading(false)
          }
        }
        xhr.send(formData)
      } else {
        const res = await fetch(`${apiBase()}/api/post/${post._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text: postText }),
        })
        const data = await res.json()
        if (res.ok && data.post) {
          finishUpdate(data.post)
        } else {
          showToast("Error", data.error || "Failed to update post", "error")
          setLoading(false)
        }
      }
    } catch(error){
      showToast("Error", error.message || error, "error")
      setLoading(false)
      setUploadProgress(0)
    }
  }

  const handleClose = () => {
    if (imagePreview && imagePreview.startsWith('blob:') && image) {
      URL.revokeObjectURL(imagePreview)
    }
    for (const slot of carouselSlots) {
      if (slot.kind === 'new' && slot.preview?.startsWith('blob:')) {
        URL.revokeObjectURL(slot.preview)
      }
    }
    setPostText(post?.text || '')
    setImagePreview(post?.img || '')
    setImage(null)
    setUploadProgress(0)
    setIsUploading(false)
    resetCarouselSlots()
    onClose()
  }

  const textColor = useColorModeValue('gray.800', 'white')
  
  return (
    <Modal isOpen={isOpen} onClose={handleClose} blockScrollOnMount={false} scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent maxH="90vh">
        <ModalHeader>Edit Post</ModalHeader>
        <ModalCloseButton />
        
        <ModalBody mb={6} overflowY="auto">
          <FormControl>
            <Textarea 
              placeholder="Post text goes here" 
              value={postText}
              onChange={handleTextChange}
            />
            
            <Text fontSize="sm" fontWeight="bold" textAlign="right" color="gray.500" mt={1}>
              {remaingChar}/{MAX_CHAR}
            </Text>

            {isCarousel ? (
              <>
                <Text fontSize="sm" color="gray.500" mt={3} mb={2}>
                  Edit photos (up to {MAX_POST_CAROUSEL_IMAGES}). Photos only.
                </Text>
                <Input
                  type="file"
                  accept="image/*"
                  hidden
                  ref={carouselInputRef}
                  onChange={handleCarouselFile}
                />
                <SimpleGrid columns={{ base: 2, md: 3 }} spacing={3}>
                  {carouselSlots.map((slot, index) => (
                    <Box key={slot.key} position="relative" borderRadius="md" overflow="hidden" bg="black">
                      <Image
                        src={slot.kind === 'existing' ? slot.url : slot.preview}
                        alt=""
                        w="full"
                        h="120px"
                        objectFit="cover"
                        cursor="pointer"
                        onClick={() => pickCarouselPhoto(index)}
                      />
                      <CloseButton
                        size="sm"
                        position="absolute"
                        top={1}
                        right={1}
                        bg="blackAlpha.600"
                        color="white"
                        onClick={() => removeCarouselSlot(index)}
                      />
                    </Box>
                  ))}
                </SimpleGrid>
                {carouselSlots.length < MAX_POST_CAROUSEL_IMAGES ? (
                  <Button size="sm" mt={3} leftIcon={<BsFileImageFill />} onClick={() => pickCarouselPhoto(-1)}>
                    Add photo
                  </Button>
                ) : null}
              </>
            ) : isCollaborative ? (
              <Text fontSize="sm" color="gray.500" mt={3}>
                To change your photo, use “Change your photo” on the post.
              </Text>
            ) : (
              <>
            <Input 
              type="file" 
              accept="image/*,video/*" 
              hidden 
              ref={imageInput} 
              onChange={handleImageChange} 
            />

            <Flex align="center" gap={2} mt={3}>
              <BsFileImageFill 
                onClick={() => imageInput.current.click()} 
                cursor="pointer" 
                fontSize="20px"
              />
              {imagePreview && (
                <Text fontSize="xs" color="gray.500">
                  {image ? 'New file selected' : 'Current file'}
                </Text>
              )}
            </Flex>
               
            {imagePreview && 
              <Flex mt={5} position="relative" w="full">
                {image?.type?.startsWith('video/') || (!image && post?.img && post.img.match(/\.(mp4|webm|ogg|mov)$/i) || post?.img?.includes('/video/upload/')) ? (
                  <Box as="video" src={imagePreview} controls maxH="400px" borderRadius="md" />
                ) : (
                  <Image src={imagePreview} alt="Preview" maxH="400px" borderRadius="md" />
                )}
                <CloseButton 
                  onClick={handleRemoveImage}
                  position="absolute" 
                  top={2} 
                  right={2} 
                  bg="gray.500"
                />
              </Flex>
            }
              </>
            )}
            
            {!isCollaborative && !isCarousel && uploadProgress > 0 && uploadProgress < 100 && (
              <Box mt={2}>
                <Text fontSize="xs" color={textColor} mb={1}>
                  Upload Progress: {Math.round(uploadProgress)}%
                </Text>
              </Box>
            )}
          </FormControl>
        </ModalBody>

        <ModalFooter>
          <Button colorScheme='gray' mr={3} onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            colorScheme='blue' 
            onClick={handleUpdatePost} 
            isLoading={loading}
            isDisabled={!postText.trim() && !(isCarousel ? carouselSlots.length > 0 : imagePreview)}
          >
            Update Post
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditPost
