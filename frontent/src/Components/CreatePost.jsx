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
  Box
} from "@chakra-ui/react";

import { BsFileImageFill } from "react-icons/bs";
import useShowToast from '../hooks/useShowToast.js'

import{UserContext} from '../context/UserContext'


const MAX_CHAR = 500


const CreatePost = () => {
 
   const{user}=useContext(UserContext)
   
   const{isOpen,onOpen,onClose}=useDisclosure()
   
    const[postText,setPostText]=useState('')
    const[image,setImage]=useState(null) // File object instead of base64
    const[imagePreview,setImagePreview]=useState('') // Preview URL
    const[loading,setLoading]=useState(false)



    const imageInput = useRef()

   
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





  const handleImageChange = (event) => {
    const file = event.target.files[0]
    
    if (!file) return

    // Check if file is image or video
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      // Check file size (500MB limit)
      const maxSize = 500 * 1024 * 1024 // 500MB
      if (file.size > maxSize) {
        showToast("File too large", "Please select a file smaller than 500MB", "error")
        if (imageInput.current) {
          imageInput.current.value = ''
        }
        return
      }
      
      // Store the file object for sending
      setImage(file)
      
      // Create preview URL for display
      const previewURL = URL.createObjectURL(file)
      setImagePreview(previewURL)
    } else {
      showToast("Invalid file type", "Please select an image or video file", "error")
    }
    
    // Reset input value to allow selecting same file again
    if (imageInput.current) {
      imageInput.current.value = ''
    }
  }













   const handleCreatePost = async() => {
     setLoading(true)
  try{
    // Use FormData to send file
    const formData = new FormData()
    formData.append('postedBy', user._id)
    formData.append('text', postText)
    if (image) {
      formData.append('file', image)
    }

    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/create`,{
      credentials: "include",
      method:"POST",
      // Don't set Content-Type header - browser will set it with boundary for FormData
      body: formData
    })


    const data = await res.json()

    if(data.error){
      showToast("Error",data.error,"error")
      return
    }

    showToast("Success","Post created sucfully","success")
    onClose()
    setPostText("")
    // Revoke object URL to free memory
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImage(null)
    setImagePreview("")
  }
  catch(error){
    showToast("Error",error,"error")
  }finally{
    setLoading(false)
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
   
    
    
    
    
     <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
       
        <ModalContent>
          <ModalHeader>Create Post</ModalHeader>
         
          <ModalCloseButton />
          
         
         
          <ModalBody mb={6}>
           <FormControl>
           
         <Textarea placeholder="post text gose here" value={postText}onChange={handleTextChnage}/>
          
          
          
            <Text fontSize="sm" fontWeight="bold" textAlign="right" color="gray.500">{remaingChar}/{MAX_CHAR}</Text>
         
            <Input  type="file" accept="image/*,video/*" hidden ref={imageInput} onChange={handleImageChange} />

            <BsFileImageFill onClick={() => imageInput.current.click()} />
               
               {imagePreview && 
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
