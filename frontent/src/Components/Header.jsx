import React,{useContext} from 'react'

import{Image,useColorMode,Flex} from '@chakra-ui/react'
import { TiHomeOutline } from "react-icons/ti";
import { CgProfile } from "react-icons/cg";
import { FaRegMessage } from "react-icons/fa6";
import { IoNotificationsOutline } from "react-icons/io5";

import{UserContext} from '../context/UserContext'
import{Link} from 'react-router-dom'


const Header = () => {
  
  const{colorMode,toggleColorMode}=useColorMode()

   const{user}=useContext(UserContext)
  
  
  
  
    return (
    
     <Flex justifyContent="space-between" mt="6" mb="12">
        
       

       {user &&
       <Link to="/home">
        <TiHomeOutline size={24}/>
       </Link>
       
       }

    

      
      
       <Image cursor="pointer"
       w={6} 
       src={colorMode === "dark" ? "/light-logo.svg" : "/dark-logo.svg"}
       onClick={toggleColorMode}
       />


      {user && (
        <Flex gap={4} alignItems="center">
          <Link to="/messages">
            <FaRegMessage size={24} />
          </Link>
          
          <Link to="/notifications">
            <IoNotificationsOutline size={24} />
          </Link>
          
          <Link to={`/${user?.username}`}>
            <CgProfile size={24} />
          </Link>
        </Flex>
      )}

      
        
        </Flex>
  )
}

export default Header