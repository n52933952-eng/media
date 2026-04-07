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
	Select,
} from "@chakra-ui/react";
import { useState,useContext } from "react";

import { ViewIcon, ViewOffIcon,useToast } from "@chakra-ui/icons";


import{Link} from 'react-router-dom'
import{useNavigate} from 'react-router-dom'
import{UserContext} from '../context/UserContext'
import API_BASE_URL from '../config/api'



export default function SignUp() {
	

	

	
const[showPassword,setShowPassword]=useState(false)

const[inputs,setInputs]=useState({name:"",username:"",email:"",password:"",country:""})


 const{setUser}=useContext(UserContext)




 const navigate = useNavigate()


const toast =useToast()

	const handleSignup = async () => {
  const name = String(inputs.name || '').trim()
  const username = String(inputs.username || '').trim()
  const email = String(inputs.email || '').trim().toLowerCase()
  const password = String(inputs.password || '')
  const country = String(inputs.country || '').trim()

  if (!name || !username || !email || !password) {
    toast({
      title: "Error",
      description: "Please fill in name, username, email, and password.",
      status: "error",
      duration: 4000,
      isClosable: true,
    })
    return
  }
  if (password.length < 6) {
    toast({
      title: "Error",
      description: "Password must be at least 6 characters.",
      status: "error",
      duration: 4000,
      isClosable: true,
    })
    return
  }
  if (!country) {
    toast({
      title: "Error",
      description: "Please select your country.",
      status: "error",
      duration: 4000,
      isClosable: true,
    })
    return
  }

  const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

  try {
    console.log('📝 Signing up with data:', { name, username, email, country, password: '***' })
    const res = await fetch(`${baseUrl}/api/user/signup`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, username, email, password, country }),
    });

    let data = {}
    const text = await res.text()
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { error: text || `Server error (${res.status})` }
    }

    const serverError =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message || data?.message || (typeof data === 'string' ? data : null)

    if (!res.ok) {
      toast({
        title: "Registration failed",
        description: serverError || `Request failed (${res.status})`,
        status: "error",
        duration: 5000,
        isClosable: true,
      })
      return
    }

    // Success — normalize _id (backend signup returns 'id', not '_id')
    const userData = { ...data, _id: data._id || data.id }
    if (!userData._id) {
      toast({
        title: "Error",
        description: "Invalid response from server. Please try logging in.",
        status: "error",
        duration: 5000,
        isClosable: true,
      })
      return
    }

    setUser(userData)
    localStorage.setItem("userInfo", JSON.stringify(userData))

    toast({
      title: "Signup successful",
      description: "Your account has been created",
      status: "success",
      duration: 3000,
      isClosable: true,
    })

    navigate("/home")
  } catch (error) {
    console.error(error)
    toast({
      title: "Network error",
      description: error?.message || "Could not reach the server. Check your connection and API URL (VITE_API_URL).",
      status: "error",
      duration: 5000,
      isClosable: true,
    })
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
						
						<FormControl id="country" isRequired>
							<FormLabel>البلد</FormLabel>
							<Select 
								placeholder="اختر البلد"
								value={inputs.country}
								onChange={(e) => setInputs({...inputs,country:e.target.value})}
							>
								<option value="United States">United States</option>
								<option value="United Kingdom">United Kingdom</option>
								<option value="Canada">Canada</option>
								<option value="Australia">Australia</option>
								<option value="Germany">Germany</option>
								<option value="France">France</option>
								<option value="Italy">Italy</option>
								<option value="Spain">Spain</option>
								<option value="Netherlands">Netherlands</option>
								<option value="Belgium">Belgium</option>
								<option value="Switzerland">Switzerland</option>
								<option value="Austria">Austria</option>
								<option value="Sweden">Sweden</option>
								<option value="Norway">Norway</option>
								<option value="Denmark">Denmark</option>
								<option value="Finland">Finland</option>
								<option value="Poland">Poland</option>
								<option value="Portugal">Portugal</option>
								<option value="Greece">Greece</option>
								<option value="Turkey">Turkey</option>
								<option value="Russia">Russia</option>
								<option value="Japan">Japan</option>
								<option value="China">China</option>
								<option value="India">India</option>
								<option value="South Korea">South Korea</option>
								<option value="Singapore">Singapore</option>
								<option value="Malaysia">Malaysia</option>
								<option value="Thailand">Thailand</option>
								<option value="Indonesia">Indonesia</option>
								<option value="Philippines">Philippines</option>
								<option value="Vietnam">Vietnam</option>
								<option value="Saudi Arabia">Saudi Arabia</option>
								<option value="United Arab Emirates">United Arab Emirates</option>
								<option value="Egypt">Egypt</option>
								<option value="Morocco">Morocco</option>
								<option value="Tunisia">Tunisia</option>
								<option value="Algeria">Algeria</option>
								<option value="Lebanon">Lebanon</option>
								<option value="Jordan">Jordan</option>
								<option value="Iraq">Iraq</option>
								<option value="Kuwait">Kuwait</option>
								<option value="Qatar">Qatar</option>
								<option value="Bahrain">Bahrain</option>
								<option value="Oman">Oman</option>
								<option value="Yemen">Yemen</option>
								<option value="Syria">Syria</option>
								<option value="Palestine">Palestine</option>
								<option value="Brazil">Brazil</option>
								<option value="Argentina">Argentina</option>
								<option value="Mexico">Mexico</option>
								<option value="Chile">Chile</option>
								<option value="Colombia">Colombia</option>
								<option value="Peru">Peru</option>
								<option value="Venezuela">Venezuela</option>
								<option value="South Africa">South Africa</option>
								<option value="Nigeria">Nigeria</option>
								<option value="Kenya">Kenya</option>
								<option value="Ghana">Ghana</option>
								<option value="Ethiopia">Ethiopia</option>
								<option value="Other">Other</option>
							</Select>
						</FormControl>
						
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
								
								
								<Link color={"blue.400"} to={"/"}>
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
