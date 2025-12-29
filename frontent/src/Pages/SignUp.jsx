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



export default function SignUp() {
	

	

	
const[showPassword,setShowPassword]=useState(false)

const[inputs,setInputs]=useState({name:"",username:"",email:"",password:"",country:""})


 const{setUser}=useContext(UserContext)




 const navigate = useNavigate()


const toast =useToast()

	const handleSignup = async () => {
  try {
    console.log('📝 Signing up with data:', { ...inputs, password: '***' })
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/signup`, {
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
