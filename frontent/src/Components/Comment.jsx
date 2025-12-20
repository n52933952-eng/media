import React, { useState, useContext, useRef, useEffect } from 'react'
import { Avatar, Flex, Text, Divider, Button, Input, Box, Link, VStack } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import { BiDotsHorizontalRounded } from "react-icons/bi";
import { formatDistanceToNow } from 'date-fns'
import { UserContext } from '../context/UserContext'
import { PostContext } from '../context/PostContext'
import useShowToast from '../hooks/useShowToast'





const Comment = ({ reply, postId, allReplies }) => {
  

  const { user } = useContext(UserContext)
  const { followPost, setFollowPost } = useContext(PostContext)
  const showToast = useShowToast()

  const nestedReplies = (allReplies || []).filter((r) => {
   
    if (!r.parentReplyId || !reply._id) return false
    return r.parentReplyId.toString() === reply._id.toString()
  })


  const [isReplying, setIsReplying] = useState(false)
  
  // State: replyText = the text user types in the reply input
  const [replyText, setReplyText] = useState("")
  
  // NEW: State for mention autocomplete suggestions
  const [mentionSuggestions, setMentionSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)  // Position where @ started
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  const inputRef = useRef(null)  // Ref for the input field
  const replyInputRef = useRef(null)  // Ref for the reply input section (for scrolling)
  
  // NEW: Function to handle Reply button click - prefills @username and scrolls to input
  const handleReplyClick = () => {
    setIsReplying(true)
    // Prefill the input with @username (like Facebook does)
    setReplyText(`@${reply.username} `)
    
    // Auto-scroll to reply input section (includes input + Post/Cancel buttons)
    // Delay to ensure the reply input section is rendered
    setTimeout(() => {
      if (replyInputRef.current) {
        // Get the bounding box of the reply section
        const rect = replyInputRef.current.getBoundingClientRect()
        const viewportHeight = window.innerHeight
        const viewportWidth = window.innerWidth
        
        // Calculate how much we need to scroll to show the entire section
        // We want the bottom of the reply section (including buttons) to be visible
        const scrollNeeded = rect.bottom - viewportHeight + 100  // 100px padding at bottom
        
        if (scrollNeeded > 0) {
          // Scroll to ensure the entire reply section (input + buttons) is visible
          window.scrollBy({
            top: scrollNeeded,
            behavior: 'smooth'
          })
        } else {
          // If already visible, just scroll to it smoothly
          replyInputRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest'
          })
        }
        
        // Focus the input after scrolling
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus()
          }
        }, 300)
      }
    }, 150)
  }
  
  // NEW: Function to search users for mention suggestions
  const searchMentionUsers = async (searchTerm) => {
    if (!searchTerm || searchTerm.length < 1) {
      setMentionSuggestions([])
      setShowSuggestions(false)
      return
    }

    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/search?search=${encodeURIComponent(searchTerm)}`,
        {
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        }
      )

      if (res.ok) {
        const users = await res.json()
        setMentionSuggestions(users)
        setShowSuggestions(users.length > 0)
        setSelectedSuggestionIndex(0)
      }
    } catch (error) {
      console.log(error)
    }
  }
  
  // NEW: Handle input change and detect @mentions
  const handleInputChange = (e) => {
    const value = e.target.value
    setReplyText(value)
    
    // Get cursor position
    const cursorPosition = e.target.selectionStart
    const textBeforeCursor = value.substring(0, cursorPosition)
    
    // Find the last @ symbol before cursor
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    
    // Check if we're typing a mention (@ followed by letters)
    if (lastAtIndex !== -1) {
      // Get text after @ and before cursor (or before space/newline)
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1)
      const spaceIndex = textAfterAt.indexOf(' ')
      const newlineIndex = textAfterAt.indexOf('\n')
      const endIndex = spaceIndex !== -1 || newlineIndex !== -1
        ? Math.min(spaceIndex !== -1 ? spaceIndex : Infinity, newlineIndex !== -1 ? newlineIndex : Infinity)
        : textAfterAt.length
      
      const mentionTerm = textAfterAt.substring(0, endIndex)
      
      // If there's no space after @, we're typing a mention
      if (endIndex === textAfterAt.length && mentionTerm.length >= 0) {
        setMentionStartIndex(lastAtIndex)
        searchMentionUsers(mentionTerm)
      } else {
        setShowSuggestions(false)
        setMentionSuggestions([])
      }
    } else {
      setShowSuggestions(false)
      setMentionSuggestions([])
    }
  }
  
  // NEW: Select a user from suggestions
  const selectMentionUser = (user) => {
    if (mentionStartIndex === -1) return
    
    const textBefore = replyText.substring(0, mentionStartIndex)
    const textAfter = replyText.substring(mentionStartIndex)
    const spaceAfterMention = textAfter.indexOf(' ')
    const textAfterMention = spaceAfterMention !== -1 
      ? textAfter.substring(spaceAfterMention)
      : ' '
    
    // Replace @mentionTerm with @username
    const newText = `${textBefore}@${user.username}${textAfterMention}`
    setReplyText(newText)
    setShowSuggestions(false)
    setMentionSuggestions([])
    setMentionStartIndex(-1)
    
    // Focus back on input after selection
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = mentionStartIndex + user.username.length + 1
        inputRef.current.focus()
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }
  
  // NEW: Handle keyboard navigation in suggestions
  const handleKeyDown = (e) => {
    if (!showSuggestions || mentionSuggestions.length === 0) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedSuggestionIndex(prev => 
        prev < mentionSuggestions.length - 1 ? prev + 1 : 0
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedSuggestionIndex(prev => 
        prev > 0 ? prev - 1 : mentionSuggestions.length - 1
      )
    } else if (e.key === 'Enter' && showSuggestions) {
      e.preventDefault()
      selectMentionUser(mentionSuggestions[selectedSuggestionIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setMentionSuggestions([])
    }
  }
  
  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowSuggestions(false)
    }
    if (showSuggestions) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSuggestions])
  
  // NEW: Function to format text and style @mentions (like Facebook's blue @mentions)
  const formatTextWithMentions = (text) => {
    if (!text) return ""
    
    // Split text by @mentions (matches @username pattern)
    // This regex finds @ followed by word characters (letters, numbers, underscore)
    const parts = text.split(/(@\w+)/g)
    
    return parts.map((part, index) => {
      // If this part starts with @, it's a mention - style it blue and bold
      if (part.startsWith('@')) {
        const username = part.substring(1)  // Remove @ to get just username
        return (
          <Link
            as={RouterLink}
            to={`/${username}`}
            color="blue.500"
            fontWeight="bold"
            key={index}
            _hover={{ textDecoration: "underline" }}
          >
            {part}
          </Link>
        )
      }
      // Regular text - return as is
      return <React.Fragment key={index}>{part}</React.Fragment>
    })
  }
  

  const [replying, setReplying] = useState(false)

  
  // Initialize liked state - check if user has liked this comment/reply
  const[liked,setLiked] = useState(
    reply?.likes && Array.isArray(reply.likes) && user?._id 
      ? reply.likes.some(id => id.toString() === user._id.toString())
      : false
  )
 
 
  const handleReplyToComment = async () => {
    
     if (!user) {
      showToast("Error", "You must be logged in to reply", "error")
      return
    }

   if (!replyText.trim()) {
      showToast("Error", "Please enter a reply", "error")
      return
    }

    if (replying) return
     setReplying(true)

    try {
   
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/reply-comment/${postId}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({text: replyText,parentReplyId: reply._id })
      })

      const data = await res.json()

      if (res.ok) {
      
        const updatedFollowPost = followPost.map((p) => {
          if (p._id === postId) {
            // Ensure the new reply has likes array initialized
            const replyWithLikes = {
              ...data,
              likes: data.likes || []
            }
            return {
              ...p,
              replies: [...p.replies, replyWithLikes]  
            }
          }
          return p
        })

       setFollowPost(updatedFollowPost)
         setReplyText("")
        setIsReplying(false)
        
        showToast("Success", "Reply posted successfully", "success")
      } else {
        showToast("Error", data.message || "Failed to post reply", "error")
      }
    } catch (error) {
      console.log(error)
      showToast("Error", "Failed to post reply", "error")
    } finally {
      setReplying(false)
    }
  }



   const handleLikeComent = async () => {
  

  if (!user) {
    showToast("Error", "You must be logged in to like", "error")
    return
  }

 
  const previousLiked = liked
  
  
  setLiked(!liked)

  try {
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/likecoment/${postId}/${reply._id}`, {
      credentials: "include",
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      }
    })

    const data = await res.json()

    if (res.ok) {
    
      const updatedFollowPost = followPost.map((p) => {
        if (p._id === postId) {  
        
          const updatedReplies = p.replies.map((r) => {
            if (r._id.toString() === reply._id.toString()) { 
              return {
                ...r,
                likes: data.isLiked  // ✅ Use data from API response
                  ? [...(r.likes || []), user._id]
                  : (r.likes || []).filter((id) => id.toString() !== user._id.toString())
              }
            }
            return r
          })
          return {
            ...p,
            replies: updatedReplies  // ✅ Update replies array
          }
        }
        return p
      })
      
      setFollowPost(updatedFollowPost)
      
   
      setLiked(data.isLiked)
      
      showToast("Success", data.message, "success")
    } else {
    
      setLiked(previousLiked)
      showToast("Error", data.message || "Failed to like comment", "error")
    }
  } catch (error) {
    console.log(error)
   
    setLiked(previousLiked)
    showToast("Error", "Failed to like comment", "error")
  }
}


  
 
    return (
   
   
    <>
    
    <Flex gap={4} py={2} my={2} mb={6} w="full">  {/* Added mb={6} for margin bottom */}
   
    <Avatar src={reply.userProfilePic} size="sm"/>

    <Flex w="full" gap={1} flexDirection="column">
        <Flex justifyContent="space-between" w="full" alignItems="center">
            <Text>{reply.username}</Text>
           
            <Flex alignItems="center" gap={1}>
               <Text fontSize="sm">
                 {reply?.date && !isNaN(new Date(reply.date).getTime())
                   ? `${formatDistanceToNow(new Date(reply.date))} ago`
                   : 'just now'}
               </Text>
                <BiDotsHorizontalRounded />
            </Flex>
           
            </Flex>

        {/* Display comment text with styled @mentions (like Facebook) */}
        <Text>
          {formatTextWithMentions(reply.text)}
        </Text>

          
      

            <Flex gap={10} alignItems="center">
               
          <Button
            size="xs"
            variant="ghost"
            onClick={handleReplyClick} 
          >
            Reply
          </Button>
        
         <Button size="xs" variant="ghost" onClick={handleLikeComent}>
            {liked ? "❤️" : "🤍"}
            <Text fontSize="xs" ml={1}>
              {reply?.likes?.length || 0}
            </Text>
          </Button>
     
        </Flex>
       
       
    

      
        {isReplying && (
          <Flex 
            ref={replyInputRef}  // Ref for auto-scrolling
            gap={2} 
            mt={2} 
            mb={2}
            direction="column" 
            position="relative"
          >
          
            <Input
              ref={inputRef}
              size="sm"
              placeholder={`Reply to @${reply.username}...`}
              value={replyText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
            />
            
            {/* Mention suggestions dropdown */}
            {showSuggestions && mentionSuggestions.length > 0 && (
              <Box
                position="absolute"
                top="100%"
                left={0}
                right={0}
                mt={1}
                bg="white"
                border="1px solid"
                borderColor="gray.200"
                borderRadius="md"
                boxShadow="lg"
                zIndex={1000}
                maxH="200px"
                overflowY="auto"
              >
                <VStack align="stretch" spacing={0}>
                  {mentionSuggestions.map((user, index) => (
                    <Flex
                      key={user._id || user.username}
                      align="center"
                      gap={2}
                      p={2}
                      cursor="pointer"
                      bg={index === selectedSuggestionIndex ? "gray.100" : "transparent"}
                      _hover={{ bg: "gray.100" }}
                      onClick={() => selectMentionUser(user)}
                    >
                      <Avatar src={user.profilePic} size="sm" />
                      <Flex direction="column">
                        <Text fontSize="sm" fontWeight="bold">
                          {user.username}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          {user.name}
                        </Text>
                      </Flex>
                    </Flex>
                  ))}
                </VStack>
              </Box>
            )}
            
           
            <Flex gap={2}>
              <Button
                size="sm"
                colorScheme="blue"
                onClick={handleReplyToComment}
                isLoading={replying}
                isDisabled={!replyText.trim()}
              >
                Post
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsReplying(false)
                  setReplyText("")
                }}
              >
                Cancel
              </Button>
            </Flex>
          </Flex>
        )}

       </Flex>

       </Flex>
    
    {/* Show nested replies below this comment (indented like Facebook) */}
    {nestedReplies.length > 0 && (
      <Box ml={8} mt={2}>  {/* ml={8} = margin left for indentation */}
        {nestedReplies.map((nestedReply) => (
          <Comment
            key={nestedReply._id}
            reply={nestedReply}
            postId={postId}
            allReplies={allReplies}
          />
        ))}
      </Box>
    )}
    
   <Divider/>
    
    </>
  )
}

export default Comment