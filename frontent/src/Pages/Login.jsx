import {
	Flex,
	Box,
	FormControl,
	FormLabel,
	Input,
	InputGroup,

	InputRightElement,
	Stack,
	Button,
	Heading,
	Text,
	useColorModeValue,
	Divider,
	
} from "@chakra-ui/react";
import { useState,useContext } from "react";
import { ViewIcon, ViewOffIcon,useToast } from "@chakra-ui/icons";

import{Link} from 'react-router-dom'

import useShowToast from '../hooks/useShowToast.js'

import{UserContext} from '../context/UserContext'
import API_BASE_URL from '../config/api'
import { GoogleLogin } from '@react-oauth/google'
import { GOOGLE_WEB_CLIENT_ID } from '../config/googleWebClient'



export default function Login() {
	

 const showToast = useShowToast()


  
	
  const[showPassword,setShowPassword]=useState(false)

 
  const[inputs,setInputs]=useState({username:"",password:""})

 const{setUser}=useContext(UserContext)

 const [googleLoading, setGoogleLoading] = useState(false)

    
 const handleLogin =async() => {
   
    try{
     const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
     const res = await fetch(`${baseUrl}/api/user/login`, {
      method:"POST",
       credentials: "include",
      headers:{
       "Content-Type": "application/json"
        },
        
        body:JSON.stringify({
          username: String(inputs.username || '').trim(),
          password: inputs.password,
        }) 
      
     })
   
     const text = await res.text()
     let data = {}
     try {
       data = text ? JSON.parse(text) : {}
     } catch {
       showToast("Error", text || `Server error (${res.status})`, "error")
       return
     }

     if(data.error){
      showToast("Error",data.error,"error")
      return
     }
      
     // Keep _id stable (defensive if API ever returns `id`)
     const userData = { ...data, _id: data._id || data.id }
     localStorage.setItem("userInfo",JSON.stringify(userData))
     setUser(userData)
    }catch(error){
      showToast("Error", error?.message || String(error), "error")
    }
  
  }

  const handleGoogleSuccess = async (credentialResponse) => {
    const idToken = credentialResponse?.credential
    if (!idToken) {
      showToast('Error', 'No Google token received', 'error')
      return
    }
    setGoogleLoading(true)
    try {
      const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
      const res = await fetch(`${baseUrl}/api/user/google-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const text = await res.text()
      let data = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        showToast('Error', text || `Server error (${res.status})`, 'error')
        return
      }
      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }
      const userData = { ...data, _id: data._id || data.id }
      localStorage.setItem('userInfo', JSON.stringify(userData))
      setUser(userData)
    } catch (error) {
      showToast('Error', error?.message || String(error), 'error')
    } finally {
      setGoogleLoading(false)
    }
  }




	
	return (
		
    <Flex  align={"center"} justify={"center"} >
    <Stack spacing={8} mx={"auto"} maxW={"lg"} py={2} px={6}>
      <Stack align={"center"}>
        <Heading fontSize={"4xl"} textAlign={"center"}>
          الدخول
        </Heading>
                  
      </Stack>
      <Box rounded={"lg"} bg={useColorModeValue("white", "gray.dark")} boxShadow={"lg"} p={8}
               w={{base:"full",sm:"400px"}}
              >
        <Stack spacing={4}>
          
                  <FormControl  isRequired>
                <FormLabel>اسم المستخدم</FormLabel>
                  
                 <Input value={inputs.username} type="text" onChange={(e) => setInputs({...inputs,username:e.target.value})}/>
           
              </FormControl>
                      
          
          <FormControl  isRequired>
            <FormLabel>الباسورد</FormLabel>
            <InputGroup>
              
              <Input value={inputs.password} type={showPassword ? "text" : "password"}
               
               onChange={(e) => setInputs({...inputs,password:e.target.value})}
              
              />
              <InputRightElement h={"full"}>
                
                  <Button
                                      variant={"ghost"}
                                      onClick={() => setShowPassword((showPassword) => !showPassword)}
                                      >
                                         {showPassword ? <ViewIcon/> : <ViewOffIcon/>} 
                                      </Button>
                
              </InputRightElement>
            </InputGroup>
          </FormControl>
          <Stack spacing={10} pt={2}>
            
            
            <Button
              loadingText='Submitting'
              size='lg'
              bg={useColorModeValue("gray.600", "gray.700")}
              color={"white"}
              _hover={{
                bg: useColorModeValue("gray.700", "gray.800"),
              }}
             onClick={handleLogin}
             isDisabled={googleLoading}
            >
              الدخول
            </Button>
          </Stack>
          {GOOGLE_WEB_CLIENT_ID && (
            <>
              <Divider />
              <Box display="flex" justifyContent="center" w="full" opacity={googleLoading ? 0.6 : 1} pointerEvents={googleLoading ? 'none' : 'auto'}>
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => showToast('Error', 'Google sign-in failed', 'error')}
                  text="continue_with"
                  shape="rectangular"
                  size="large"
                  width="100%"
                  locale="en"
                />
              </Box>
            </>
          )}
          <Stack pt={6}>
            <Text align={"center"}>
              ليس لديك حساب?{" "}
              
                              <Link color={"blue.400"} to={"/sign"}>
                التسجيل
              </Link>
            
                          </Text>
          </Stack>
        </Stack>
      </Box>
     <Box >
     <Text align="center" fontWeight="bold">برمجه وتطوير المهندس مهند</Text>
     <Text align="center">j4116507@gmail.com</Text>
     </Box>
    
    </Stack>
  
  </Flex>
	);
}