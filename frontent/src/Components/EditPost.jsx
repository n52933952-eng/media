import React,{useState,useRef,useContext,useEffect} from 'react'
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
  useColorModeValue
} from "@chakra-ui/react";
import { BsFileImageFill } from "react-icons/bs";
import useShowToast from '../hooks/useShowToast.js'
import { compressVideo, needsCompression } from '../utils/videoCompress'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'

const MAX_CHAR = 500

const EditPost = ({post, isOpen, onClose, onUpdate}) => {
  const{user}=useContext(UserContext)
  const{setFollowPost}=useContext(PostContext)
  
  const[postText,setPostText]=useState(post?.text || '')
  const[image,setImage]=useState(null) // File object for new image
  const[imagePreview,setImagePreview]=useState(post?.img || '') // Preview URL (existing or new)
  const[loading,setLoading]=useState(false)
  const[uploadProgress,setUploadProgress]=useState(0)
  const[isUploading,setIsUploading]=useState(false)

  const imageInput = useRef()
  const showToast = useShowToast()
  const[remaingChar,setRemaingChar]=useState(MAX_CHAR - (post?.text?.length || 0))

  // Update state when post changes
  useEffect(() => {
    if (post) {
      setPostText(post.text || '')
      setImagePreview(post.img || '')
      setRemaingChar(MAX_CHAR - (post.text?.length || 0))
      setImage(null) // Reset new image
    }
  }, [post])

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

  const handleImageChange = async (event) => {
    const file = event.target.files[0]
    
    if (!file) return

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      showToast("Invalid file type", "Please select an image or video file", "error")
      return
    }

    const maxSize = 100 * 1024 * 1024 // 100MB
    const fileSizeMB = file.size / (1024 * 1024)
    
    if (file.size > maxSize) {
      showToast("File too large", `File (${fileSizeMB.toFixed(1)}MB) exceeds Cloudinary's 100MB limit. Please compress the file or use a smaller one.`, "error")
      if (imageInput.current) {
        imageInput.current.value = ''
      }
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
        console.warn('⚠️ Compression timeout - using original file')
        setIsUploading(false)
        setUploadProgress(0)
        showToast("Compression taking too long", "You can use the original video. Compression will be skipped.", "warning", 5000)
      }, 120000)
      
      try {
        showToast("Compressing video", "Please wait while we compress your video...", "info", 5000)
        
        const compressedFile = await compressVideo(file, {
          maxSizeMB: 95,
          quality: fileSizeMB > 50 ? 'low' : 'medium',
          timeout: 110000,
          progressCallback: (progress) => {
            setUploadProgress(10 + (progress * 0.8))
          }
        })
        
        clearTimeout(compressionTimeout)
        const compressedSizeMB = compressedFile.size / (1024 * 1024)
        console.log(`✅ Video compressed: ${fileSizeMB.toFixed(2)}MB → ${compressedSizeMB.toFixed(2)}MB`)
        
        setImage(compressedFile)
        if (previewURL && previewURL.startsWith('blob:')) {
          URL.revokeObjectURL(previewURL)
        }
        const newPreviewURL = URL.createObjectURL(compressedFile)
        setImagePreview(newPreviewURL)
        
        setUploadProgress(100)
        setIsUploading(false)
        showToast("Compression complete", `Video compressed to ${compressedSizeMB.toFixed(2)}MB`, "success")
      } catch (error) {
        clearTimeout(compressionTimeout)
        console.error('❌ Video compression error:', error)
        setUploadProgress(0)
        setIsUploading(false)
        
        if (file.size > 100 * 1024 * 1024) {
          setImage(null)
          setImagePreview(post?.img || '') // Restore original
          showToast("File too large", "File exceeds 100MB limit.", "error")
          if (imageInput.current) {
            imageInput.current.value = ''
          }
        } else {
          showToast("Compression failed", "You can still use the original video.", "warning", 5000)
        }
      }
    } else if (file.type.startsWith('video/')) {
      console.log(`✅ Video ${fileSizeMB.toFixed(2)}MB is under 50MB - ready to upload without compression`)
    }
    
    if (imageInput.current) {
      imageInput.current.value = ''
    }
  }

  const handleRemoveImage = () => {
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImage(null)
    setImagePreview('')
    if (imageInput.current) {
      imageInput.current.value = ''
    }
  }

  const handleUpdatePost = async() => {
    if (isUploading && !image) {
      showToast("Please wait", "File is still processing. Please wait for it to complete.", "warning")
      return
    }
    
    if (isUploading && image) {
      console.log('⚠️ Compression in progress, but proceeding with update using available file')
      setIsUploading(false)
      setUploadProgress(0)
    }

    if (!postText.trim() && !imagePreview) {
      showToast("Error", "Post cannot be empty", "error")
      return
    }

    setLoading(true)
    setUploadProgress(0)
    
    try {
      const formData = new FormData()
      formData.append('text', postText)
      
      // Only include file if user selected a new one
      if (image && image instanceof File) {
        formData.append('file', image)
        
        const xhr = new XMLHttpRequest()
        
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setUploadProgress((e.loaded / e.total) * 100)
          }
        })
        
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            setUploadProgress(100)
          }
        })
        
        xhr.open('PUT', `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${post._id}`)
        xhr.withCredentials = true
        xhr.timeout = 1200000 // 20 minutes
        
        xhr.ontimeout = () => {
          showToast("Upload timeout", "Video upload is taking longer than expected. Please try again or use a smaller video.", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        
        xhr.onerror = () => {
          showToast("Upload error", "Network error during upload. Please check your connection and try again.", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        
        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText)
              
              if(data.error){
                showToast("Error", data.error, "error")
                setLoading(false)
                setUploadProgress(0)
                return
              }

              // Update post in feed
              if (data.post && setFollowPost) {
                setFollowPost(prev => prev.map(p => p._id === post._id ? data.post : p))
              }

              showToast("Success", "Post updated successfully", "success")
              onClose()
              
              if (onUpdate) {
                onUpdate(data.post)
              }
              
              // Reset state
              setImage(null)
              setUploadProgress(0)
              setLoading(false)
            } catch (error) {
              showToast("Error", "Failed to parse server response", "error")
              setLoading(false)
              setUploadProgress(0)
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText)
              showToast("Error", errorData.error || "Failed to update post", "error")
            } catch (error) {
              showToast("Error", "Failed to update post", "error")
            }
            setLoading(false)
            setUploadProgress(0)
          }
        }
        
        xhr.send(formData)
      } else {
        // No file upload - just update text
        const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${post._id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ text: postText })
        })

        const data = await res.json()

        if(res.ok && data.post){
          // Update post in feed
          if (setFollowPost) {
            setFollowPost(prev => prev.map(p => p._id === post._id ? data.post : p))
          }

          showToast("Success", "Post updated successfully", "success")
          onClose()
          
          if (onUpdate) {
            onUpdate(data.post)
          }
        } else {
          showToast("Error", data.error || "Failed to update post", "error")
        }
        setLoading(false)
      }
    } catch(error){
      showToast("Error", error.message || error, "error")
      setLoading(false)
      setUploadProgress(0)
    }
  }

  const handleClose = () => {
    // Clean up preview URL if it's a blob
    if (imagePreview && imagePreview.startsWith('blob:') && image) {
      URL.revokeObjectURL(imagePreview)
    }
    // Reset to original values
    setPostText(post?.text || '')
    setImagePreview(post?.img || '')
    setImage(null)
    setUploadProgress(0)
    setIsUploading(false)
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
            
            {uploadProgress > 0 && uploadProgress < 100 && (
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
            isDisabled={!postText.trim() && !imagePreview}
          >
            Update Post
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditPost
