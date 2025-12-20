import {
	Flex,
	Box,
	FormControl,
	FormLabel,
	Input,
	InputGroup,
	HStack,
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
import{useNavigate} from 'react-router-dom'
import{UserContext} from '../context/UserContext'



export default function SignUp() {
	

	

	
const[showPassword,setShowPassword]=useState(false)

const[inputs,setInputs]=useState({name:"",username:"",email:"",password:""})


 const{setUser}=useContext(UserContext)




 const navigate = useNavigate()


const toast =useToast()

	const handleSignup = async () => {
  try {
    const res = await fetch("http://localhost:5000/api/user/signup", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(inputs),
    });

    const data = await res.json();

    // Check backend error
    if (!res.ok) {
      toast({
        title: "Error",
        description: data.error ,
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Success
    setUser(data);
    localStorage.setItem("userInfo", JSON.stringify(data));

    toast({
      title: "Signup successful",
      description: "Your account has been created",
      status: "success",
      duration: 3000,
      isClosable: true,
    });

    navigate("/home");
  } catch (error) {
    console.log(error);
  }
};





return (
		
		<Flex  align={"center"} justify={"center"} >
			<Stack spacing={8} mx={"auto"} maxW={"lg"} py={2} px={6}>
				<Stack align={"center"}>
					<Heading fontSize={"4xl"} textAlign={"center"}>
						التسجيل
					</Heading>
               
				</Stack>
				<Box rounded={"lg"} bg={useColorModeValue("white", "gray.dark")} boxShadow={"lg"} p={8}>
					<Stack spacing={4}>
						<HStack>
							<Box>
								<FormControl id="firstName" isRequired>
									<FormLabel>الاسم الكامل</FormLabel>
								  <Input value={inputs.name} type="text" onChange={(e) =>setInputs({...inputs,name:e.target.value})} />
								</FormControl>
							</Box>
							<Box>
								<FormControl id="email" isRequired>
									<FormLabel>اسم المستخدم</FormLabel>
								  <Input value={inputs.username} type="text" onChange={(e) => setInputs({...inputs,username:e.target.value})}/>
								</FormControl>
							</Box>

                           
						
                        </HStack>
                        <Box>
								<FormControl id="email" isRequired>
								
                	<FormLabel>بريد إلكتروني</FormLabel>
							    
                  <Input type="text" value={inputs.email} onChange={(e) => setInputs({...inputs,email:e.target.value})}/>
							
              	</FormControl>
							
              </Box>
						
						<FormControl  isRequired>
							<FormLabel>الباسورد</FormLabel>
							<InputGroup>
								<Input value={inputs.password}  type={showPassword ? "text" : "password"} 
							   onChange={(e)=>setInputs({...inputs,password:e.target.value})}
								
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
		
								loadingText='Sign Up'
								size='lg'
								bg={useColorModeValue("gray.600", "gray.700")}
								color={"white"}
								_hover={{
									bg: useColorModeValue("gray.700", "gray.800"),
								}}
								
                onClick={handleSignup}
							>
								التسجيل
							</Button>
						</Stack>
						<Stack pt={6}>
							<Text align={"center"}>
								لديك حساب?{" "}
								
								
								<Link color={"blue.400"} to={"/login"}  >
									الدخول
								</Link>
							
							
							</Text>
						</Stack>
					</Stack>
				</Box>
			</Stack>
		</Flex>
	);
}
