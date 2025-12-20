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
  Flex
} from "@chakra-ui/react";

import { BsFileImageFill } from "react-icons/bs";
import useShowToast from '../hooks/useShowToast.js'

import{UserContext} from '../context/UserContext'


const MAX_CHAR = 500


const CreatePost = () => {
 
   const{user}=useContext(UserContext)
   
   const{isOpen,onOpen,onClose}=useDisclosure()
   
    const[postText,setPostText]=useState('')
    const[image,setImage]=useState('')
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
  
   if(file && file.type.startsWith("image/")){
    const reader = new FileReader()

    reader.onload = () => {
        setImage(reader.result)
    }
    reader.readAsDataURL(file)
   }else{
    showToast("Please select an image","Invalid image type","error")
   }
  }













   const handleCreatePost = async() => {
     setLoading(true)
  try{

 const res = await fetch("http://localhost:5000/api/post/create",{
  
  credentials: "include",
  method:"POST",

  headers:{
    "Content-Type" : "application/json"
  },
  body:JSON.stringify({postedBy:user._id,text:postText,img:image})
 })


 const data = await res.json()

if(data.error){
  showToast("Error",data.error,"error")
  return
}

showToast("Success","Post created sucfully","success")
onClose()
setPostText("")
setImage("")
  }
  catch(error){
    showToast("Errir",error,"error")
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
         
            <Input  type="file" hidden ref={imageInput} onChange={handleImageChange} />

            <BsFileImageFill onClick={() => imageInput.current.click()} />
               
               {image && 
                 <Flex mt={5} position="relative" w="full">
                     <Image src={image} />
                     <CloseButton onClick={() => setImage("")} position="absolute" top={2} right={2} bg={"gray.500"}/>
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
