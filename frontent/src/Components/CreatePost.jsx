import React,{useState,useRef,useContext} from 'react'
import{AddIcon} from '@chakra-ui/icons'

import {  Button,useColorModeValue,useDisclosure,
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
  Wrap,
  WrapItem,
  Badge,
  ButtonGroup,
  SimpleGrid,
  Progress,
  Avatar
} from "@chakra-ui/react";

import { BsFileImageFill } from "react-icons/bs";
import { MdAddPhotoAlternate } from "react-icons/md";
import useShowToast from '../hooks/useShowToast.js'
import { compressVideo, needsCompression } from '../utils/videoCompress'
import API_BASE_URL from '../config/api'
import { buildInitialContributorIds } from '../utils/collaborators'
import { uploadMediaToR2, uploadManyMediaToR2 } from '../utils/directR2Upload'
import CollaboratorPicker from './CollaboratorPicker'

import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'


const MAX_CHAR = 500
const MAX_CAROUSEL = 4


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
    const[postType,setPostType]=useState('single') // single | carousel | collaborative
    const isCollaborative = postType === 'collaborative'
    const [selectedCollaborators, setSelectedCollaborators] = useState([])
    const [carouselFiles, setCarouselFiles] = useState([])
    const [carouselPreviews, setCarouselPreviews] = useState([])
    const [audioFile, setAudioFile] = useState(null)

    const imageInput = useRef()
    const carouselInput = useRef()
    const audioInput = useRef()

   
     const showToast = useShowToast()

     const hintBgCollab = useColorModeValue('blue.50', 'whiteAlpha.100')
     const hintBgCarousel = useColorModeValue('purple.50', 'whiteAlpha.100')
     const selectedChipsBg = useColorModeValue('blue.50', 'whiteAlpha.100')
     const collabPhotoBorder = useColorModeValue('blue.100', 'whiteAlpha.200')
 
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

  const switchPostType = (next) => {
    if (next === postType) return
    if (next === 'collaborative') {
      enableCollaborativeMode()
    } else {
      setSelectedCollaborators([])
    }
    if (next !== 'carousel') clearCarouselMedia()
    if (next !== 'single' && next !== 'collaborative') clearSingleImageMedia()
    if (next === 'collaborative' && image?.type?.startsWith('video/')) clearSingleImageMedia()
    setPostType(next)
  }

  const handleAddCarouselPhoto = (event) => {
    const file = event.target.files?.[0]
    if (carouselInput.current) carouselInput.current.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Invalid file type', 'Carousel posts support photos only', 'error')
      return
    }
    if (carouselFiles.length >= MAX_CAROUSEL) {
      showToast('Limit reached', `Carousel supports up to ${MAX_CAROUSEL} photos`, 'info')
      return
    }
    clearSingleImageMedia()
    setCarouselFiles((prev) => [...prev, file])
    setCarouselPreviews((prev) => [...prev, URL.createObjectURL(file)])
  }

  const removeCarouselAt = (idx) => {
    setCarouselFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      if (next.length <= 1) setAudioFile(null)
      return next
    })
    setCarouselPreviews((prev) => {
      const url = prev[idx]
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== idx)
    })
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

     if (postType === 'carousel' && carouselFiles.length === 0) {
       showToast('Error', 'Add at least one photo for carousel', 'error')
       return
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
    const payload = {
      postedBy: user._id,
      text: postText,
    }
    if (isCollaborative) {
      payload.isCollaborative = true
      payload.contributors = buildInitialContributorIds(user?._id, selectedCollaborators)
    }

    setUploadProgress(10)

    if (carouselFiles.length > 0) {
      payload.images = await uploadManyMediaToR2(carouselFiles, 'posts')
      setUploadProgress(70)
      if (audioFile) {
        payload.audio = await uploadMediaToR2(audioFile, 'posts', { skipCompress: true })
      }
      setUploadProgress(90)
    } else if (image instanceof File) {
      const isVideo = image.type?.startsWith('video/')
      payload.img = await uploadMediaToR2(image, 'posts', { skipCompress: !!isVideo })
      setUploadProgress(80)
      if (audioFile) {
        payload.audio = await uploadMediaToR2(audioFile, 'posts', { skipCompress: true })
      }
      setUploadProgress(90)
    } else if (typeof image === 'string' && image) {
      payload.img = image
    }

    const res = await fetch(`${API_BASE_URL}/api/post/create`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    setUploadProgress(100)

    if (data.error) {
      showToast('Error', data.error, 'error')
      setLoading(false)
      setUploadProgress(0)
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
        if (exists) return prev
        return [newPost, ...prev]
      })
    }

    showToast("Success", "Post created successfully", "success")
    onClose()
    setPostText("")
    clearCarouselMedia()
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImage(null)
    setImagePreview("")
    setUploadProgress(0)
    setPostType('single')
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
          setPostType('single')
          onClose()
        }}
        blockScrollOnMount={false}
        scrollBehavior="inside"
        size="lg"
      >
        <ModalOverlay />
       
        <ModalContent maxH="90vh">
          <ModalHeader>Create Post</ModalHeader>
         
          <ModalCloseButton />
          
          <ModalBody mb={6} overflowY="auto">
           <FormControl>

            <Text fontSize="sm" fontWeight="semibold" mb={2}>Post type</Text>
            <ButtonGroup isAttached size="sm" mb={4} flexWrap="wrap">
              <Button
                variant={postType === 'single' ? 'solid' : 'outline'}
                colorScheme="blue"
                onClick={() => switchPostType('single')}
              >
                Photo / Video
              </Button>
              <Button
                variant={postType === 'carousel' ? 'solid' : 'outline'}
                colorScheme="blue"
                onClick={() => switchPostType('carousel')}
              >
                Carousel
              </Button>
              <Button
                variant={postType === 'collaborative' ? 'solid' : 'outline'}
                colorScheme="blue"
                onClick={() => switchPostType('collaborative')}
              >
                🤝 Collaborative
              </Button>
            </ButtonGroup>

            {postType === 'collaborative' && (
              <Box mb={4} p={3} borderRadius="md" bg={hintBgCollab}>
                <Text fontSize="sm" fontWeight="medium">One photo per person</Text>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Add your photo first, then invite contributors. They add their photos later.
                </Text>
              </Box>
            )}

            {postType === 'carousel' && (
              <Box mb={4} p={3} borderRadius="md" bg={hintBgCarousel}>
                <Text fontSize="sm" fontWeight="medium">Up to {MAX_CAROUSEL} photos</Text>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Add photos one by one. Optional music after the first photo.
                </Text>
              </Box>
            )}

            <Input type="file" accept="image/*" hidden ref={carouselInput} onChange={handleAddCarouselPhoto} />
            <Input type="file" accept="audio/mpeg,audio/mp3,audio/*" hidden ref={audioInput} onChange={handleAudioChange} />
            <Input
              type="file"
              accept={isCollaborative ? 'image/*' : 'image/*,video/*'}
              hidden
              ref={imageInput}
              onChange={handleImageChange}
            />

            {/* Collaborative: photo first so users don't scroll to find it */}
            {postType === 'collaborative' && (
              <Box mb={4} p={3} borderRadius="md" borderWidth="1px" borderColor={collabPhotoBorder}>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>1. Your photo</Text>
                {!imagePreview ? (
                  <Button
                    w="full"
                    h="100px"
                    variant="outline"
                    borderStyle="dashed"
                    leftIcon={<MdAddPhotoAlternate />}
                    onClick={() => imageInput.current?.click()}
                  >
                    Add your photo
                  </Button>
                ) : (
                  <Flex direction="column" gap={2} align="center">
                    <Image src={imagePreview} alt="Preview" maxH="160px" borderRadius="md" objectFit="contain" />
                    <Button size="sm" variant="outline" onClick={clearSingleImageMedia}>
                      Change photo
                    </Button>
                  </Flex>
                )}
              </Box>
            )}

            <Text fontSize="sm" fontWeight="semibold" mb={2}>
              {isCollaborative ? '2. Caption (optional)' : 'Caption'}
            </Text>
            <Textarea placeholder="What's on your mind?" value={postText} onChange={handleTextChnage}/>
            <Text fontSize="sm" fontWeight="bold" textAlign="right" color="gray.500">{remaingChar}/{MAX_CHAR}</Text>

            {isCollaborative && selectedCollaborators.length > 0 && (
              <Box mt={4} p={3} borderRadius="md" bg={selectedChipsBg}>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>
                  Selected contributors ({selectedCollaborators.length})
                </Text>
                <Wrap spacing={2}>
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
                        <Avatar size="2xs" src={su.profilePic} name={su.name || su.username} />
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
              </Box>
            )}

            {isCollaborative && user && (
              <Box mt={4}>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>
                  3. Add contributors (optional)
                </Text>
                <CollaboratorPicker
                  pageSize={6}
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
              </Box>
            )}

            {postType === 'carousel' && (
              <Box mt={4}>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>
                  Photos ({carouselPreviews.length}/{MAX_CAROUSEL})
                </Text>
                <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
                  {carouselPreviews.map((src, idx) => (
                    <Box key={src} position="relative" borderRadius="md" overflow="hidden">
                      <Image src={src} alt="" w="full" h="110px" objectFit="cover" />
                      <CloseButton
                        size="sm"
                        position="absolute"
                        top={1}
                        right={1}
                        bg="blackAlpha.700"
                        color="white"
                        onClick={() => removeCarouselAt(idx)}
                      />
                      <Text
                        position="absolute"
                        bottom={1}
                        left={1}
                        fontSize="xs"
                        color="white"
                        bg="blackAlpha.600"
                        px={1.5}
                        borderRadius="sm"
                      >
                        {idx + 1}
                      </Text>
                    </Box>
                  ))}
                  {carouselPreviews.length < MAX_CAROUSEL && (
                    <Button
                      h="110px"
                      variant="outline"
                      borderStyle="dashed"
                      leftIcon={<MdAddPhotoAlternate />}
                      onClick={() => carouselInput.current?.click()}
                    >
                      Add photo
                    </Button>
                  )}
                </SimpleGrid>
                {carouselPreviews.length > 0 && (
                  <Button mt={3} size="sm" variant="outline" onClick={() => audioInput.current?.click()}>
                    {audioFile ? `🎵 ${audioFile.name}` : 'Add music (optional, max 4 min)'}
                  </Button>
                )}
              </Box>
            )}

            {postType === 'single' && (
              <Box mt={4}>
                <Text fontSize="sm" fontWeight="semibold" mb={2}>Photo or video</Text>
                {!imagePreview ? (
                  <Button
                    variant="outline"
                    leftIcon={<BsFileImageFill />}
                    onClick={() => imageInput.current?.click()}
                  >
                    Choose file
                  </Button>
                ) : (
                  <Flex mt={2} position="relative" w="full" direction="column" gap={2}>
                    {image?.type?.startsWith('image/') ? (
                      <Image src={imagePreview} alt="Preview" maxH="320px" borderRadius="md" objectFit="contain" />
                    ) : (
                      <Box as="video" src={imagePreview} controls maxH="320px" borderRadius="md" />
                    )}
                    <Button size="sm" variant="outline" alignSelf="flex-start" onClick={clearSingleImageMedia}>
                      Remove
                    </Button>
                  </Flex>
                )}
              </Box>
            )}

            {isUploading && uploadProgress > 0 && uploadProgress < 100 && (
              <Box mt={4}>
                <Text fontSize="xs" mb={1}>Processing… {Math.round(uploadProgress)}%</Text>
                <Progress value={uploadProgress} size="sm" colorScheme="blue" borderRadius="md" />
              </Box>
            )}
          
           </FormControl>
         
          </ModalBody>

          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={handleCreatePost}
              isLoading={loading}
              isDisabled={
                !postText.trim() &&
                !imagePreview &&
                carouselPreviews.length === 0
              }
            >
              Post
            </Button>
          </ModalFooter>
     
        </ModalContent>
     
      </Modal>
    
    
    
    
    
    
    
    
    
    </Button>
      
    </>
  )
}

export default CreatePost
