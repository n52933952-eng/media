import React,{useContext} from 'react'
import{Button} from '@chakra-ui/react'
import{UserContext} from '../context/UserContext'
import useShowToast from '../hooks/useShowToast.js'
 import { IoIosLogOut } from "react-icons/io";  
const LogOutButton = () => {
    
     const{setUser}=useContext(UserContext)
       
     const showToast = useShowToast()
   
      const handleLogout = async() => {

        try{

          const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/logout`,{
            method:"POST",
              credentials: "include",
            headers:{
                "Content-Type" : "application-json"
            }
          })  
               
             const data = await res.json()
             

             if(data.error){
                showToast("Error",data.error,"error")
                return
             }
             
             // Clean up chess game state on logout
             localStorage.removeItem("chessOrientation")
             localStorage.removeItem("gameLive")
             localStorage.removeItem("chessRoomId")
             localStorage.removeItem("chessFEN")
             localStorage.removeItem("capturedWhite")
             localStorage.removeItem("capturedBlack")
             
             localStorage.removeItem("userInfo")
             setUser(null)
        }
        catch(error){
            console.log(error)
        }
    }
  
  
  
    return (
   
     <Button  position="fixed" top="30px" right="30px" size="sm"  onClick={handleLogout}>
     <IoIosLogOut size={24}/>
   
    </Button>
  )
}

export default LogOutButton
