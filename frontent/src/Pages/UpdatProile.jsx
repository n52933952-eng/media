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
 
 


 
 
const[image,setImage]=useState(null)



const handleImageChange = (event) => {
  const file = event.target.files[0];

  if (file && file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result); 
    };
    reader.readAsDataURL(file); 
  }else{
   showToast("Please select an image", "Invalid image type", "error");
  }
};



console.log(image)


  const handleSubmit = async(e) => {
    e.preventDefault();
   

    if(updating) return 

    setUpdating(true)
 
  try{
 
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/update/${user._id}`,{

        method:"PUT",

           headers: { "Content-Type": "application/json" },
           credentials: "include",
           body:JSON.stringify({ ...inputs,profilePic:image})
         })
   
     const data= await res.json()

      if(data.error){
        showToast("Error",data.error,"error")
        return
      }
      
     showToast("Success","Profile updated successfully","success")
     setUser(data)
     localStorage.setItem("userInfo",JSON.stringify(data))
     
    }
  catch(error){
    showToast("error",error,"error")
  }finally{
    setUpdating(false)
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