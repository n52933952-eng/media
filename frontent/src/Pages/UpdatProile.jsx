import React,{useState,useRef,useEffect,useContext} from 'react'


import {
	Button,
	Flex,
	FormControl,
	FormLabel,
	Heading,
	Input,
	Stack,
	useColorModeValue,
	Avatar,
	Center,
    useToast
  
} from "@chakra-ui/react";
import{UserContext} from '../context/UserContext'
import useShowToast from '../hooks/useShowToast.js'





const UpdateProfile = () => {
 

const{user,setUser}=useContext(UserContext)
const[updating,setUpdating]=useState(false)

const showToast = useShowToast()

const[inputs,setInputs]=useState({

    name:user.name,
    username:user.username,
    email:user.email,
    bio:user.bio,
    password:""

   })


   const inputRef = useRef()
 
 


 
 
const[image,setImage]=useState(null) // Will store File object for upload
const[uploadProgress,setUploadProgress]=useState(0)
const[isUploading,setIsUploading]=useState(false)



const handleImageChange = async (event) => {
  const file = event.target.files[0];

  if (!file) return;

  if (file && file.type.startsWith("image/")) {
    // Check file size (100MB limit for Cloudinary)
    const maxSize = 100 * 1024 * 1024 // 100MB
    if (file.size > maxSize) {
      showToast("File too large", "Please select an image smaller than 100MB", "error")
      if (inputRef.current) {
        inputRef.current.value = ''
      }
      return
    }

    // Store file object (will be uploaded when form is submitted)
    setImage(file)
    // Create preview URL
    const previewURL = URL.createObjectURL(file)
    setImage(previewURL) // Show preview immediately
    setUploadProgress(0)
    setIsUploading(false) // Don't upload immediately, wait for form submit
      
    } else {
      showToast("Please select an image", "Invalid image type", "error");
    }
    
    // Reset input value
    if (inputRef.current) {
      inputRef.current.value = ''
    }
};



console.log(image)


  const handleSubmit = async(e) => {
    e.preventDefault();
   
    if(updating || isUploading) {
      return 
    }

    setUpdating(true)
    setUploadProgress(0)
 
  try{
    const formData = new FormData()
    formData.append('name', inputs.name)
    formData.append('username', inputs.username)
    formData.append('email', inputs.email)
    formData.append('bio', inputs.bio || '')
    if (inputs.password) {
      formData.append('password', inputs.password)
    }
    
    // Upload profile picture if a new file was selected
    if (image instanceof File) {
      formData.append('file', image)
      
      const xhr = new XMLHttpRequest()
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadProgress((e.loaded / e.total) * 100)
        }
      })
      
      xhr.open('PUT', `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/update/${user._id}`)
      xhr.withCredentials = true
      xhr.timeout = 600000 // 10 minutes
      
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText)
            
            if(data.error){
              showToast("Error", data.error, "error")
              setUpdating(false)
              setUploadProgress(0)
              return
            }
            
            showToast("Success", "Profile updated successfully", "success")
            setUser(data)
            localStorage.setItem("userInfo", JSON.stringify(data))
            
            // Clear image preview
            if (image && image.startsWith('blob:')) {
              URL.revokeObjectURL(image)
            }
            setImage(null)
            setUploadProgress(0)
            setUpdating(false)
          } catch (error) {
            showToast("Error", "Failed to parse server response", "error")
            setUpdating(false)
            setUploadProgress(0)
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText)
            showToast("Error", errorData.error || "Failed to update profile", "error")
          } catch (error) {
            showToast("Error", "Failed to update profile", "error")
          }
          setUpdating(false)
          setUploadProgress(0)
        }
      }
      
      xhr.onerror = () => {
        showToast("Error", "Network error while updating profile", "error")
        setUpdating(false)
        setUploadProgress(0)
      }
      
      xhr.ontimeout = () => {
        showToast("Error", "Upload timeout. Please try again.", "error")
        setUpdating(false)
        setUploadProgress(0)
      }
      
      xhr.send(formData)
      return // Exit early, response handled in xhr callbacks
    }
    
    // No file upload - just send profile data
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/update/${user._id}`,{
      method:"PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...inputs, profilePic: user.profilePic }) // Keep existing profile pic if no new one
    })
   
    const data = await res.json()

    if(data.error){
      showToast("Error", data.error, "error")
      setUpdating(false)
      return
    }
    
    showToast("Success", "Profile updated successfully", "success")
    setUser(data)
    localStorage.setItem("userInfo", JSON.stringify(data))
    setUpdating(false)
  }
  catch(error){
    showToast("Error", error.message || error, "error")
    setUpdating(false)
    setUploadProgress(0)
  }

}


 



return (
   
   
   
   
   
        <form onSubmit={handleSubmit} >
        <Flex align={"center"} justify={"center"} my={2}  p={{base:20, xs:4}} mt={-30}>
            <Stack
                
                w={"full"}
                maxW={"md"}
                bg={useColorModeValue("white", "gray.dark")}
                rounded={"xl"}
                boxShadow={"lg"}
                p={6}
            >
              
                <FormControl id='userName'>
                    <Stack direction={["column", "row"]} spacing={6}>
                       
                    <Center>
                         
                         <Flex position="relative">
                         <Avatar size='xl'  src={image || user.profilePic} />
                         </Flex>
                        
                         
        
                        
                         </Center>
                       
                        <Center w='full'>
                            
                            <Button w='full' onClick={() => inputRef.current.click()} >
                                Change Avatar
                            <Input type="file" hidden ref={inputRef} onChange={handleImageChange}/>
                            
                            </Button>
                          
                    
                    
                        </Center>
                   
                   
                    </Stack>
                </FormControl>
               
                <FormControl>
                   
                    <FormLabel>Full name</FormLabel>
                    
                    <Input
                        
                        value={inputs.name}
                        onChange={(e) => setInputs({...inputs,name:e.target.value})}
                        placeholder='John Doe'
                    
                        _placeholder={{ color: "gray.500" }}
                        type='text'
                        
                       
                    />
                </FormControl>
                
                
                <FormControl>
                    <FormLabel>User name</FormLabel>
                      
                    <Input
                       value={inputs.username}
                       onChange={(e) => setInputs({...inputs,username:e.target.value})}
                       placeholder='johndoe'
                     
                        _placeholder={{ color: "gray.500" }}
                        type='text'
                       
                    />
                </FormControl>
               
               
                <FormControl>
                    <FormLabel>Email address</FormLabel>
                   
                    <Input
                      
                        value={inputs.email}
                        onChange={(e) => setInputs({...inputs,email:e.target.value})}
                        placeholder='your-email@example.com'
                     
                       
                        _placeholder={{ color: "gray.500" }}
                        type='email'
                       
                    />
                </FormControl>
              
              
                <FormControl>
                    <FormLabel>Bio</FormLabel>
                  
                    <Input
                        value={inputs.bio}
                        onChange={(e) => setInputs({...inputs,bio:e.target.value})}
                        placeholder='Your bio.'
                       
                      
                        _placeholder={{ color: "gray.500" }}
                        type='text'
                       
                      
                    />
                </FormControl>
               
               
                <FormControl>
                    <FormLabel>Password</FormLabel>
                    
                    <Input
                        value={inputs.password}
                        onChange={(e) => setInputs({...inputs,password:e.target.value})}
                        placeholder='password'
                        _placeholder={{ color: "gray.500" }}
                        type='password'
                    />
                </FormControl>
                <Stack spacing={6} direction={["column", "row"]}>
                    <Button
                        bg={"red.400"}
                        color={"white"}
                        w='full'
                        _hover={{
                            bg: "red.500",
                        }}
                    >
                        Cancel
                    </Button>
                    
                    <Button
                        bg={"green.400"}
                        color={"white"}
                        w='full'
                        _hover={{
                            bg: "green.500",
                        }}
                        type='submit'
                        isLoading={updating}
                 
                    >
                        Submit
                    </Button>
               
                </Stack>
            </Stack>
        </Flex>
    </form>
  )
}

export default UpdateProfile