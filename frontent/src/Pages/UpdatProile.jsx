import React,{useState,useRef,useEffect,useContext} from 'react'
import { useNavigate } from 'react-router-dom'

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
	Select,
	Modal,
	ModalOverlay,
	ModalContent,
	ModalHeader,
	ModalBody,
	ModalFooter,
	Text,
} from "@chakra-ui/react";
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast.js'
import API_BASE_URL from '../config/api'
import { uploadMediaToR2 } from '../utils/directR2Upload'





const UpdateProfile = () => {
 

const{user,setUser}=useContext(UserContext)
const{followPost,setFollowPost}=useContext(PostContext)
const { endChessGameOnNavigate } = useContext(SocketContext) || {}
const navigate = useNavigate()
const[updating,setUpdating]=useState(false)
const [deleteOpen, setDeleteOpen] = useState(false)
const [deleteConfirmText, setDeleteConfirmText] = useState('')
const [deletingAccount, setDeletingAccount] = useState(false)

const showToast = useShowToast()

const[inputs,setInputs]=useState({

    name:user.name,
    username:user.username,
    email:user.email,
    bio:user.bio,
    country:user.country || "",
    password:""

   })


   const inputRef = useRef()
 
 


 
 
const[imageFile,setImageFile]=useState(null) // Store File object for upload
const[imagePreview,setImagePreview]=useState(null) // Store preview URL for display
const[uploadProgress,setUploadProgress]=useState(0)
const[isUploading,setIsUploading]=useState(false)



const handleImageChange = async (event) => {
  const file = event.target.files[0];

  if (!file) return;

  if (file && file.type.startsWith("image/")) {
    // Check file size (100MB upload limit)
    const maxSize = 100 * 1024 * 1024 // 100MB
    if (file.size > maxSize) {
      showToast("File too large", "Please select an image smaller than 100MB", "error")
      if (inputRef.current) {
        inputRef.current.value = ''
      }
      return
    }

    // Store file object (will be uploaded when form is submitted)
    setImageFile(file)
    // Create preview URL for display
    const previewURL = URL.createObjectURL(file)
    setImagePreview(previewURL) // Show preview immediately
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



  const handleSubmit = async(e) => {
    e.preventDefault();
   
    if(updating || isUploading) {
      return 
    }

    setUpdating(true)
    setUploadProgress(0)
 
  try{
    const payload = {
      name: inputs.name,
      username: inputs.username,
      email: inputs.email,
      bio: inputs.bio || '',
      country: inputs.country || '',
      profilePic: user.profilePic,
    }
    if (inputs.password) {
      payload.password = inputs.password
    }

    if (imageFile instanceof File) {
      setUploadProgress(20)
      payload.profilePic = await uploadMediaToR2(imageFile, 'profile-pics')
      setUploadProgress(80)
    }

    const res = await fetch(`${API_BASE_URL}/api/user/update/${user._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    setUploadProgress(100)

    if (data.error) {
      showToast('Error', data.error, 'error')
      setUpdating(false)
      setUploadProgress(0)
      return
    }

    showToast('Success', 'Profile updated successfully', 'success')
    setUser(data)
    localStorage.setItem('userInfo', JSON.stringify(data))

    if (data.profilePic || data.username) {
      setFollowPost((prev) =>
        prev.map((post) => {
          if (post.replies && post.replies.length > 0) {
            const updatedReplies = post.replies.map((reply) => {
              if (reply.userId && reply.userId.toString() === user._id.toString()) {
                return {
                  ...reply,
                  userProfilePic: data.profilePic || reply.userProfilePic,
                  username: data.username || reply.username,
                }
              }
              return reply
            })
            return { ...post, replies: updatedReplies }
          }
          return post
        }),
      )
    }

    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImageFile(null)
    setImagePreview(null)
    setUploadProgress(0)
    setUpdating(false)
  }
  catch(error){
    showToast("Error", error.message || error, "error")
    setUpdating(false)
    setUploadProgress(0)
  }

}

  const apiBase = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

  const clearSessionLikeLogout = () => {
    localStorage.removeItem('chessOrientation')
    localStorage.removeItem('gameLive')
    localStorage.removeItem('chessRoomId')
    localStorage.removeItem('chessFEN')
    localStorage.removeItem('capturedWhite')
    localStorage.removeItem('capturedBlack')
    localStorage.removeItem('userInfo')
    setUser(null)
  }

  const handleOpenDelete = () => {
    setDeleteConfirmText('')
    setDeleteOpen(true)
  }

  const handleCloseDelete = () => {
    if (deletingAccount) return
    setDeleteOpen(false)
  }

  const handleConfirmDelete = async () => {
    if (deletingAccount) return
    const typed = deleteConfirmText.trim().toUpperCase()
    if (typed !== 'DELETE') return
    setDeletingAccount(true)
    try {
      if (endChessGameOnNavigate) endChessGameOnNavigate()
      const res = await fetch(`${apiBase()}/api/user/delete`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast('Error', data.error || 'Failed to delete account', 'error')
        return
      }
      showToast('Success', 'Account deleted', 'success')
      setDeleteOpen(false)
      clearSessionLikeLogout()
      navigate('/')
    } catch (e) {
      showToast('Error', e?.message || 'Failed to delete account', 'error')
    } finally {
      setDeletingAccount(false)
    }
  }

  return (
    <>
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
                         <Avatar size='xl'  src={imagePreview || user.profilePic} />
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
                    <FormLabel>Country</FormLabel>
                    <Select 
                        placeholder="Select country"
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

                <Button
                  variant="outline"
                  colorScheme="red"
                  w="full"
                  mt={2}
                  onClick={handleOpenDelete}
                >
                  Delete account
                </Button>
            </Stack>
        </Flex>
    </form>

    <Modal isOpen={deleteOpen} onClose={handleCloseDelete} isCentered>
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalHeader>Delete your account?</ModalHeader>
        <ModalBody>
          <Text fontSize="sm" color="gray.500" mb={4}>
            This permanently deletes your account and your data (posts, stories, messages, and collaborations). This cannot be undone.
          </Text>
          <Text fontSize="sm" fontWeight="medium" mb={1}>
            Type DELETE to confirm
          </Text>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
            autoCapitalize="off"
          />
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={handleCloseDelete} isDisabled={deletingAccount}>
            Cancel
          </Button>
          <Button
            colorScheme="red"
            onClick={handleConfirmDelete}
            isLoading={deletingAccount}
            isDisabled={deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
          >
            Confirm delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    </>
  )
}

export default UpdateProfile