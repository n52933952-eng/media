import React,{useEffect,useState,useContext} from 'react'
import useShowToast from '../hooks/useShowToast.js'
import{Spinner,Flex,Box} from '@chakra-ui/react'
import Post from '../Components/Post'
import {PostContext} from '../context/PostContext'



const HomePage = () => {
 

const{followPost,setFollowPost}=useContext(PostContext)

const[loading,setLoading]=useState(true)
 
const showToast = useShowToast()



const getFeedPost = async()=>{
    setLoading(true)
    try{

   const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/feed/feedpost`,{
    credentials:"include",
    
})
 
const data = await res.json()

 if(data.error){
  showToast("error",data.error,"error")
 }

 if(res.ok){
   setFollowPost(data)
 }

  }
    catch(error){
     showToast("error",error?.message || "Failed to fetch posts. Make sure backend server is running.","error")
    }finally{
      setLoading(false)
    }
  }

 
 
 useEffect(() => {
 getFeedPost()
 },[showToast])
 
 

 


  return (
    <>
      {!loading && followPost.length === 0 && (
        <Box textAlign="center" p={8}>
          <h1>Follow some users to see feeds</h1>
        </Box>
      )}
      
      {loading && (
        <Flex justifyContent="center" p={8}>
          <Spinner size={"xl"} />
        </Flex>
      )}

      {followPost.map((post) => (
        <Post key={post._id} post={post} postedBy={post.postedBy} />
      ))}
    </>
  )
}

export default HomePage
