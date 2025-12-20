import React from 'react'
import{Link} from 'react-router-dom'
import{Flex,Avatar,Box,Text,Image} from '@chakra-ui/react'
import { HiOutlineDotsHorizontal } from "react-icons/hi";
import Actions from '../Components/Actions'


const UserPost = () => {
 
    return (
    
    
   <Link to="/usernmae/post/1">
    
    <Flex gap={3}  mb="4" py={5}>
        
        
        <Flex flexDirection="column" alignItems="center">
            <Avatar siz="md" src="/zuck-avatar.png"/>
            <Box w="1px" h="full" bg="gray.light" my="2"></Box>
       
       <Box position="relative" w="full">
       
        <Avatar 
        src="https://media.istockphoto.com/id/1437816897/photo/business-woman-manager-or-human-resources-portrait-for-career-success-company-we-are-hiring.jpg?s=612x612&w=0&k=20&c=tyLvtzutRh22j9GqSGI33Z4HpIwv9vL_MZw_xOE19NQ="
        size="sm" name="jon do" position="absolute" top="0px" left="15px" padding="2px"/>
       
        <Avatar 
        src="https://media.istockphoto.com/id/1437816897/photo/business-woman-manager-or-human-resources-portrait-for-career-success-company-we-are-hiring.jpg?s=612x612&w=0&k=20&c=tyLvtzutRh22j9GqSGI33Z4HpIwv9vL_MZw_xOE19NQ="
        size="sm" name="jon do" position="absolute" bottom="0px" right="-5px" padding="2px"/>
       
        <Avatar 
        src="https://media.istockphoto.com/id/1437816897/photo/business-woman-manager-or-human-resources-portrait-for-career-success-company-we-are-hiring.jpg?s=612x612&w=0&k=20&c=tyLvtzutRh22j9GqSGI33Z4HpIwv9vL_MZw_xOE19NQ="
        size="sm" name="jon do" position="absolute" bottom="0px" left="4px" padding="2px"/>
       
       </Box>
        </Flex>
    
    
   <Flex flex={1} flexDirection="column" gap={2}>
    <Flex justifyContent="space-between" w="full">
     <Flex w="full" alignItems="center">
        <Text fontSize="sm" fontWeight="bold">mark</Text>
        <Image src="/verified.png" w={4} h={4} ml={1} />
     </Flex>
     <Flex alignItems="center" gap={2}>
        <Text>1d</Text>
          <HiOutlineDotsHorizontal />
     </Flex>
    </Flex>
     <Text>this is my first post</Text>
  
  <Box borderRadius={6} overflow="hidden" border="1px solid" borderColor="gray.light">
    <Image src="/post1.png" w="full"/>
  </Box>
  
  
  
  <Flex gap={3} my={1}>
  <Actions/>
  </Flex>
  
  
  
   </Flex>
   
   

    </Flex>
   
  

 
  
   </Link>
  


)
}

export default UserPost