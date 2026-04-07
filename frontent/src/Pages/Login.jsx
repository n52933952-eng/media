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
import { useGoogleLogin } from '@react-oauth/google'
import { FcGoogle } from 'react-icons/fc'



export default function Login() {
	

 const showToast = useShowToast()
 const primaryBtnBg = useColorModeValue('gray.600', 'gray.700')
 const primaryBtnHoverBg = useColorModeValue('gray.700', 'gray.800')
 const dividerColor = useColorModeValue('gray.200', 'whiteAlpha.200')


  
	
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

  /** Plain “Continue with Google” + account picker (not “Continue as name” on the button). */
  const startGoogleLogin = useGoogleLogin({
    flow: 'implicit',
    prompt: 'select_account',
    onSuccess: async (tokenResponse) => {
      const idToken = tokenResponse?.id_token
      if (!idToken) {
        showToast('Error', 'No Google ID token received. Try again.', 'error')
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
    },
    onError: (err) => {
      const msg = err?.error_description || err?.error
      if (msg) showToast('Error', String(msg), 'error')
    },
    onNonOAuthError: (e) => {
      if (e?.type === 'popup_closed') return
      showToast('Error', 'Google sign-in was cancelled or failed.', 'error')
    },
  })




	
	return (
		
    <Flex align="center" justify="center" minH="100dvh" py={{ base: 3, md: 4 }} px={4}>
    <Stack spacing={3} mx="auto" maxW="lg" w="full">
      <Stack align="center" spacing={1}>
        <Heading fontSize={{ base: '2xl', md: '3xl' }} textAlign="center" lineHeight="shorter">
          الدخول
        </Heading>
                  
      </Stack>
      <Box
        rounded="lg"
        bg={useColorModeValue('white', 'gray.dark')}
        boxShadow="lg"
        p={{ base: 5, sm: 6 }}
        w={{ base: 'full', sm: '400px' }}
        mx="auto"
      >
        <Stack spacing={3}>
          
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
          <Stack spacing={3} pt={1}>
            <Button
              loadingText="Submitting"
              size="lg"
              w="full"
              bg={primaryBtnBg}
              color="white"
              _hover={{ bg: primaryBtnHoverBg }}
              onClick={handleLogin}
              isDisabled={googleLoading}
            >
              الدخول
            </Button>
            <Divider borderColor={dividerColor} />
            <Button
              w="full"
              size="lg"
              bg={primaryBtnBg}
              color="white"
              _hover={{ bg: primaryBtnHoverBg }}
              leftIcon={<FcGoogle size={22} />}
              onClick={() => startGoogleLogin()}
              isLoading={googleLoading}
              isDisabled={googleLoading}
              loadingText="Google"
            >
              Continue with Google
            </Button>
          </Stack>
          <Text align="center" fontSize="sm" pt={1}>
            ليس لديك حساب?{' '}
            <Link color="blue.400" to="/sign">
              التسجيل
            </Link>
          </Text>
        </Stack>
      </Box>
      <Box pt={1}>
        <Text align="center" fontWeight="bold" fontSize="sm">
          برمجه وتطوير المهندس مهند
        </Text>
        <Text align="center" fontSize="xs" color="gray.500">
          j4116507@gmail.com
        </Text>
      </Box>
    
    </Stack>
  
  </Flex>
	);
}