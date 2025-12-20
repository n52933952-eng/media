import React,{useState,useEffect} from 'react'
import{useParams} from 'react-router-dom'
import useShowToast from './useShowToast'


const GetUserProfile = () => {
 

const[userpro,setUserpro]=useState(null)
const[loading,setLoading]=useState(null)
const{username}= useParams()
const showToast = useShowToast()


useEffect(() => {
 
   const getUser = async() => {
      setLoading(true)
    try{
    
     const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${username}`,{
        credentials: "include",
     })   

      const data = await res.json()

      if(res.ok){
        setUserpro(data)
      }

    }catch(error){
        showToast("error",error.message,"error")
    }finally{
        setLoading(false)
    }

   }
  
   getUser()

},[username])

return{userpro,loading}

}

export default GetUserProfile
