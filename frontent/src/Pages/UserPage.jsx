import React,{useState,useEffect} from 'react'
import UserHeader from '../Components/UserHeader'
import UserPost from '../Components/UserPost'
import{useParams} from 'react-router-dom'
import useShowToast from '../hooks/useShowToast'
import{Spinner,Flex} from '@chakra-ui/react'
import Post from '../Components/Post'

const UserPage = () => {
 
  
   const[user,setUser]=useState(null)
   const[loading,setLoading]=useState(true)
   
   const[loadingpost,setLoadingpost]=useState(true)

   const{username}=useParams()
    
   const showToast = useShowToast()
   
   const[posts,setPosts]=useState([])
   
   
   const fetchUser = async() => {
       setLoading(true)
      try{
     const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${username}`,{
       credentials: "include",
     })
      
      const data = await res.json()
       
      if(data.error){
        showToast("error",data.error,"error")
      }
      if(res.ok){
        setUser(data)
      }
      }
      catch(error){
        console.log(error)
      }finally{
        setLoading(false)
      }
    }


   useEffect(() => {
    fetchUser()
   },[username,showToast])
  


 const fetchUserPost = async() => {
   setLoadingpost(true)
  
  try{
  
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/user/${username}`,{
     
      credentials:"include",
      
    })

   const data = await res.json()

   if(res.ok){
 setPosts(data)
   } 

  }
  catch(error){
    console.log(error)
  }finally{
    setLoadingpost(false)
  }
 }



  useEffect(() => {
   fetchUserPost()
  },[username])


if(!user && loading){
  return(
    <Flex justifyContent="center">
      <Spinner size="xl"  />
    </Flex>
    
  )
}

  if(!user && !loading) return <h1>no user found</h1>
  

  

 if(!posts)return


  
   return (
   
   <>
    
      <UserHeader users={user}/>
      
      {posts &&posts.map((post) => (
         <Post key={post._id} post={post} postedBy={post.postedBy} />
      ))}
    
    </>
  )
}

export default UserPage