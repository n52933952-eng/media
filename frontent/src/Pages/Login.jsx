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
	
} from "@chakra-ui/react";
import { useState,useContext } from "react";
import { ViewIcon, ViewOffIcon,useToast } from "@chakra-ui/icons";

import{Link} from 'react-router-dom'

import useShowToast from '../hooks/useShowToast.js'

import{UserContext} from '../context/UserContext'



export default function Login() {
	

 const showToast = useShowToast()


  
	
  const[showPassword,setShowPassword]=useState(false)

 
  const[inputs,setInputs]=useState({username:"",password:""})

 const{setUser}=useContext(UserContext)

    
 const handleLogin =async() => {
   
    try{

     const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/login`, {
      method:"POST",
       credentials: "include",
      headers:{
       "Content-Type": "application/json"
        },
        
        body:JSON.stringify(inputs) 
      
     })
   
     const data = await res.json()

     if(data.error){
      showToast("Error",data.error,"error")
      return
     }
      
     localStorage.setItem("userInfo",JSON.stringify(data))
     setUser(data)
    }catch(error){
      showToast(error)
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
            >
              الدخول
            </Button>
          </Stack>
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