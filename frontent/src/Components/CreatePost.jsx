import React,{useState,useRef,useContext} from 'react'
import{AddIcon} from '@chakra-ui/icons'

import {Button,useColorModeValue,useDisclosure,

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
  Checkbox,
  Wrap,
  WrapItem,
  Badge
} from "@chakra-ui/react";

import { BsFileImageFill } from "react-icons/bs";
import useShowToast from '../hooks/useShowToast.js'
import { compressVideo, needsCompression } from '../utils/videoCompress'
import API_BASE_URL from '../config/api'
import { buildInitialContributorIds } from '../utils/collaborators'
import CollaboratorPicker from './CollaboratorPicker'

import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'


const MAX_CHAR = 500


const CreatePost = () => {
 
   const{user}=useContext(UserContext)
   const{setFollowPost}=useContext(PostContext)
   
   const{isOpen,onOpen,onClose}=useDisclosure()
   
    const[postText,setPostText]=useState('')
    const[image,setImage]=useState(null) // File object or Supabase URL object
    const[imagePreview,setImagePreview]=useState('') // Preview URL
    const[loading,setLoading]=useState(false)
    const[uploadProgress,setUploadProgress]=useState(0)
    const[isUploading,setIsUploading]=useState(false)
    const[isCollaborative,setIsCollaborative]=useState(false)
    const [selectedCollaborators, setSelectedCollaborators] = useState([])
    const [carouselFiles, setCarouselFiles] = useState([])
    const [carouselPreviews, setCarouselPreviews] = useState([])
    const [audioFile, setAudioFile] = useState(null)

    const imageInput = useRef()
    const carouselInput = useRef()
    const audioInput = useRef()

   
     const showToast = useShowToast()

 
    const[remaingChar,setRemaingChar]=useState(MAX_CHAR)
 
   
    const handleTextChnage = (e) =>{
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

    // Check if file is image or video
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      showToast("Invalid file type", "Please select an image or video file", "error")
      return
    }

    if (isCollaborative && file.type.startsWith('video/')) {
      showToast('Error', 'Collaborative posts only support photos, not videos.', 'error')
      if (imageInput.current) imageInput.current.value = ''
      return
    }

    // Check file size (100MB upload limit)
    const maxSize = 100 * 1024 * 1024 // 100MB
    const fileSizeMB = file.size / (1024 * 1024)
    
    if (file.size > maxSize) {
      showToast("File too large", `File (${fileSizeMB.toFixed(1)}MB) exceeds the 100MB limit. Please compress the file or use a smaller one.`, "error")
      if (imageInput.current) {
        imageInput.current.value = ''
      }
      return
    }

    // Store file for preview
    setCarouselFiles([])
    carouselPreviews.forEach((u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u) })
    setCarouselPreviews([])
    setAudioFile(null)
    setImage(file)
    const previewURL = URL.createObjectURL(file)
    setImagePreview(previewURL)
    setUploadProgress(0)
    setIsUploading(false)

    // Compress video if needed (non-blocking - allows posting original if compression fails)
    if (needsCompression(file)) {
      setIsUploading(true)
      setUploadProgress(10)
      
      // Set compression timeout (2 minutes max)
      const compressionTimeout = setTimeout(() => {
        console.warn('⚠️ Compression timeout - using original file')
        setIsUploading(false)
        setUploadProgress(0)
        showToast("Compression taking too long", "You can post the original video. Compression will be skipped.", "warning", 5000)
      }, 120000) // 2 minutes timeout
      
      try {
        showToast("Compressing video", "Please wait while we compress your video... You can still post if it takes too long.", "info", 5000)
        
        const compressedFile = await compressVideo(file, {
          maxSizeMB: 95,
          quality: fileSizeMB > 50 ? 'low' : 'medium',
          timeout: 110000, // Slightly less than UI timeout
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
        
        // Don't clear the image - allow user to post original file
        // Only clear if file is too large (100MB limit)
        if (file.size > 100 * 1024 * 1024) {
          setImage(null)
          setImagePreview('')
          showToast("File too large", "File exceeds 100MB limit. Please use a smaller video.", "error")
          if (imageInput.current) {
            imageInput.current.value = ''
          }
        } else {
          // Keep original file - user can post it
          showToast("Compression failed", "You can still post the original video. It may take longer to upload.", "warning", 5000)
          console.log('✅ Keeping original file for upload')
        }
      }
    } else if (file.type.startsWith('video/')) {
      // Video under 50MB - no compression needed, ready to upload
      console.log(`✅ Video ${fileSizeMB.toFixed(2)}MB is under 50MB - ready to upload without compression`)
    }
    
    // Reset input value
    if (imageInput.current) {
      imageInput.current.value = ''
    }
  }













  const clearSingleImageMedia = () => {
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setImage(null)
    setImagePreview('')
    if (imageInput.current) imageInput.current.value = ''
  }

  const enableCollaborativeMode = () => {
    const hadCarousel = carouselFiles.length > 0 || !!audioFile
    const hadVideo = image?.type?.startsWith('video/')
    clearCarouselMedia()
    if (hadVideo) {
      clearSingleImageMedia()
      showToast('Collaborative posts', 'Videos removed — one photo per person only.', 'info')
    } else if (hadCarousel) {
      showToast('Collaborative posts', 'Carousel and music removed — one photo per person only.', 'info')
    }
  }

  const handleCarouselChange = (event) => {
    if (isCollaborative) {
      showToast('Not available', 'Collaborative posts use one photo per person — no carousel.', 'info')
      if (carouselInput.current) carouselInput.current.value = ''
      return
    }
    const files = Array.from(event.target.files || []).slice(0, 4)
    if (!files.length) return
    if (files.some((f) => !f.type.startsWith('image/'))) {
      showToast('Invalid file type', 'Carousel posts support photos only (up to 4)', 'error')
      return
    }
    carouselPreviews.forEach((u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u) })
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setImage(null)
    setImagePreview('')
    setCarouselFiles(files)
    setCarouselPreviews(files.map((f) => URL.createObjectURL(f)))
    if (carouselInput.current) carouselInput.current.value = ''
  }

  const handleAudioChange = async (event) => {
    if (isCollaborative) {
      showToast('Not available', 'Collaborative posts cannot include music.', 'info')
      if (audioInput.current) audioInput.current.value = ''
      return
    }
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('audio/')) {
      showToast('Invalid file type', 'Please select an MP3 or audio file', 'error')
      return
    }
    const url = URL.createObjectURL(file)
    try {
      const durationSec = await new Promise((resolve, reject) => {
        const audio = new Audio()
        audio.preload = 'metadata'
        audio.onloadedmetadata = () => resolve(audio.duration)
        audio.onerror = () => reject(new Error('Could not read audio'))
        audio.src = url
      })
      if (typeof durationSec === 'number' && durationSec > 4 * 60 + 0.5) {
        showToast('Music too long', 'Music must be 4 minutes or less', 'error')
        return
      }
      setAudioFile(file)
    } catch {
      showToast('Error', 'Could not read audio file', 'error')
    } finally {
      URL.revokeObjectURL(url)
      if (audioInput.current) audioInput.current.value = ''
    }
  }

  const clearCarouselMedia = () => {
    carouselPreviews.forEach((u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u) })
    setCarouselFiles([])
    setCarouselPreviews([])
    setAudioFile(null)
  }

   const handleCreatePost = async() => {
     // Allow posting even if compression is in progress (will use original file)
     // Only block if no file is selected at all
     if (isUploading && !image) {
       showToast("Please wait", "File is still processing. Please wait for it to complete.", "warning")
       return
     }
     
     // If compression is still running but we have a file, cancel compression and use original
     if (isUploading && image) {
       console.log('⚠️ Compression in progress, but proceeding with upload using available file')
       setIsUploading(false)
       setUploadProgress(0)
     }

     if (isCollaborative) {
       if (carouselFiles.length > 0 || audioFile) {
         showToast('Error', 'Collaborative posts cannot include multiple photos or music.', 'error')
         return
       }
       if (image?.type?.startsWith('video/')) {
         showToast('Error', 'Collaborative posts only support photos, not videos.', 'error')
         return
       }
     }

     setLoading(true)
     setUploadProgress(0)
     
  try{
    // Upload file via backend (R2 storage)
    const formData = new FormData()
    formData.append('postedBy', user._id)
    formData.append('text', postText)
    if (isCollaborative) {
      formData.append('isCollaborative', 'true')
      formData.append(
        'contributors',
        JSON.stringify(buildInitialContributorIds(user?._id, selectedCollaborators))
      )
    }
    
    if (carouselFiles.length > 0) {
      carouselFiles.forEach((f) => formData.append('images', f))
      if (audioFile) formData.append('audio', audioFile)

      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setUploadProgress((e.loaded / e.total) * 100)
      })
      xhr.open('POST', `${API_BASE_URL}/api/post/create`)
      xhr.withCredentials = true
      xhr.timeout = 1200000
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText)
            if (data.error) {
              showToast('Error', data.error, 'error')
              setLoading(false)
              return
            }
            if (data.post && setFollowPost) {
              const newPost = {
                ...data.post,
                postedBy: data.post.postedBy || {
                  _id: user._id,
                  username: user.username,
                  name: user.name,
                  profilePic: user.profilePic,
                },
              }
              setFollowPost((prev) => {
                const exists = prev.some((p) => p._id?.toString() === newPost._id?.toString())
                return exists ? prev : [newPost, ...prev]
              })
            }
            showToast('Success', 'Post created successfully', 'success')
            onClose()
            setPostText('')
            clearCarouselMedia()
            if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
            setImage(null)
            setImagePreview('')
            setUploadProgress(0)
            setIsCollaborative(false)
            setSelectedCollaborators([])
            setLoading(false)
          } catch {
            showToast('Error', 'Failed to parse server response', 'error')
            setLoading(false)
          }
        } else {
          showToast('Error', 'Failed to create post', 'error')
          setLoading(false)
        }
      }
      xhr.onerror = () => {
        showToast('Error', 'Network error while creating post', 'error')
        setLoading(false)
      }
      xhr.send(formData)
      return
    }

    if (image) {
      // Check if image is a File object (needs upload) or URL string
      if (image instanceof File) {
        formData.append('file', image)
        
        // Track upload progress
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
        
        xhr.open('POST', `${API_BASE_URL}/api/post/create`)
        xhr.withCredentials = true
        xhr.timeout = 1200000 // 20 minutes for large video uploads
        
        // Handle timeout
        xhr.ontimeout = () => {
          showToast("Upload timeout", "Video upload is taking longer than expected. Please try again or use a smaller video.", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        
        // Handle network errors
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

              // Immediately add the new post to the top of the feed (simple state update)
              if (data.post && setFollowPost) {
                // Populate the post with user data if not already populated
                const newPost = {
                  ...data.post,
                  postedBy: data.post.postedBy || {
                    _id: user._id,
                    username: user.username,
                    name: user.name,
                    profilePic: user.profilePic
                  }
                }
                
                // Simple: just add to the top
                setFollowPost(prev => {
                  // Check if post already exists (prevent duplicates)
                  const exists = prev.some(p => p._id?.toString() === newPost._id?.toString())
                  if (exists) {
                    return prev
                  }
                  // Add new post at the top
                  return [newPost, ...prev]
                })
              }

              showToast("Success", "Post created successfully", "success")
              onClose()
              setPostText("")
              if (imagePreview && imagePreview.startsWith('blob:')) {
                URL.revokeObjectURL(imagePreview)
              }
              setImage(null)
              setImagePreview("")
              setUploadProgress(0)
              setIsCollaborative(false)
              setSelectedCollaborators([])
              setLoading(false)
            } catch (error) {
              showToast("Error", "Failed to parse server response", "error")
              setLoading(false)
              setUploadProgress(0)
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText)
              showToast("Error", errorData.error || "Failed to create post", "error")
            } catch (error) {
              showToast("Error", "Failed to create post", "error")
            }
            setLoading(false)
            setUploadProgress(0)
          }
        }
        
        xhr.onerror = () => {
          showToast("Error", "Network error while creating post", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        
        xhr.ontimeout = () => {
          showToast("Error", "Upload timeout. Please try again.", "error")
          setLoading(false)
          setUploadProgress(0)
        }
        
        xhr.send(formData)
        return // Exit early, response handled in xhr callbacks
      } else {
        // Image is already a URL (shouldn't happen, but handle it)
        formData.append('fileUrl', image)
      }
    }

    // No file - just send post data
    const res = await fetch(`${API_BASE_URL}/api/post/create`,{
      credentials: "include",
      method:"POST",
      body: formData
    })

    const data = await res.json()

    if(data.error){
      showToast("Error", data.error, "error")
      setLoading(false)
      return
    }

    // Immediately add the new post to the top of the feed (simple state update)
    if (data.post && setFollowPost) {
      // Populate the post with user data if not already populated
      const newPost = {
        ...data.post,
        postedBy: data.post.postedBy || {
          _id: user._id,
          username: user.username,
          name: user.name,
          profilePic: user.profilePic
        }
      }
      
      // Simple: just add to the top
      setFollowPost(prev => {
        // Check if post already exists (prevent duplicates)
        const exists = prev.some(p => p._id?.toString() === newPost._id?.toString())
        if (exists) {
          return prev
        }
        // Add new post at the top
        return [newPost, ...prev]
      })
    }

    showToast("Success", "Post created successfully", "success")
    onClose()
    setPostText("")
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImage(null)
    setImagePreview("")
    setUploadProgress(0)
    setIsCollaborative(false)
    setSelectedCollaborators([])
    setLoading(false)
  }
  catch(error){
    showToast("Error", error.message || error, "error")
    setLoading(false)
    setUploadProgress(0)
  }


}








    return (
   
   <>

   <Button position="fixed" 
   bg={useColorModeValue("gray.300","gray.dark")}
   right={5}
   bottom={10}
   onClick={onOpen}
   >
    
    <AddIcon/>
   
    
    
    
    
     <Modal
        isOpen={isOpen}
        onClose={() => {
          setSelectedCollaborators([])
          onClose()
        }}
        blockScrollOnMount={false}
        scrollBehavior="inside"
      >
        <ModalOverlay />
       
        <ModalContent maxH="90vh">
          <ModalHeader>Create Post</ModalHeader>
         
          <ModalCloseButton />
          
         
         
          <ModalBody mb={6} overflowY="auto">
           <FormControl>
           
         <Textarea placeholder="post text gose here" value={postText}onChange={handleTextChnage}/>
          
          
          
            <Text fontSize="sm" fontWeight="bold" textAlign="right" color="gray.500">{remaingChar}/{MAX_CHAR}</Text>
         
            <Checkbox 
              mt={3} 
              isChecked={isCollaborative}
              onChange={(e) => {
                const next = e.target.checked
                if (next) enableCollaborativeMode()
                setIsCollaborative(next)
                if (!next) setSelectedCollaborators([])
              }}
            >
              <Text fontSize="sm">🤝 Make this a collaborative post (others can contribute)</Text>
            </Checkbox>

            {isCollaborative && (
              <Text fontSize="xs" color="gray.500" mt={2}>
                One photo per person — add yours now; contributors add theirs later. No carousel or music.
              </Text>
            )}

            {isCollaborative && user && (
              <Box mt={3}>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  Add contributors (optional). You are always included.
                </Text>
                <CollaboratorPicker
                  excludeUserIds={[
                    user._id?.toString(),
                    ...selectedCollaborators.map((s) => String(s._id)),
                  ].filter(Boolean)}
                  onSelectUser={(u) => {
                    if (!selectedCollaborators.some((x) => String(x._id) === String(u._id))) {
                      setSelectedCollaborators((p) => [...p, u])
                    }
                  }}
                />
                {selectedCollaborators.length > 0 && (
                  <Wrap mt={2} spacing={2}>
                    {selectedCollaborators.map((su) => (
                      <WrapItem key={su._id}>
                        <Badge
                          display="inline-flex"
                          alignItems="center"
                          gap={1}
                          px={2}
                          py={1}
                          borderRadius="md"
                          variant="subtle"
                          colorScheme="blue"
                        >
                          {su.name || su.username}
                          <Box
                            as="button"
                            type="button"
                            aria-label="Remove"
                            onClick={() =>
                              setSelectedCollaborators((p) =>
                                p.filter((x) => String(x._id) !== String(su._id))
                              )
                            }
                            ml={1}
                            fontWeight="bold"
                            lineHeight={1}
                          >
                            ×
                          </Box>
                        </Badge>
                      </WrapItem>
                    ))}
                  </Wrap>
                )}
              </Box>
            )}
         
            <Input type="file" accept="image/*" multiple hidden ref={carouselInput} onChange={handleCarouselChange} />
            <Input type="file" accept="audio/mpeg,audio/mp3,audio/*" hidden ref={audioInput} onChange={handleAudioChange} />

            <Flex mt={3} gap={3} flexWrap="wrap" align="center">
              <BsFileImageFill
                onClick={() => imageInput.current.click()}
                style={{ cursor: 'pointer' }}
                title={isCollaborative ? 'Photo only' : 'Photo or video'}
              />
              {!isCollaborative && (
              <>
              <Button size="xs" variant="outline" onClick={() => carouselInput.current?.click()}>
                Carousel (up to 4 photos)
              </Button>
              {carouselFiles.length > 0 && (
                <Button size="xs" variant="outline" onClick={() => audioInput.current?.click()}>
                  {audioFile ? '🎵 Change music' : 'Add music (MP3)'}
                </Button>
              )}
              </>
              )}
            </Flex>

            {!isCollaborative && carouselPreviews.length > 0 && (
              <Flex mt={4} gap={2} flexWrap="wrap" position="relative">
                {carouselPreviews.map((src, idx) => (
                  <Image key={src} src={src} alt="" boxSize="120px" objectFit="cover" borderRadius="md" />
                ))}
                {audioFile && (
                  <Text fontSize="sm" alignSelf="center">🎵 {audioFile.name}</Text>
                )}
                <CloseButton
                  onClick={clearCarouselMedia}
                  position="absolute"
                  top={0}
                  right={0}
                  bg="gray.500"
                />
              </Flex>
            )}

            <Input
              type="file"
              accept={isCollaborative ? 'image/*' : 'image/*,video/*'}
              hidden
              ref={imageInput}
              onChange={handleImageChange}
            />

            {!isCollaborative && !carouselPreviews.length && (
            <BsFileImageFill onClick={() => imageInput.current.click()} />
            )}
               
               {imagePreview && !carouselPreviews.length &&
                 <Flex mt={5} position="relative" w="full">
                     {image?.type?.startsWith('image/') ? (
                       <Image src={imagePreview} alt="Preview" maxH="400px" borderRadius="md" />
                     ) : (
                       <Box as="video" src={imagePreview} controls maxH="400px" borderRadius="md" />
                     )}
                     <CloseButton 
                       onClick={() => {
                         // Revoke object URL to free memory
                         if (imagePreview && imagePreview.startsWith('blob:')) {
                           URL.revokeObjectURL(imagePreview)
                         }
                         setImage(null)
                         setImagePreview('')
                         if (imageInput.current) {
                           imageInput.current.value = ''
                         }
                       }} 
                       position="absolute" 
                       top={2} 
                       right={2} 
                       bg={"gray.500"}
                     />
                 </Flex>
                 }
            
          
          
           </FormControl>
         
          </ModalBody>

        
        
        
        
        
          <ModalFooter>
            <Button colorScheme='blue' mr={3} onClick={handleCreatePost} isLoading={loading}>
              post
            </Button>
         
          </ModalFooter>
     
        </ModalContent>
     
      </Modal>
    
    
    
    
    
    
    
    
    
    </Button>
      
    </>
  )
}

export default CreatePost
