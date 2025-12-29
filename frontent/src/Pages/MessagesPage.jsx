import React, { useState, useEffect, useContext, useRef } from 'react'
import {
  Box,
  Flex,
  Input,
  Button,
  Avatar,
  Text,
  VStack,
  HStack,
  Divider,
  useColorModeValue,
  InputGroup,
  InputLeftElement,
  Spinner,
  IconButton,
  Badge,
  Image,
  CloseButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react'
import { SearchIcon, ArrowBackIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import { formatDistanceToNow } from 'date-fns'
import { FaPhone, FaPhoneSlash, FaVideo } from 'react-icons/fa'
import { BsCheck2All, BsReply, BsFillImageFill, BsTrash } from 'react-icons/bs'
import { MdDelete } from 'react-icons/md'
import EmojiPicker from 'emoji-picker-react'
import { compressVideo, needsCompression } from '../utils/videoCompress'

const MessagesPage = () => {
  const { user } = useContext(UserContext)
  const socketContext = useContext(SocketContext)
  const { socket, onlineUser, callUser, callAccepted, callEnded, isCalling, callType, call, answerCall, leaveCall, myVideo, userVideo, stream, remoteStream, busyUsers, setSelectedConversationId } = socketContext || {}
  const showToast = useShowToast()

  // State
  const [conversations, setConversations] = useState([])
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const conversationsContainerRef = useRef(null) // Ref for conversations scroll container
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [followedUsers, setFollowedUsers] = useState([])
  const [isTyping, setIsTyping] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(null) // Store messageId when picker is open
  const [emojiPickerForMessage, setEmojiPickerForMessage] = useState(false) // Track if emoji picker is open for sending messages
  const [isAtBottom, setIsAtBottom] = useState(true) // Track if user is scrolled to bottom
  const [unreadCountInView, setUnreadCountInView] = useState(0) // Count of unread messages while scrolled up
  const [replyingTo, setReplyingTo] = useState(null) // Store message being replied to
  const [image, setImage] = useState(null) // File object for image/video
  const [imagePreview, setImagePreview] = useState('') // Preview URL for display
  const [uploadProgress, setUploadProgress] = useState(0) // Upload progress percentage
  const [isProcessing, setIsProcessing] = useState(false) // Track if server is processing (after 100% upload)
  const [hasMoreMessages, setHasMoreMessages] = useState(false) // Track if there are more messages to load
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false) // Track if loading older messages

  // Refs
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const emojiPickerRef = useRef(null)
  const emojiPickerForMessageRef = useRef(null) // Ref for emoji picker in message input area
  const lastMessageCountRef = useRef(0) // Track message count to detect new messages
  const isUserScrollingRef = useRef(false) // Track if user is manually scrolling
  const scrollTimeoutRef = useRef(null) // Timeout to detect when user stops scrolling
  const messageInputRef = useRef(null) // Ref for message input field
  const imageInputRef = useRef(null) // Ref for image/video file input
  const firstMessageIdRef = useRef(null) // Track first message ID to detect pagination vs new messages
  const shouldScrollToBottomRef = useRef(false) // Track if we should scroll to bottom (only on initial load)

  // Theme colors - white for light mode, dark for dark mode
  const bgColor = useColorModeValue('white', '#101010')  // White in light mode, dark in dark mode
  const borderColor = useColorModeValue('gray.200', '#1a1a1a')  // Light gray border in light mode
  const inputBg = useColorModeValue('gray.100', '#1a1a1a')  // Light gray input in light mode
  const hoverBg = useColorModeValue('gray.50', '#1a1a1a')  // Light hover in light mode
  const emojiPickerTheme = useColorModeValue('light', 'dark')

  // Function to fetch conversations with pagination
  const fetchConversations = async (loadMore = false, beforeId = null) => {
    if (loadMore) {
      setLoadingMoreConversations(true)
    } else {
      setLoading(true)
    }

    try {
      // Build URL with pagination parameters
      let url = `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/conversations?limit=20`
      if (beforeId) {
        url += `&beforeId=${beforeId}`
      }

      const res = await fetch(url, {
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        if (loadMore && beforeId && data.conversations) {
          // Loading more conversations - append to existing
          setConversations(prev => [...prev, ...data.conversations])
        } else {
          // Initial load - replace all conversations
          setConversations(data.conversations || data || [])
        }
        setHasMoreConversations(data.hasMore || false)
      }
    } catch (error) {
      if (!loadMore) {
        showToast('Error', 'Failed to load conversations', 'error')
      }
    } finally {
      if (loadMore) {
        setLoadingMoreConversations(false)
      } else {
        setLoading(false)
      }
    }
  }

  // Load more conversations when scrolling to bottom
  const loadMoreConversations = async () => {
    if (!hasMoreConversations || loadingMoreConversations || conversations.length === 0) return

    const oldestConversation = conversations[conversations.length - 1]
    if (!oldestConversation?._id) return

    await fetchConversations(true, oldestConversation._id)
  }


  // Fetch conversations on component mount
  useEffect(() => {
    if (user) {
      fetchConversations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Clear selected conversation when component unmounts (user leaves Messages page)
  useEffect(() => {
    return () => {
      if (setSelectedConversationId) {
        setSelectedConversationId(null)
      }
    }
  }, [setSelectedConversationId])

  // Force video elements to update when mounting MessagesPage with active call
  useEffect(() => {
    if (callAccepted && !callEnded) {
      console.log('MessagesPage mounted with active call - forcing video update')
      // Force a small delay then check video elements
      const timer = setTimeout(() => {
        if (myVideo?.current && stream && !myVideo.current.srcObject) {
          console.log('Attaching local stream to myVideo on mount')
          myVideo.current.srcObject = stream
          myVideo.current.muted = true
        }
        if (userVideo?.current) {
          if (userVideo.current.srcObject) {
            console.log('Forcing remote video play on mount')
            userVideo.current.volume = 1.0
            userVideo.current.muted = false
            userVideo.current.play().catch(e => console.log('Play error:', e))
          } else if (remoteStream) {
            console.log('Attaching remote stream on mount')
            userVideo.current.srcObject = remoteStream
            userVideo.current.volume = 1.0
            userVideo.current.muted = false
            userVideo.current.play().catch(e => console.log('Remote play error:', e))
          }
        }
      }, 200)
      return () => clearTimeout(timer)
    }
  }, []) // Only run on mount

  // Attach video streams if navigating to chat during active call
  useEffect(() => {
    // Small delay to ensure video elements are rendered
    const timer = setTimeout(() => {
      if (callAccepted && !callEnded && selectedConversation) {
        console.log('Reconnecting video streams during navigation...', {
          hasMyVideo: !!myVideo?.current,
          hasUserVideo: !!userVideo?.current,
          hasStream: !!stream,
          userVideoHasStream: !!userVideo?.current?.srcObject
        })
        
        // Ensure my video (local) has the stream attached
        if (myVideo?.current && stream) {
          myVideo.current.srcObject = stream
          myVideo.current.muted = true // Always mute own video to prevent echo
          myVideo.current.play().catch(err => {
            console.log('My video play error:', err)
          })
        }
        
        // Ensure user video (remote) has stream and plays
        if (userVideo?.current) {
          // Check if userVideo already has a stream (from peer connection)
          if (userVideo.current.srcObject) {
            console.log('User video already has stream, playing...')
            userVideo.current.volume = 1.0
            userVideo.current.muted = false
            userVideo.current.play().catch(err => {
              console.log('User video play error:', err)
            })
          } else if (remoteStream) {
            // Attach remoteStream from context if userVideo doesn't have it yet
            console.log('Attaching remote stream from context...')
            userVideo.current.srcObject = remoteStream
            userVideo.current.volume = 1.0
            userVideo.current.muted = false
            userVideo.current.play().catch(err => {
              console.log('Remote stream play error:', err)
            })
          } else {
            console.log('User video missing stream - waiting for peer connection...')
            // Wait a bit longer for peer connection to attach stream
            setTimeout(() => {
              if (userVideo?.current?.srcObject) {
                console.log('Stream now available, playing user video')
                userVideo.current.volume = 1.0
                userVideo.current.muted = false
                userVideo.current.play().catch(err => {
                  console.log('Delayed user video play error:', err)
                })
              } else if (remoteStream && userVideo?.current) {
                console.log('Attaching remote stream after delay...')
                userVideo.current.srcObject = remoteStream
                userVideo.current.volume = 1.0
                userVideo.current.muted = false
                userVideo.current.play().catch(err => {
                  console.log('Delayed remote stream play error:', err)
                })
              } else {
                console.log('Still no stream on user video after delay')
              }
            }, 500)
          }
        }
      }
    }, 100) // Small delay to ensure DOM is ready
    
    return () => clearTimeout(timer)
  }, [callAccepted, callEnded, stream, remoteStream, myVideo, userVideo, selectedConversation])

  // Fetch followed users for search
  useEffect(() => {
    const fetchFollowedUsers = async () => {
      if (!user?._id) return
      
      try {
        // Get current user's following list
        const userRes = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${user._id}`, {
          credentials: 'include',
        })
        const userData = await userRes.json()
        if (userRes.ok && userData.following && userData.following.length > 0) {
          // Fetch user details for each followed user
          const usersPromises = userData.following.map(async (userId) => {
            try {
              // Check if userId is a valid string/ObjectId
              if (!userId || typeof userId !== 'string') {
                return null
              }
              
              const userRes = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${userId}`, {
                credentials: 'include',
              })
              
              if (!userRes.ok) {
                // Silently skip invalid user IDs (400 errors) - don't log to console
                return null
              }
              
              const data = await userRes.json()
              // Check if response has error
              if (data.error || !data._id) {
                return null
              }
              
              return data
            } catch (error) {
              console.log(`Error fetching user ${userId}:`, error)
              return null
            }
          })
          const users = await Promise.all(usersPromises)
          setFollowedUsers(users.filter(u => u !== null && u !== undefined && !u.error && u._id))
        }
      } catch (error) {
        console.log('Error fetching followed users:', error)
      }
    }

    fetchFollowedUsers()
  }, [user?._id])

  // Fetch messages for selected conversation
  useEffect(() => {
    // Reset typing indicator and scroll state when conversation changes
    setIsTyping(false)
    setUnreadCountInView(0)
    setIsAtBottom(true)
    lastMessageCountRef.current = 0
    isUserScrollingRef.current = false
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    // Reset state
    firstMessageIdRef.current = null // Reset first message ID
    shouldScrollToBottomRef.current = true // Enable scroll to bottom for initial load
    
    // Clear messages first to ensure clean state
    setMessages([])
    
    // Reset scroll position immediately when conversation changes
    // This ensures we don't remember previous scroll position
    // But we'll scroll to bottom after messages load
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      container.scrollTop = 0
    }

    const fetchMessages = async (loadMore = false, beforeId = null) => {
      if (!selectedConversation) return

      const otherUser = selectedConversation.participants[0]
      if (!otherUser?._id) return
      
      // Store current conversation ID to detect if it changes during fetch
      const currentConversationId = selectedConversation._id

      if (loadMore) {
        setLoadingMoreMessages(true)
      }

      try {
        // Build URL with pagination parameters
        let url = `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${otherUser._id}?limit=12`
        if (beforeId) {
          url += `&beforeId=${beforeId}`
        }

        const res = await fetch(url, {
          credentials: 'include',
        })
        const data = await res.json()
        
        // Check if conversation changed while fetching - if so, discard these messages
        if (selectedConversation?._id !== currentConversationId) {
          console.log('Conversation changed during fetch, discarding old messages')
          return
        }
        
        if (res.ok) {
          if (loadMore && beforeId) {
            // Loading older messages - prepend to existing messages
            // Update firstMessageIdRef before prepending to detect this is pagination
            if (data.messages && data.messages.length > 0) {
              firstMessageIdRef.current = data.messages[0]._id
            }
            setMessages((prev) => {
              const combined = [...data.messages, ...prev]
              // Limit to 200 messages max to prevent memory issues
              // Keep most recent 200 messages (trim from oldest side if needed)
              if (combined.length > 200) {
                return combined.slice(0, 200)
              }
              return combined
            })
            // Don't update lastMessageCountRef here - pagination shouldn't trigger unread count
            return // Exit early, don't trigger unread detection
          } else {
            // Initial load - replace all messages
            const messagesToSet = data.messages || []
            
            // Set lastMessageCountRef BEFORE setting messages to prevent unread detection on initial load
            lastMessageCountRef.current = messagesToSet.length
            setUnreadCountInView(0) // Clear unread count when opening conversation
            setIsAtBottom(true)
            
            // Track first message ID for pagination detection
            if (messagesToSet.length > 0) {
              firstMessageIdRef.current = messagesToSet[0]._id
            } else {
              firstMessageIdRef.current = null
            }
            
            // Set messages
            setMessages(messagesToSet)
            
            // Mark that we should scroll to bottom after messages render (initial load only)
            shouldScrollToBottomRef.current = true
            
            // Mark messages as seen when opening conversation
            const otherUser = selectedConversation.participants[0]
            if (otherUser?._id && socket) {
              socket.emit("markmessageasSeen", {
                conversationId: selectedConversation._id,
                userId: otherUser._id
              })
            }
          }
          
          // Update pagination state
          setHasMoreMessages(data.hasMore || false)
        }
      } catch (error) {
        showToast('Error', 'Failed to load messages', 'error')
      } finally {
        if (loadMore) {
          setLoadingMoreMessages(false)
        }
      }
    }

    // Clear messages immediately when switching conversations to prevent showing stale data
    setMessages([])
    setHasMoreMessages(false)
    setUnreadCountInView(0)
    lastMessageCountRef.current = 0
    firstMessageIdRef.current = null
    
    // Update SocketContext with the currently open conversation to prevent notification sounds
    if (setSelectedConversationId && selectedConversation?.participants[0]?._id) {
      setSelectedConversationId(selectedConversation.participants[0]._id)
    } else if (setSelectedConversationId) {
      setSelectedConversationId(null)
    }
    
    // Only fetch messages if conversation has _id (existing conversation)
    // New conversations (no _id) start with empty messages
    if (selectedConversation && selectedConversation._id) {
      fetchMessages(false, null) // Initial load
    }
  }, [selectedConversation?._id, selectedConversation?.participants[0]?._id, showToast, setSelectedConversationId])

  // Scroll to bottom when messages are initially loaded (not pagination)
  useEffect(() => {
    // Only scroll on initial load, not when loading older messages
    // Check if we should scroll (only true on initial load)
    const isInitialLoad = shouldScrollToBottomRef.current && 
                         messages.length > 0 && 
                         !loadingMoreMessages && 
                         selectedConversation?._id
    
    if (isInitialLoad) {
      // Use multiple approaches to ensure scroll works
      const scrollToBottom = () => {
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current
          // Force scroll to absolute bottom
          container.scrollTop = container.scrollHeight
          // Also use scrollTo as backup
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'auto'
          })
          // Method 3: scrollIntoView on messagesEndRef
          if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' })
          }
        }
      }
      
      // Immediate scroll attempt
      scrollToBottom()
      
      // Wait for DOM to update, then scroll multiple times
      requestAnimationFrame(() => {
        scrollToBottom()
      })
      
      // Multiple delayed attempts to ensure it works
      setTimeout(scrollToBottom, 10)
      setTimeout(scrollToBottom, 50)
      setTimeout(scrollToBottom, 100)
      setTimeout(scrollToBottom, 200)
      setTimeout(scrollToBottom, 300)
      
      // Final verification and force scroll
      setTimeout(() => {
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current
          const scrollHeight = container.scrollHeight
          const clientHeight = container.clientHeight
          const scrollTop = container.scrollTop
          const distanceFromBottom = scrollHeight - scrollTop - clientHeight
          
          // If not at bottom, force scroll
          if (distanceFromBottom > 10) {
            container.scrollTop = scrollHeight
            // Double check
            setTimeout(() => {
              if (messagesContainerRef.current) {
                messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
              }
            }, 50)
          }
        }
        // Reset the flag after scrolling is complete
        shouldScrollToBottomRef.current = false
      }, 400)
    }
  }, [messages.length, selectedConversation?._id, loadingMoreMessages]) // Only when messages change and it's initial load

  // Function to load older messages (called when scrolling to top)
  const loadOlderMessages = async () => {
    if (!hasMoreMessages || loadingMoreMessages || !messages.length) return

    const oldestMessage = messages[0]
    if (!oldestMessage?._id) return

    // Store current scroll position
    const container = messagesContainerRef.current
    if (!container) return

    const previousScrollHeight = container.scrollHeight
    const previousScrollTop = container.scrollTop

    try {
      const otherUser = selectedConversation?.participants[0]
      if (!otherUser?._id) return

      setLoadingMoreMessages(true) 

      const url = `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${otherUser._id}?limit=12&beforeId=${oldestMessage._id}`
      const res = await fetch(url, {
        credentials: 'include',
      })
      const data = await res.json()

      if (res.ok && data.messages && data.messages.length > 0) {
        // Prepend older messages
        setMessages((prev) => [...data.messages, ...prev])
        setHasMoreMessages(data.hasMore || false)

        // Maintain scroll position after loading
        setTimeout(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight
            const scrollDifference = newScrollHeight - previousScrollHeight
            container.scrollTop = previousScrollTop + scrollDifference
          }
        }, 50)
      } else {
        setHasMoreMessages(false)
      }
    } catch (error) {
      console.error('Error loading older messages:', error)
      showToast('Error', 'Failed to load older messages', 'error')
    } finally {
      setLoadingMoreMessages(false)
    }
  }

  // Track scroll position
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollTop = container.scrollTop
      const scrollHeight = container.scrollHeight
      const clientHeight = container.clientHeight
      // Check if at bottom - use a small threshold (20px) to account for rounding and smooth scrolling
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isAtBottom = distanceFromBottom <= 20

      setIsAtBottom(isAtBottom)
      isUserScrollingRef.current = true // User is manually scrolling
      
      // Check if scrolled to top (load older messages)
      if (scrollTop <= 50 && hasMoreMessages && !loadingMoreMessages) {
        loadOlderMessages()
      }
      
      // If scrolled to bottom, clear unread count immediately
      if (isAtBottom && unreadCountInView > 0) {
        setUnreadCountInView(0)
      }
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // Set timeout to detect when user stops scrolling (after 300ms of no scrolling)
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
        
        // Final check when scrolling stops - if at bottom, clear unread count
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current
          const finalScrollTop = container.scrollTop
          const finalScrollHeight = container.scrollHeight
          const finalClientHeight = container.clientHeight
          const finalDistanceFromBottom = finalScrollHeight - finalScrollTop - finalClientHeight
          
          if (finalDistanceFromBottom <= 20 && unreadCountInView > 0) {
            setUnreadCountInView(0)
            setIsAtBottom(true)
          }
        }
      }, 300)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    // Check initial position
    handleScroll()
    
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [selectedConversation?._id, hasMoreMessages, loadingMoreMessages]) // Re-run when conversation changes or pagination state changes

  // Track new messages and handle auto-scroll/unread indicator
  // This should ONLY trigger when NEW messages arrive (appended to end), NOT when loading older messages (prepended)
  useEffect(() => {
    // Skip if this is the initial load (lastMessageCountRef is 0 and we're setting messages for first time)
    // This prevents counting initial messages as "new"
    if (messages.length > lastMessageCountRef.current && user?._id && lastMessageCountRef.current > 0) {
      const container = messagesContainerRef.current
      if (!container) {
        lastMessageCountRef.current = messages.length
        return
      }

      // Check if new messages were appended to END (new messages from socket) or prepended to START (pagination)
      // If first message ID changed from what we tracked, it means older messages were loaded (pagination)
      const currentFirstMessageId = messages[0]?._id
      const wasPagination = firstMessageIdRef.current !== null && 
                           currentFirstMessageId !== null &&
                           currentFirstMessageId !== firstMessageIdRef.current
      
      // If this is pagination (loading older messages), update refs and return
      if (wasPagination) {
        firstMessageIdRef.current = currentFirstMessageId
        lastMessageCountRef.current = messages.length
        return // Don't show unread indicator for pagination
      }
      
      // Update first message ID ref if it changed (but not due to pagination)
      if (currentFirstMessageId !== firstMessageIdRef.current) {
        firstMessageIdRef.current = currentFirstMessageId
      }

      // Get new messages that were just added (appended to end - these are REAL new messages)
      const newMessages = messages.slice(lastMessageCountRef.current)
      
      // Count only messages from the other user (not from current user)
      const unreadFromOthers = newMessages.filter(msg => {
        let msgSenderId = ''
        if (msg.sender?._id) {
          msgSenderId = typeof msg.sender._id === 'string' ? msg.sender._id : msg.sender._id.toString()
        } else if (msg.sender) {
          msgSenderId = typeof msg.sender === 'string' ? msg.sender : String(msg.sender)
        }
        const currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
        return msgSenderId !== currentUserId
      }).length
      
      // Check scroll position BEFORE new messages are added to DOM
      // We need to check immediately, before DOM updates
      const scrollTopBefore = container.scrollTop
      const scrollHeightBefore = container.scrollHeight
      const clientHeight = container.clientHeight
      const distanceFromBottomBefore = scrollHeightBefore - scrollTopBefore - clientHeight
      
      // Store the fact that we have unread messages from others
      const hasUnreadFromOthers = unreadFromOthers > 0
      
      // Wait for DOM to update with new messages
      const timeoutId = setTimeout(() => {
        if (!container) {
          lastMessageCountRef.current = messages.length
          return
        }
        
        // Check scroll position AFTER new messages are added
        const scrollTopAfter = container.scrollTop
        const scrollHeightAfter = container.scrollHeight
        const distanceFromBottomAfter = scrollHeightAfter - scrollTopAfter - clientHeight
        
        // If user was near bottom (within 150px) before new message, auto-scroll
        // Also check if user is not currently manually scrolling
        if (distanceFromBottomBefore <= 150 && !isUserScrollingRef.current) {
          // Auto-scroll to bottom
          container.scrollTop = container.scrollHeight
          setIsAtBottom(true)
          setUnreadCountInView(0)
        } else if (distanceFromBottomAfter > 10 && hasUnreadFromOthers) {
          // User is scrolled up (more than 10px from bottom) and there are new messages from others
          // Increment unread count
          setUnreadCountInView(prev => {
            const newCount = prev + unreadFromOthers
            return newCount
          })
          setIsAtBottom(false)
        } else if (distanceFromBottomAfter > 10) {
          // User is scrolled up but no new messages from others (or it's their own message)
          setIsAtBottom(false)
          // Don't clear unread count here - let it stay if there are previous unread messages
        } else {
          // User is at bottom
          setIsAtBottom(true)
          setUnreadCountInView(0)
        }
      }, 100) // Small delay to let DOM update

      lastMessageCountRef.current = messages.length
      return () => clearTimeout(timeoutId)
    } else {
      lastMessageCountRef.current = messages.length
    }
  }, [messages.length, user?._id])


  // Use ref to track selected conversation ID - CRITICAL for performance
  // This prevents recreating the socket listener every time conversation changes
  const selectedConversationIdRef = useRef(null)
  
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?._id || null
  }, [selectedConversation?._id])

  // Listen for new messages via Socket.io - OPTIMIZED
  useEffect(() => {
    if (!socket || !user?._id) return

    const handleNewMessage = (message) => {
      // Always process new messages - even if conversation was deleted
      if (!message || !message.conversationId) return
      
      // Check if this message is for the currently selected conversation
      // Use REF to get latest value without recreating listener (performance optimization)
      const currentSelectedId = selectedConversationIdRef.current
      const isForSelectedConversation = currentSelectedId &&
        message.conversationId &&
        message.conversationId.toString() === currentSelectedId.toString()
      
      // Update messages if this is for the selected conversation
      if (isForSelectedConversation) {
        setMessages((prev) => {
          // Prevent duplicate messages (critical for real-time reliability)
          const isDuplicate = prev.some(msg => 
            msg._id && message._id && msg._id.toString() === message._id.toString()
          )
          if (isDuplicate) return prev
          
          // Update first message ID ref if this is the first message
          if (prev.length === 0 && message._id) {
            firstMessageIdRef.current = message._id
          }
          const updated = [...prev, message]
          // Limit to 200 messages max to prevent memory issues
          // If over limit, remove oldest messages (keep most recent 200)
          if (updated.length > 200) {
            return updated.slice(-200)
          }
          return updated
        })
      }
      
      // ALWAYS update conversation list (even if message is for selected conversation)
      // This ensures conversations are sorted and updated in real-time
      setConversations(prev => {
        let updated = prev.map(conv => {
            if (conv._id && message.conversationId && conv._id.toString() === message.conversationId.toString()) {
              // Check if message is from current user
              let messageSenderId = ''
              if (message.sender?._id) {
                messageSenderId = typeof message.sender._id === 'string' ? message.sender._id : message.sender._id.toString()
              } else if (message.sender) {
                messageSenderId = typeof message.sender === 'string' ? message.sender : String(message.sender)
              }
              
              let currentUserId = ''
              if (user?._id) {
                currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
              }
              
              const isFromCurrentUser = messageSenderId !== '' && currentUserId !== '' && messageSenderId === currentUserId
              
              // Update lastMessage with full sender info
              const updatedLastMessage = {
                text: message.text || '',
                sender: message.sender || (isFromCurrentUser ? {
                  _id: user._id,
                  name: user.name,
                  username: user.username,
                  profilePic: user.profilePic
                } : null),
                createdAt: message.createdAt || new Date().toISOString()
              }
              
              // OPTIMIZED: Don't increment unread if conversation is currently open
              const isCurrentlyViewing = currentSelectedId && conv._id.toString() === currentSelectedId.toString()
              const shouldIncrementUnread = !isFromCurrentUser && !isCurrentlyViewing
              
              if (shouldIncrementUnread) {
                // Message from other user AND not currently viewing - increment unread count
                return { 
                  ...conv, 
                  unreadCount: (conv.unreadCount || 0) + 1, 
                  lastMessage: updatedLastMessage,
                  updatedAt: new Date().toISOString() // Update timestamp to move to top
                }
              } else {
                // Message from current user OR currently viewing - just update lastMessage
                return {
                  ...conv,
                  lastMessage: updatedLastMessage,
                  updatedAt: new Date().toISOString() // Update timestamp to move to top
                }
              }
            }
            return conv
          })
          
          // Check if conversation exists - if not, we need to add it (for new conversations)
          const conversationExists = updated.some(conv => 
            conv._id && message.conversationId && conv._id.toString() === message.conversationId.toString()
          )
          
          if (!conversationExists && message.conversationId) {
            // New conversation or conversation was deleted - recreate it
            // Determine if message is from current user
            let messageSenderId = ''
            if (message.sender?._id) {
              messageSenderId = typeof message.sender._id === 'string' ? message.sender._id : message.sender._id.toString()
            } else if (message.sender) {
              messageSenderId = typeof message.sender === 'string' ? message.sender : String(message.sender)
            }
            
            let currentUserId = ''
            if (user?._id) {
              currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
            }
            
            const isFromCurrentUser = messageSenderId !== '' && currentUserId !== '' && messageSenderId === currentUserId
            
            // Create conversation object with sender info
            const newConv = {
              _id: message.conversationId,
              participants: message.sender && !isFromCurrentUser ? [message.sender] : [], // Will be populated by fetch if needed
              lastMessage: {
                text: message.text || '',
                sender: message.sender || (isFromCurrentUser ? {
                  _id: user._id,
                  name: user.name,
                  username: user.username,
                  profilePic: user.profilePic
                } : null),
                createdAt: message.createdAt || new Date().toISOString()
              },
              updatedAt: new Date().toISOString(),
              unreadCount: !isFromCurrentUser ? 1 : 0
            }
            updated = [newConv, ...updated]
          }
          
          // Sort by updatedAt to move most recent to top - OPTIMIZED sorting
          const sorted = updated.sort((a, b) => {
            const aTime = new Date(a.updatedAt || 0).getTime()
            const bTime = new Date(b.updatedAt || 0).getTime()
            return bTime - aTime // Most recent first
          })
          
          return sorted
          
          // If conversation was not in list (new conversation), fetch full details
          if (!conversationExists && message.conversationId) {
            // Fetch full conversation details in background
            setTimeout(async () => {
              try {
                const url = `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/conversations?limit=20`
                const res = await fetch(url, { credentials: 'include' })
                const updatedData = await res.json()
                
                if (res.ok) {
                  const updatedConversations = updatedData.conversations || []
                  if (Array.isArray(updatedConversations) && updatedConversations.length > 0) {
                    setConversations(prev => {
                      // Find the conversation in current state
                      const currentConv = prev.find(c => 
                        c._id?.toString() === message.conversationId.toString()
                      )
                      
                      // Find the fetched conversation
                      const fetchedConv = updatedConversations.find(fc => 
                        fc._id?.toString() === message.conversationId.toString()
                      )
                      
                      if (fetchedConv) {
                        // Update existing or add new
                        const existingIndex = prev.findIndex(c => 
                          c._id?.toString() === message.conversationId.toString()
                        )
                        
                        if (existingIndex >= 0) {
                          // Update existing conversation
                          const updated = [...prev]
                          updated[existingIndex] = {
                            ...fetchedConv,
                            // Preserve local unread count if it's higher (we just incremented it)
                            unreadCount: Math.max(currentConv?.unreadCount || 0, fetchedConv.unreadCount || 0),
                            // Keep the last message we set from socket (more recent) or use fetched
                            lastMessage: currentConv?.lastMessage?.updatedAt > fetchedConv.lastMessage?.updatedAt 
                              ? currentConv.lastMessage 
                              : fetchedConv.lastMessage || currentConv?.lastMessage,
                            // Keep the more recent updatedAt
                            updatedAt: currentConv?.updatedAt > fetchedConv.updatedAt 
                              ? currentConv.updatedAt 
                              : fetchedConv.updatedAt
                          }
                          return updated.sort((a, b) => {
                            const aTime = new Date(a.updatedAt || 0).getTime()
                            const bTime = new Date(b.updatedAt || 0).getTime()
                            return bTime - aTime
                          })
                        } else {
                          // Conversation was removed from list, add it back
                          return [fetchedConv, ...prev].sort((a, b) => {
                            const aTime = new Date(a.updatedAt || 0).getTime()
                            const bTime = new Date(b.updatedAt || 0).getTime()
                            return bTime - aTime
                          })
                        }
                      }
                      
                      return prev // No change if fetched conversation not found
                    })
                  }
                }
              } catch (error) {
                console.log('Error refreshing new conversation:', error)
              }
            }, 500)
          }
          
          return sorted
        })
      }

    socket.on('newMessage', handleNewMessage)

    return () => {
      socket.off('newMessage', handleNewMessage)
    }
  }, [socket, user?._id]) // OPTIMIZED: Don't include selectedConversation - use ref instead to prevent recreating listener

  // Mark messages as seen when viewing messages from other user
  useEffect(() => {
    if (!socket || !selectedConversation?._id || !user?._id || messages.length === 0) return

    // Check if the last message is from the other user (not current user)
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) return

    let lastMessageSenderId = ''
    if (lastMessage.sender?._id) {
      lastMessageSenderId = typeof lastMessage.sender._id === 'string' ? lastMessage.sender._id : lastMessage.sender._id.toString()
    } else if (lastMessage.sender) {
      lastMessageSenderId = typeof lastMessage.sender === 'string' ? lastMessage.sender : String(lastMessage.sender)
    }

    let currentUserId = ''
    if (user?._id) {
      currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
    }

    // If last message is from the other user, mark messages as seen
    if (lastMessageSenderId !== '' && currentUserId !== '' && lastMessageSenderId !== currentUserId) {
      const otherUser = selectedConversation.participants[0]
      if (otherUser?._id) {
        socket.emit("markmessageasSeen", {
          conversationId: selectedConversation._id,
          userId: otherUser._id
        })
      }
    }
  }, [socket, selectedConversation, user?._id, messages])

  // Handle messagesSeen event to update message seen status
  useEffect(() => {
    if (!socket) return

    const handleMessagesSeen = ({ conversationId }) => {
      if (selectedConversation?._id && conversationId === selectedConversation._id.toString()) {
        // Update messages to mark them as seen - ONLY for messages sent by current user
        setMessages((prev) => {
          return prev.map((message) => {
            // Only mark as seen if this message was sent by the current user
            let msgSenderId = ''
            if (message.sender?._id) {
              msgSenderId = typeof message.sender._id === 'string' ? message.sender._id : message.sender._id.toString()
            } else if (message.sender) {
              msgSenderId = typeof message.sender === 'string' ? message.sender : String(message.sender)
            }
            
            const currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
            const isOwnMessage = msgSenderId !== '' && currentUserId !== '' && msgSenderId === currentUserId
            
            // Only update seen status for messages sent by current user
            if (isOwnMessage && !message.seen) {
              return { ...message, seen: true }
            }
            return message
          })
        })

        // Update conversations list to mark lastMessage as seen and clear unread count
        // Only update if the last message was sent by current user
        setConversations((prev) => {
          return prev.map((conv) => {
            if (conv._id && conv._id.toString() === conversationId) {
              // Check if last message is from current user
              let lastMessageSenderId = ''
              if (conv.lastMessage?.sender?._id) {
                lastMessageSenderId = typeof conv.lastMessage.sender._id === 'string' 
                  ? conv.lastMessage.sender._id 
                  : conv.lastMessage.sender._id.toString()
              } else if (conv.lastMessage?.sender) {
                lastMessageSenderId = typeof conv.lastMessage.sender === 'string' 
                  ? conv.lastMessage.sender 
                  : String(conv.lastMessage.sender)
              }
              
              const currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
              const isLastMessageFromMe = lastMessageSenderId !== '' && 
                                         currentUserId !== '' && 
                                         lastMessageSenderId === currentUserId
              
              return {
                ...conv,
                lastMessage: {
                  ...conv.lastMessage,
                  // Only mark as seen if it's the current user's message
                  seen: isLastMessageFromMe ? true : conv.lastMessage?.seen || false
                },
                unreadCount: 0
              }
            }
            return conv
          })
        })
      }
    }

    socket.on("messagesSeen", handleMessagesSeen)

    return () => {
      socket.off("messagesSeen", handleMessagesSeen)
    }
  }, [socket, selectedConversation?._id])

  // Listen for call started - update inCall status when users become busy
  useEffect(() => {
    if (!socket) return

    const handleCallStarted = ({ userToCall, from }) => {
      // Update conversations state to mark users as IN call
      setConversations(prev => prev.map(conv => {
        const updatedParticipants = conv.participants.map(participant => {
          // Check if this participant is starting a call
          if (participant._id === userToCall || participant._id === from) {
            return { ...participant, inCall: true }
          }
          return participant
        })
        return { ...conv, participants: updatedParticipants }
      }))
      
      // Also update selectedConversation if it's the user starting a call
      setSelectedConversation(prev => {
        if (!prev) return prev
        
        const updatedParticipants = prev.participants.map(participant => {
          // Check if this participant is starting a call
          if (participant._id === userToCall || participant._id === from) {
            return { ...participant, inCall: true }
          }
          return participant
        })
        
        return { ...prev, participants: updatedParticipants }
      })
    }

    socket.on("callBusy", handleCallStarted)

    return () => {
      socket.off("callBusy", handleCallStarted)
    }
  }, [socket])

  // Listen for call cancelled/ended - update inCall status for all users
  useEffect(() => {
    if (!socket) return

    const handleCallEnded = ({ userToCall, from }) => {
      // Update conversations state to mark users as NOT in call
      setConversations(prev => prev.map(conv => {
        const updatedParticipants = conv.participants.map(participant => {
          // Check if this participant was in the call
          if (participant._id === userToCall || participant._id === from) {
            return { ...participant, inCall: false }
          }
          return participant
        })
        return { ...conv, participants: updatedParticipants }
      }))
      
      // Also update selectedConversation if it's the user who was in the call
      setSelectedConversation(prev => {
        if (!prev) return prev
        
        const updatedParticipants = prev.participants.map(participant => {
          // Check if this participant was in the call
          if (participant._id === userToCall || participant._id === from) {
            return { ...participant, inCall: false }
          }
          return participant
        })
        
        return { ...prev, participants: updatedParticipants }
      })
    }

    socket.on("cancleCall", handleCallEnded)

    return () => {
      socket.off("cancleCall", handleCallEnded)
    }
  }, [socket])

  // Refresh participant data (including inCall status) when selecting a conversation
  // This ensures User C sees updated status when clicking on conversations
  useEffect(() => {
    const refreshParticipantData = async () => {
      if (!selectedConversation || !selectedConversation.participants[0]?._id) return
      
      try {
        const participantId = selectedConversation.participants[0]._id
        const res = await fetch(
          `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${participantId}`,
          { credentials: 'include' }
        )
        
        if (res.ok) {
          const userData = await res.json()
          
          // Update the selected conversation with fresh user data
          setSelectedConversation(prev => ({
            ...prev,
            participants: [userData]
          }))
          
          // Also update in conversations list
          setConversations(prev => prev.map(conv => {
            if (conv._id === selectedConversation._id) {
              return {
                ...conv,
                participants: [userData]
              }
            }
            return conv
          }))
        }
      } catch (error) {
        console.log('Error refreshing participant data:', error)
      }
    }
    
    refreshParticipantData()
  }, [selectedConversation?._id])

  // Listen for typing indicator from other user
  useEffect(() => {
    if (!socket || !selectedConversation?._id) return

    const handleUserTyping = ({ userId, conversationId, isTyping: typingStatus }) => {
      // Check if this is for the current conversation
      if (selectedConversation?._id && conversationId === selectedConversation._id.toString()) {
        setIsTyping(typingStatus)
      }
    }

    socket.on("userTyping", handleUserTyping)

    return () => {
      socket.off("userTyping", handleUserTyping)
    }
  }, [socket, selectedConversation?._id])

  // Listen for reaction updates
  useEffect(() => {
    if (!socket || !selectedConversation?._id) return

    const handleReactionUpdate = async ({ conversationId, messageId }) => {
      // Check if this is for the current conversation
      if (selectedConversation?._id && conversationId === selectedConversation._id.toString()) {
        // Refetch messages to get updated reactions
        try {
          const otherUser = selectedConversation.participants[0]
          if (otherUser?._id) {
            const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${otherUser._id}?limit=12`, {
              credentials: 'include',
            })
            const data = await res.json()
            if (res.ok) {
              setMessages(data.messages || [])
              setHasMoreMessages(data.hasMore || false)
            }
          }
        } catch (error) {
          console.log('Error fetching updated messages:', error)
        }
      }
    }

    socket.on("messageReactionUpdated", handleReactionUpdate)

    // Listen for message deletion
    const handleMessageDeleted = ({ conversationId, messageId }) => {
      if (selectedConversation?._id && selectedConversation._id.toString() === conversationId) {
        setMessages((prev) => prev.filter((msg) => msg._id !== messageId))
      }
    }
    socket.on("messageDeleted", handleMessageDeleted)

    return () => {
      socket.off("messageReactionUpdated", handleReactionUpdate)
      socket.off("messageDeleted", handleMessageDeleted)
    }
  }, [socket, selectedConversation?._id])

  // Handle typing indicator - emit typingStart when user types
  const handleTyping = () => {
    if (!socket || !selectedConversation?._id || !user?._id) return

    const recipientId = selectedConversation.participants[0]?._id
    if (!recipientId) return

    // Emit typing start
    socket.emit("typingStart", {
      from: user._id,
      to: recipientId,
      conversationId: selectedConversation._id
    })

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Set timeout to emit typing stop after 2 seconds of no typing
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typingStop", {
        from: user._id,
        to: recipientId,
        conversationId: selectedConversation._id
      })
    }, 2000)
  }

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  // Start conversation with a user
  const startConversation = async (recipientId) => {
    setSearchQuery('')
    // Check if conversation already exists
    const existingConv = conversations.find((conv) =>
      conv.participants.some((p) => p._id === recipientId)
    )

    if (existingConv) {
      setSelectedConversation(existingConv)
      // Fetch messages for this conversation
      try {
        const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${recipientId}?limit=12`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (res.ok) {
          setMessages(data.messages || [])
          setHasMoreMessages(data.hasMore || false)
        }
      } catch (error) {
        showToast('Error', 'Failed to load messages', 'error')
      }
    } else {
      // Create a temporary conversation object
      const recipientUser = followedUsers.find((u) => u._id === recipientId)
      if (recipientUser) {
        setSelectedConversation({
          _id: null,
          participants: [recipientUser],
        })
        setMessages([])
      }
    }
  }

  // Handle reaction toggle
  const handleReaction = async (messageId, emoji) => {
    if (!user?._id) return

    try {
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/reaction/${messageId}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ emoji }),
      })

      const updatedMessage = await res.json()
      if (res.ok) {
        // Update the message in the messages array
        setMessages((prev) =>
          prev.map((msg) => (msg._id === messageId ? updatedMessage : msg))
        )
      }
    } catch (error) {
      console.log('Error toggling reaction:', error)
    }
  }

  // Handle emoji picker click
  const handleEmojiClick = (emojiData, messageId) => {
    const emoji = emojiData.emoji || emojiData
    handleReaction(messageId, emoji)
    setEmojiPickerOpen(null)
  }

  // Handle message click to show emoji picker
  const handleMessageClick = (e, messageId) => {
    e.stopPropagation()
    // Toggle emoji picker for this message
    setEmojiPickerOpen(emojiPickerOpen === messageId ? null : messageId)
  }

  // Handle reply to message
  const handleReply = (message) => {
    setReplyingTo(message)
    setEmojiPickerOpen(null) // Close emoji picker if open
    // Focus on input after a small delay to ensure it's rendered
    setTimeout(() => {
      messageInputRef.current?.focus()
    }, 100)
  }

  // Cancel reply
  const handleCancelReply = () => {
    setReplyingTo(null)
  }

  // Delete message
  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Are you sure you want to delete this message?')) return

    try {
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/message/${messageId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      const data = await res.json()

      if (res.ok) {
        // Remove message from local state
        setMessages((prev) => prev.filter((msg) => msg._id !== messageId))
        showToast('Success', 'Message deleted successfully', 'success')
      } else {
        showToast('Error', data.error || 'Failed to delete message', 'error')
      }
    } catch (error) {
      showToast('Error', 'Failed to delete message', 'error')
      console.log('Error deleting message:', error)
    }
  }

  // Delete conversation
  const handleDeleteConversation = async (conversationId) => {
    if (!window.confirm('Are you sure you want to delete this conversation? This will delete all messages.')) return

    try {
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/conversation/${conversationId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      const data = await res.json()

      if (res.ok) {
        // Remove conversation from list
        setConversations((prev) => prev.filter((conv) => conv._id !== conversationId))
        // Clear selected conversation and messages
        if (selectedConversation?._id === conversationId) {
          setSelectedConversation(null)
          setMessages([])
        }
        showToast('Success', 'Conversation deleted successfully', 'success')
      } else {
        showToast('Error', data.error || 'Failed to delete conversation', 'error')
      }
    } catch (error) {
      showToast('Error', 'Failed to delete conversation', 'error')
      console.log('Error deleting conversation:', error)
    }
  }

  // Cleanup preview URL on unmount or when image changes
  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview)
      }
    }
  }, [imagePreview])

  // Handle file selection with video compression if needed
  const handleFileSelect = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    // Check if file is image or video
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      showToast("Invalid file type", "Please select an image or video file", "error")
      return
    }

    const fileSizeMB = file.size / (1024 * 1024)
    const maxSize = 100 * 1024 * 1024 // 100MB
    
    // For images, check size immediately (no compression)
    if (file.type.startsWith("image/")) {
      if (file.size > maxSize) {
        showToast("File too large", `Image (${fileSizeMB.toFixed(1)}MB) exceeds Cloudinary's 100MB limit. Please use a smaller image.`, "error")
        if (imageInputRef.current) {
          imageInputRef.current.value = ''
        }
        return
      }
    }
    
    // For videos, check duration and warn (Cloudinary free tier only allows 10 seconds)
    if (file.type.startsWith('video/')) {
      // Check video duration and warn user (don't block - let them try)
      try {
        const video = document.createElement('video')
        video.preload = 'metadata'
        const videoUrl = URL.createObjectURL(file)
        video.src = videoUrl
        
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = () => {
            URL.revokeObjectURL(videoUrl)
            const duration = video.duration
            if (duration > 10) {
              // Warn but don't block - user can still try to upload
              showToast(
                "Warning: Video Duration", 
                `Your video is ${duration.toFixed(1)} seconds. Cloudinary free tier only supports videos up to 10 seconds. The upload may fail. Consider upgrading Cloudinary or trimming the video.`, 
                "warning", 
                8000
              )
            }
            resolve() // Always resolve - don't block upload
          }
          video.onerror = () => {
            URL.revokeObjectURL(videoUrl)
            // Don't block on metadata error, just continue
            resolve()
          }
          // Timeout after 3 seconds - don't block upload
          setTimeout(() => {
            URL.revokeObjectURL(videoUrl)
            resolve() // Resolve anyway, don't block
          }, 3000)
        })
      } catch (error) {
        // Don't block on error, just log it
        console.warn('Could not check video duration:', error)
      }
    }

    // Store file for preview
    setImage(file)
    const previewURL = URL.createObjectURL(file)
    setImagePreview(previewURL)
    setUploadProgress(0)
    setIsProcessing(false)

    // Compress videos only if they're over 100MB (Cloudinary's limit)
    // Videos under 100MB can upload directly without compression (faster)
    if (file.type.startsWith('video/')) {
      // Only compress if file is over Cloudinary's 100MB limit
      if (fileSizeMB > 95) {
        setIsProcessing(true)
        setUploadProgress(10) // Show initial progress
        
        try {
          showToast("Compressing video", "Please wait while we compress your video for optimal upload...", "info", 5000)
          
          console.log('Starting compression for file:', file.name, 'Size:', fileSizeMB.toFixed(2), 'MB')
          
          // Add compression timeout (2 minutes)
          const compressionTimeout = setTimeout(() => {
            console.warn('Compression taking too long, might skip...')
          }, 120000)
          
          const compressedFile = await Promise.race([
            compressVideo(file, {
              maxSizeMB: 95, // Target under 100MB Cloudinary limit
              quality: fileSizeMB > 100 ? 'low' : 'medium',
              timeout: 120000, // 2 minutes timeout
              progressCallback: (progress) => {
                // Compression progress: 10-80% of total (80% for compression, 20% for upload)
                const calculatedProgress = 10 + (progress * 0.7)
                setUploadProgress(calculatedProgress)
                console.log('Compression progress:', calculatedProgress.toFixed(1) + '%')
              }
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Compression timeout after 2 minutes')), 120000)
            )
          ])
          
          clearTimeout(compressionTimeout)
          
          const compressedSizeMB = compressedFile.size / (1024 * 1024)
          console.log(`Video compressed: ${fileSizeMB.toFixed(2)}MB → ${compressedSizeMB.toFixed(2)}MB`)
          
          // Update with compressed file
          setImage(compressedFile)
          
          // Update preview with compressed file
          if (previewURL && previewURL.startsWith('blob:')) {
            URL.revokeObjectURL(previewURL)
          }
          const newPreviewURL = URL.createObjectURL(compressedFile)
          setImagePreview(newPreviewURL)
          
          setUploadProgress(80) // Ready for upload
          setIsProcessing(false)
          
          // Check if compressed file is still too large
          if (compressedSizeMB > 95) {
            showToast("Warning", `Video compressed to ${compressedSizeMB.toFixed(2)}MB, which is close to the limit. Upload may fail if it exceeds 100MB.`, "warning", 5000)
          } else {
            showToast("Compression complete", `Video compressed to ${compressedSizeMB.toFixed(2)}MB`, "success")
          }
      } catch (error) {
        console.error('Video compression error:', error)
        setUploadProgress(0)
        setIsProcessing(false)
        
        // If compression fails, try uploading original file if it's under 100MB
        if (fileSizeMB < 100) {
          showToast("Compression skipped", "Uploading original file without compression...", "info", 3000)
          // Keep the original file for upload - don't clear it
        } else {
          setImage(null)
          setImagePreview('')
          showToast("Compression failed", error.message || "Failed to compress video. Please try a smaller file or check your browser console.", "error", 8000)
          
          if (imageInputRef.current) {
            imageInputRef.current.value = ''
          }
          return
        }
      }
      } // Close if (fileSizeMB > 95)
      // Videos under 95MB: file already set on line 789, no compression needed - proceed with upload
    }
  }

  // Handle image/video file selection (fallback - use handleFileSelect instead)
  const handleImageChange = (event) => {
    handleFileSelect(event)
  }

  // Clear image preview
  const handleClearImage = () => {
    // Revoke object URL to free memory
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview)
    }
    setImage(null)
    setImagePreview('')
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
  }

  // Close emoji picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      // Close reaction emoji picker
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        // Also check if click is not on a message bubble
        const messageBubble = event.target.closest('[data-message-id]')
        if (!messageBubble) {
          setEmojiPickerOpen(null)
        }
      }
      // Close message emoji picker (G button)
      if (emojiPickerForMessageRef.current && !emojiPickerForMessageRef.current.contains(event.target)) {
        // Check if click is not on the G button
        const gButton = event.target.closest('[title="Send emoji"]')
        if (!gButton) {
          setEmojiPickerForMessage(false)
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Send message
  const handleSendMessage = async (e) => {
    // CRITICAL: Prevent any navigation or reload
    if (e) {
      e.preventDefault()
      e.stopPropagation()
      if (e.nativeEvent) {
        e.nativeEvent.stopImmediatePropagation()
      }
    }
    
    // Prevent default browser behavior
    if (e && e.preventDefault) e.preventDefault()
    if (e && e.stopPropagation) e.stopPropagation()
    
    // Allow sending if there's text, image, or both, but require at least one
    if ((!newMessage.trim() && !image && !imagePreview) || !selectedConversation || sending) {
      return false
    }

    const recipientId = selectedConversation.participants[0]?._id
    if (!recipientId) return false

    // Stop typing indicator when sending message
    if (socket && selectedConversation?._id && user?._id) {
      socket.emit("typingStop", {
        from: user._id,
        to: recipientId,
        conversationId: selectedConversation._id
      })
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    setSending(true)
    setUploadProgress(0) // Reset progress
    
    try {
      // If no file, send as JSON (no FormData needed)
      if (!image || !(image instanceof File)) {
        const url = `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message`
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipientId,
            message: newMessage || '',
            replyTo: replyingTo?._id || null
          }),
          credentials: 'include',
          redirect: 'manual' // CRITICAL: Prevent any redirects that could cause reload
        })
        
        // Check for redirect status codes
        if (response.type === 'opaqueredirect' || response.status === 301 || response.status === 302) {
          console.error('Unexpected redirect detected')
          throw new Error('Server returned a redirect - this should not happen')
        }
        
        if (!response.ok) {
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || errorData.message || 'Failed to send message')
          } else {
            throw new Error(`Server error: ${response.status} ${response.statusText}`)
          }
        }
        
        // Verify response is JSON
        const contentType = response.headers.get('content-type')
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Server returned non-JSON response:', contentType)
          throw new Error('Server returned invalid response format')
        }
        
        const data = await response.json()
        handleMessageSent(data)
        return false
      }
      
      // Upload file via Multer to Cloudinary (backend handles upload)
      const formData = new FormData()
      formData.append('recipientId', recipientId)
      formData.append('message', newMessage || '')
      formData.append('file', image)
      
      // Add replyTo to formData if exists
      if (replyingTo?._id) {
        formData.append('replyTo', replyingTo._id)
      }
      
      // Track upload progress using Promise wrapper around XHR
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        
        // Upload progress tracking
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = 80 + ((e.loaded / e.total) * 20)
            setUploadProgress(Math.min(progress, 100))
          }
        })
        
        xhr.addEventListener('load', () => {
          if (xhr.status === 201) {
            setUploadProgress(100)
            try {
              const data = JSON.parse(xhr.responseText)
              handleMessageSent(data)
              resolve(data)
            } catch (error) {
              console.error('Error parsing response:', error)
              reject(new Error('Failed to parse server response'))
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText)
              reject(new Error(errorData.error || errorData.message || 'Failed to send message'))
            } catch (error) {
              reject(new Error(`Failed to send message: ${xhr.statusText}`))
            }
          }
        })
        
        xhr.onerror = () => {
          reject(new Error('Network error while sending message'))
        }
        
        xhr.ontimeout = () => {
          reject(new Error('Upload timeout. Please try again.'))
        }
        
        xhr.open('POST', `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message`, true)
        xhr.withCredentials = true
        xhr.timeout = 1200000 // 20 minutes timeout for large uploads
        xhr.send(formData)
      })
      
    } catch (error) {
      console.error('Error sending message:', error)
      showToast('Error', error.message || 'Failed to send message', 'error')
      setUploadProgress(0)
      setSending(false)
    }
    
    return false // Always return false to prevent any default behavior
  }
  
  // Helper function to handle successful message send
  const handleMessageSent = (data) => {
    // Clear processing state
    setIsProcessing(false)
    setUploadProgress(0)

    if (data) {
      // Ensure the message has sender data from current user context
      const messageWithSender = {
        ...data,
        sender: data.sender || {
          _id: user._id,
          name: user.name,
          username: user.username,
          profilePic: user.profilePic
        }
      }
      setMessages((prev) => {
        const updated = [...prev, messageWithSender]
        // Limit to 200 messages max to prevent memory issues
        // If over limit, remove oldest messages (keep most recent 200)
        if (updated.length > 200) {
          return updated.slice(-200)
        }
        return updated
      })
      setNewMessage('')
      // Revoke object URL to free memory
      const currentPreview = imagePreview
      setImage(null) // Clear image after sending
      setImagePreview('') // Clear image preview first
      if (currentPreview && currentPreview.startsWith('blob:')) {
        URL.revokeObjectURL(currentPreview)
      }
      setReplyingTo(null) // Clear reply after sending
      setUploadProgress(0) // Reset progress
      setIsProcessing(false) // Clear processing state
      setSending(false) // Stop spinner immediately after message is added
      
      // Update conversation in place instead of full refresh to avoid UI flicker
      setConversations(prev => {
        const updated = prev.map(conv => {
          if (conv._id && data.conversationId && conv._id.toString() === data.conversationId.toString()) {
            return {
              ...conv,
              lastMessage: {
                text: data.text || '',
                sender: data.sender || {
                  _id: user._id,
                  name: user.name,
                  username: user.username,
                  profilePic: user.profilePic
                },
                createdAt: new Date().toISOString()
              },
              updatedAt: new Date().toISOString()
            }
          }
          return conv
        })
        
        // If this is a new conversation (not in list yet), add it at the top
        const existingConv = updated.find(c => c._id && data.conversationId && c._id.toString() === data.conversationId.toString())
        if (!existingConv && data.conversationId) {
          // Create a minimal conversation object for new conversations
          const newConv = {
            _id: data.conversationId,
            participants: selectedConversation?.participants || [],
            lastMessage: {
              text: data.text || '',
              sender: data.sender || {
                _id: user._id,
                name: user.name,
                username: user.username,
                profilePic: user.profilePic
              },
              createdAt: new Date().toISOString()
            },
            updatedAt: new Date().toISOString(),
            unreadCount: 0
          }
          // Add to front and sort by updatedAt (most recent first)
          return [newConv, ...updated].sort((a, b) => {
            const aTime = new Date(a.updatedAt || 0).getTime()
            const bTime = new Date(b.updatedAt || 0).getTime()
            return bTime - aTime
          })
        }
        
        // Sort by updatedAt to keep most recent at top
        return updated.sort((a, b) => {
          const aTime = new Date(a.updatedAt || 0).getTime()
          const bTime = new Date(b.updatedAt || 0).getTime()
          return bTime - aTime
        })
      })
      
      // If this was a new conversation, update selectedConversation to the real one
      if (selectedConversation && !selectedConversation._id && data.conversationId) {
        setSelectedConversation(prev => ({
          ...prev,
          _id: data.conversationId
        }))
      }
    }
  }

  // Filter followed users based on search
  const filteredUsers = followedUsers.filter((u) =>
    u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <Flex justifyContent="center" p={8}>
        <Spinner size="xl" />
      </Flex>
    )
  }

  return (
    <Flex h="100%" gap={0} position="relative">
        {/* Left Sidebar - Conversations & Search */}
      <Box
        w={{ base: "100%", md: "350px" }}
        borderRight="1px solid"
        borderColor={borderColor}
        bg={bgColor}
        display={{ base: selectedConversation ? 'none' : 'flex', md: 'flex' }}
        h="100%"
        flexDirection="column"
        position={{ base: 'absolute', md: 'relative' }}
        left={0}
        top={0}
        zIndex={{ base: 10, md: 'auto' }}
      >
        <Box p={4} borderBottom="1px solid" borderColor={borderColor}>
          <Text fontSize="xl" fontWeight="bold" mb={4} color={useColorModeValue('black', 'white')}>
            Messages
          </Text>
          <Text fontSize="sm" mb={3} color="gray.500">
            Search for friends
          </Text>
          <InputGroup>
            <InputLeftElement pointerEvents="none">
              <SearchIcon color="gray.400" />
            </InputLeftElement>
            <Input
              placeholder="Search for friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              bg={inputBg}
              borderRadius="full"
            />
          </InputGroup>
        </Box>

        <Box 
          ref={conversationsContainerRef}
          overflowY="auto" 
          flex={1}
          onScroll={(e) => {
            const container = e.target
            // Check if scrolled to bottom (within 50px)
            if (container.scrollHeight - container.scrollTop - container.clientHeight <= 50) {
              loadMoreConversations()
            }
          }}
        >
          {/* Search Results */}
          {searchQuery && (
            <VStack align="stretch" p={2} spacing={0}>
              {filteredUsers.map((u) => (
                <Flex
                  key={u._id}
                  p={4}
                  cursor="pointer"
                  _hover={{ bg: hoverBg }}
                  onClick={() => startConversation(u._id)}
                  alignItems="center"
                  gap={3}
                  borderBottom="1px solid"
                  borderColor={borderColor}
                >
                  <Box position="relative">
                    <Avatar 
                      size="md" 
                      src={u.profilePic} 
                      name={u.name || u.username || 'User'}
                      bg={useColorModeValue('blue.500', 'blue.600')}
                    />
                    {onlineUser?.some(ou => (ou.userId || ou._id) === u._id) && (
                      <Box
                        position="absolute"
                        bottom={0}
                        right={0}
                        w={3}
                        h={3}
                        bg="green.500"
                        borderRadius="full"
                        border="2px solid"
                        borderColor={bgColor}
                      />
                    )}
                  </Box>
                  <Box flex={1} minW={0}>
                    <Text fontWeight="semibold" noOfLines={1} color={useColorModeValue('black', 'white')}>
                      {u.name || u.username || 'Unknown User'}
                    </Text>
                    {u.username && u.name !== u.username && (
                      <Text fontSize="xs" color="gray.500" noOfLines={1} mt={0.5}>
                        @{u.username}
                      </Text>
                    )}
                  </Box>
                </Flex>
              ))}
              {filteredUsers.length === 0 && (
                <Text px={4} py={8} color="gray.500" fontSize="sm" textAlign="center">
                  No users found
                </Text>
              )}
            </VStack>
          )}

          {/* Conversations List */}
          {!searchQuery && (
            <VStack align="stretch" spacing={0}>
              {loading && conversations.length === 0 ? (
                <Flex justify="center" py={8}>
                  <Spinner size="lg" />
                </Flex>
              ) : conversations.length === 0 ? (
                <Text px={4} py={8} color="gray.500" textAlign="center" fontSize="sm">
                  No conversations yet. Search for friends to start chatting!
                </Text>
              ) : (
                <>
                  {conversations.map((conv) => {
                  const otherUser = conv.participants[0]
                  const isSelected =
                    selectedConversation?._id === conv._id ||
                    (selectedConversation?.participants[0]?._id === otherUser?._id &&
                      !selectedConversation?._id)

                  return (
                    <Flex
                      key={conv._id || otherUser._id}
                      p={4}
                      cursor="pointer"
                      bg={isSelected ? hoverBg : 'transparent'}
                      _hover={{ bg: hoverBg }}
                      onClick={() => {
                        setSelectedConversation(conv)
                        // Mark messages as seen when conversation is clicked
                        if (conv._id && socket && user?._id && otherUser?._id && conv.unreadCount > 0) {
                          socket.emit("markmessageasSeen", {
                            conversationId: conv._id,
                            userId: otherUser._id
                          })
                        }
                        // Clear unread count for this conversation in UI
                        if (conv.unreadCount > 0) {
                          setConversations(prev => prev.map(c => 
                            c._id === conv._id ? { ...c, unreadCount: 0 } : c
                          ))
                        }
                      }}
                      borderBottom="1px solid"
                      borderColor={borderColor}
                      alignItems="center"
                      gap={3}
                      position="relative"
                    >
                      <Box position="relative">
                        <Avatar
                          size="md"
                          src={otherUser?.profilePic}
                          name={otherUser?.name || otherUser?.username || 'User'}
                          bg={useColorModeValue('blue.500', 'blue.600')}
                        />
                        {onlineUser?.some(u => (u.userId || u._id) === otherUser?._id) && (
                          <Box
                            position="absolute"
                            bottom={0}
                            right={0}
                            w={3}
                            h={3}
                            bg="green.500"
                            borderRadius="full"
                            border="2px solid"
                            borderColor={bgColor}
                          />
                        )}
                      </Box>
                      <Box flex={1} minW={0} position="relative">
                        <Flex alignItems="center" gap={2}>
                          <Text fontWeight="semibold" noOfLines={1} color={useColorModeValue('black', 'white')}>
                            {otherUser?.name || otherUser?.username || 'Unknown User'}
                          </Text>
                          {conv.unreadCount > 0 && (
                            <Badge
                              borderRadius="full"
                              bg="red.500"
                              color="white"
                              fontSize="10px"
                              minW="20px"
                              h="20px"
                              display="flex"
                              alignItems="center"
                              justifyContent="center"
                              px={1.5}
                            >
                              {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                            </Badge>
                          )}
                        </Flex>
                        {otherUser?.username && otherUser?.name !== otherUser?.username && (
                          <Text fontSize="xs" color="gray.500" noOfLines={1} mt={0.5}>
                            @{otherUser.username}
                          </Text>
                        )}
                        {/* Last message with seen indicator */}
                        {conv.lastMessage && (() => {
                          // Check if last message is from current user
                          let lastMessageSenderId = ''
                          if (conv.lastMessage.sender?._id) {
                            lastMessageSenderId = typeof conv.lastMessage.sender._id === 'string' 
                              ? conv.lastMessage.sender._id 
                              : conv.lastMessage.sender._id.toString()
                          } else if (conv.lastMessage.sender) {
                            lastMessageSenderId = typeof conv.lastMessage.sender === 'string' 
                              ? conv.lastMessage.sender 
                              : String(conv.lastMessage.sender)
                          }
                          
                          let currentUserId = ''
                          if (user?._id) {
                            currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
                          }
                          
                          const isLastMessageFromMe = lastMessageSenderId !== '' && 
                                                     currentUserId !== '' && 
                                                     lastMessageSenderId === currentUserId
                          
                          // Get sender name for display
                          let senderName = ''
                          if (conv.lastMessage.sender) {
                            if (typeof conv.lastMessage.sender === 'object') {
                              senderName = conv.lastMessage.sender.name || conv.lastMessage.sender.username || ''
                            }
                          }
                          
                          const messagePreview = conv.lastMessage.text?.length > 30 
                            ? conv.lastMessage.text.substring(0, 30) + "..." 
                            : conv.lastMessage.text || "📷 Image"
                          
                          return (
                            <Flex alignItems="center" gap={1} mt={0.5}>
                              {/* Show seen indicator only if current user sent the last message */}
                              {isLastMessageFromMe && (
                                <Box color={conv.lastMessage.seen ? "blue.600" : "gray.400"}>
                                  <BsCheck2All size={14} />
                                </Box>
                              )}
                              <Text 
                                fontSize="xs" 
                                color="gray.500" 
                                noOfLines={1}
                                flex={1}
                                minW={0}
                              >
                                {isLastMessageFromMe 
                                  ? `You: ${messagePreview}`
                                  : senderName 
                                    ? `${senderName}: ${messagePreview}`
                                    : messagePreview}
                              </Text>
                            </Flex>
                          )
                        })()}
                      </Box>
                    </Flex>
                  )
                  })}
                  {/* Loading indicator for more conversations */}
                  {loadingMoreConversations && (
                    <Flex justify="center" py={4}>
                      <Spinner size="sm" color="blue.500" />
                    </Flex>
                  )}
                </>
              )}
            </VStack>
          )}
        </Box>
      </Box>

      {/* Main Chat Area */}
      <Box 
        flex={1} 
        display="flex" 
        flexDirection="column" 
        bg={bgColor}
        w={{ base: "100%", md: "auto" }}
        minW={0}
      >
        {selectedConversation ? (
          <>
            {/* Chat Header - Responsive with back button */}
            <Flex
              p={{ base: 2, md: 4 }}
              borderBottom="1px solid"
              borderColor={borderColor}
              alignItems="center"
              gap={{ base: 2, md: 3 }}
            >
              {/* Back button for mobile */}
              <IconButton
                icon={<ArrowBackIcon />}
                aria-label="Back to conversations"
                onClick={() => setSelectedConversation(null)}
                display={{ base: 'flex', md: 'none' }}
                variant="ghost"
                size="sm"
                mr={-2}
              />
              <Avatar
                size={{ base: "sm", md: "sm" }}
                src={selectedConversation.participants[0]?.profilePic}
                name={selectedConversation.participants[0]?.name || selectedConversation.participants[0]?.username || 'User'}
                bg={useColorModeValue('blue.500', 'blue.600')}
              />
              <Flex flex={1} minW={0} alignItems="center" gap={2} flexWrap="wrap">
                <Text 
                  fontWeight="semibold"
                  fontSize={{ base: "sm", md: "md" }}
                  noOfLines={1}
                  color={useColorModeValue('black', 'white')}
                >
                  {selectedConversation.participants[0]?.name || selectedConversation.participants[0]?.username || 'Unknown User'}
                </Text>
                {onlineUser?.some(u => (u.userId || u._id) === selectedConversation.participants[0]?._id) && (
                  <>
                    <Text fontSize={{ base: "2xs", md: "xs" }} color="gray.500">
                      •
                    </Text>
                    <Text fontSize={{ base: "2xs", md: "xs" }} color="green.500">
                      Online
                    </Text>
                  </>
                )}
                {/* Show busy status if user is in a call - check both socket AND database */}
                {(busyUsers?.has(selectedConversation.participants[0]?._id) || selectedConversation.participants[0]?.inCall) && (
                  <>
                    <Text fontSize={{ base: "2xs", md: "xs" }} color="gray.500">
                      •
                    </Text>
                    <Badge colorScheme="red" fontSize={{ base: "2xs", md: "xs" }} px={2} py={0.5} borderRadius="full">
                      In a call
                    </Badge>
                  </>
                )}
              </Flex>
              {/* Delete conversation button */}
              <IconButton
                aria-label="Delete conversation"
                icon={<MdDelete size={18} />}
                size="sm"
                variant="ghost"
                colorScheme="red"
                _hover={{ bg: useColorModeValue('red.100', 'red.900') }}
                onClick={() => handleDeleteConversation(selectedConversation._id)}
              />
            </Flex>

            {/* Call - Inline in chat - Mobile optimized */}
            {callAccepted && !callEnded && stream && (
              <Box
                borderBottom="1px solid"
                borderColor={borderColor}
                p={{ base: 2, md: 4 }}
                bg={useColorModeValue('gray.50', 'gray.900')}
              >
                <Flex direction="column" gap={{ base: 2, md: 3 }}>
                  <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Text fontWeight="semibold" fontSize={{ base: "xs", md: "md" }} color={useColorModeValue('black', 'white')}>
                      {callType === 'audio' ? 'Voice' : 'Video'} Call Active
                    </Text>
                    <Button
                      colorScheme="red"
                      size={{ base: "xs", md: "sm" }}
                      leftIcon={<FaPhoneSlash />}
                      onClick={() => leaveCall?.()}
                      borderRadius="full"
                    >
                      <Text display={{ base: 'none', sm: 'block' }}>End</Text>
                    </Button>
                  </Flex>
                  {callType === 'video' ? (
                    <Flex 
                      gap={{ base: 2, md: 3 }} 
                      flexDirection={{ base: "column", md: "row" }}
                      alignItems={{ base: "stretch", md: "flex-start" }}
                    >
                      {/* Remote video - Full width on mobile */}
                      <Box
                        flex={{ base: 0, md: 1 }}
                        w={{ base: "100%", md: "auto" }}
                        minW={{ base: "100%", md: "300px" }}
                        h={{ base: "250px", sm: "300px", md: "250px" }}
                        borderRadius="md"
                        overflow="hidden"
                        bg="black"
                        position="relative"
                        order={{ base: 1, md: 1 }}
                      >
                        <video
                          ref={userVideo}
                          autoPlay
                          playsInline
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      </Box>
                      {/* Local video - Smaller on mobile, positioned better */}
                      <Box
                        w={{ base: "120px", md: "150px" }}
                        h={{ base: "90px", md: "112px" }}
                        borderRadius="md"
                        overflow="hidden"
                        bg="gray.800"
                        border="2px solid"
                        borderColor={useColorModeValue('gray.200', 'white')}
                        flexShrink={0}
                        alignSelf={{ base: "flex-end", md: "flex-start" }}
                        order={{ base: 2, md: 2 }}
                      >
                        <video
                          ref={myVideo}
                          autoPlay
                          muted
                          playsInline
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      </Box>
                    </Flex>
                  ) : (
                    /* Audio call UI - Show avatar and call info */
                    <Flex 
                      direction="column"
                      alignItems="center"
                      gap={4}
                      py={4}
                    >
                      {/* Hidden video elements to handle audio stream - positioned off-screen for audio playback */}
                      <Box
                        as="video"
                        ref={userVideo}
                        autoPlay
                        playsInline
                        controls={false}
                        style={{ 
                          position: 'absolute',
                          left: '-9999px',
                          width: '1px',
                          height: '1px',
                          opacity: 0,
                          pointerEvents: 'none'
                        }}
                      />
                      <Box
                        as="video"
                        ref={myVideo}
                        autoPlay
                        muted
                        playsInline
                        controls={false}
                        style={{ 
                          position: 'absolute',
                          left: '-9999px',
                          width: '1px',
                          height: '1px',
                          opacity: 0,
                          pointerEvents: 'none'
                        }}
                      />
                      <Avatar
                        src={selectedConversation?.participants[0]?.profilePic}
                        name={selectedConversation?.participants[0]?.username}
                        size="xl"
                      />
                      <Text fontSize="lg" fontWeight="semibold" color={useColorModeValue('black', 'white')}>
                        {selectedConversation?.participants[0]?.name || selectedConversation?.participants[0]?.username}
                      </Text>
                      <Text fontSize="sm" color={useColorModeValue('gray.600', 'gray.400')}>
                        Voice Call
                      </Text>
                    </Flex>
                  )}
                </Flex>
              </Box>
            )}

            {/* Incoming call notification - Mobile optimized */}
            {/* Ringing state - When you are calling someone */}
            {isCalling && call?.isCalling && !callAccepted && (
              <Box
                borderBottom="1px solid"
                borderColor={borderColor}
                p={{ base: 3, md: 4 }}
                bg={useColorModeValue('blue.600', 'blue.900')}
              >
                <Flex direction="column" gap={{ base: 2, md: 3 }} alignItems="center">
                  <Text fontWeight="bold" fontSize={{ base: "md", md: "lg" }} textAlign="center" color="white">
                    Ringing...
                  </Text>
                  <Text fontSize={{ base: "sm", md: "md" }} color="whiteAlpha.800" textAlign="center">
                    {call?.callType === 'audio' ? 'Voice ' : 'Video '}Calling {call?.recipientName || selectedConversation?.participants[0]?.name || selectedConversation?.participants[0]?.username || 'User'}...
                  </Text>
                  <Button
                    colorScheme="red"
                    leftIcon={<FaPhoneSlash />}
                    onClick={() => leaveCall?.()}
                    size={{ base: "sm", md: "md" }}
                  >
                    Cancel
                  </Button>
                </Flex>
              </Box>
            )}


            {/* Messages - Mobile optimized */}
            <Box
              ref={messagesContainerRef}
              flex={1}
              overflowY="auto"
              py={{ base: 2, sm: 3, md: 4 }}
              bg={useColorModeValue('white', '#101010')}
              position="relative"
            >
              <VStack align="stretch" spacing={{ base: 3, md: 4 }} px={{ base: 2, sm: 3, md: 4 }}>
                {/* Loading indicator for older messages */}
                {loadingMoreMessages && (
                  <Flex justify="center" py={2}>
                    <Spinner size="sm" color="blue.500" />
                  </Flex>
                )}
                {messages.map((msg) => {
                    // Better comparison for message ownership - handle all cases
                    let msgSenderId = ''
                    if (msg.sender?._id) {
                      msgSenderId = typeof msg.sender._id === 'string' ? msg.sender._id : msg.sender._id.toString()
                    } else if (msg.sender) {
                      msgSenderId = typeof msg.sender === 'string' ? msg.sender : String(msg.sender)
                    }
                    
                    let currentUserId = ''
                    if (user?._id) {
                      currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
                    }
                    
                    const isOwn = msgSenderId !== '' && currentUserId !== '' && msgSenderId === currentUserId
                    
                    // Get the correct user data for avatar
                    let senderUser = msg.sender || {}
                    if (isOwn && user) {
                      // For own messages, always use current user data
                      senderUser = {
                        _id: user._id,
                        name: user.name,
                        username: user.username,
                        profilePic: user.profilePic,
                        ...(msg.sender || {}) // Merge with any sender data from message
                      }
                    }
                    
                    return (
                      <Flex
                        key={msg._id || Math.random()}
                        justifyContent={isOwn ? 'flex-end' : 'flex-start'}
                        alignItems="flex-end"
                        gap={{ base: 1.5, md: 2 }}
                        direction={isOwn ? 'row-reverse' : 'row'}
                        w="100%"
                        position="relative"
                        data-message-id={msg._id}
                      >
                      <Avatar
                        size={{ base: "xs", sm: "sm" }}
                        src={senderUser?.profilePic || undefined}
                        name={senderUser?.name || senderUser?.username || 'User'}
                        display={{ base: "none", sm: "flex" }}
                        bg={useColorModeValue('blue.500', 'blue.600')}
                      />
                      <Flex 
                        direction="column" 
                        maxW={{ base: "85%", sm: "75%", md: "70%" }} 
                        align={isOwn ? 'flex-end' : 'flex-start'} 
                        minW={0}
                        ml={isOwn ? 'auto' : 0}
                        mr={isOwn ? 0 : 'auto'}
                      >
                        <Flex
                          direction="column"
                          w="100%"
                        >
                          {/* Quoted message (replyTo) */}
                          {msg.replyTo && (
                            <Box
                              w="100%"
                              mb={1}
                              p={2}
                              bg={useColorModeValue('gray.100', 'gray.800')}
                              borderRadius="md"
                              borderLeft="3px solid"
                              borderLeftColor="blue.500"
                              cursor="pointer"
                              onClick={(e) => {
                                e.stopPropagation()
                                // Scroll to original message
                                const originalMsg = document.querySelector(`[data-message-id="${msg.replyTo._id}"]`)
                                if (originalMsg) {
                                  originalMsg.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                  const bgColor = useColorModeValue('yellow.100', 'yellow.900')
                                  originalMsg.style.transition = 'background-color 0.3s'
                                  originalMsg.style.backgroundColor = bgColor
                                  setTimeout(() => {
                                    originalMsg.style.backgroundColor = ''
                                  }, 2000)
                                }
                              }}
                            >
                              <Text fontSize="xs" color="blue.500" fontWeight="semibold" mb={0.5}>
                                {(() => {
                                  const replySenderId = msg.replyTo.sender?._id ? 
                                    (typeof msg.replyTo.sender._id === 'string' ? msg.replyTo.sender._id : msg.replyTo.sender._id.toString()) :
                                    (typeof msg.replyTo.sender === 'string' ? msg.replyTo.sender : String(msg.replyTo.sender))
                                  const currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
                                  return replySenderId === currentUserId ? 'You' : (msg.replyTo.sender?.name || msg.replyTo.sender?.username || 'User')
                                })()}
                              </Text>
                              <Text fontSize="xs" color={useColorModeValue('gray.600', 'gray.400')} noOfLines={1}>
                                {msg.replyTo.text || 'Message'}
                              </Text>
                            </Box>
                          )}
                          {/* Image/Video display */}
                          {msg.img && typeof msg.img === 'string' && msg.img.trim() !== '' && (
                            <Box
                              mb={msg.text ? 2 : 0}
                              borderRadius="md"
                              overflow="hidden"
                              maxW={{ base: "200px", sm: "250px", md: "300px" }}
                              position="relative"
                              cursor="pointer"
                              bg="transparent" // No background for images
                              onClick={(e) => handleMessageClick(e, msg._id)}
                              onContextMenu={(e) => {
                                // Right-click also opens menu
                                e.preventDefault()
                                handleMessageClick(e, msg._id)
                              }}
                            >
                              {(() => {
                                const imgUrl = typeof msg.img === 'string' ? msg.img : msg.img?.url || ''
                                if (!imgUrl) return null
                                
                                // Check if it's a video (Cloudinary videos have /video/upload/ in URL)
                                const isVideo = imgUrl.includes('/video/upload/') ||
                                                imgUrl.includes('/v1/video/upload/') ||
                                                imgUrl.match(/\.(mp4|webm|ogg|mov)$/i) ||
                                                (imgUrl.includes('cloudinary.com') && imgUrl.includes('/video/'))
                                
                                // Check if it's an image (Cloudinary images have /image/upload/ or /upload/)
                                const isImage = imgUrl.includes('/image/upload/') ||
                                                (imgUrl.includes('cloudinary.com') && !imgUrl.includes('/video/') && !isVideo) ||
                                                imgUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i) ||
                                                !isVideo // Default to image if not video
                                
                                if (isVideo) {
                                  return (
                                    <Box position="relative" bg="transparent">
                                      <Box
                                        as="video"
                                        src={imgUrl}
                                        controls
                                        maxW="100%"
                                        maxH="400px"
                                        borderRadius="md"
                                        bg="transparent"
                                      />
                                      {/* Menu button overlay - always visible for easy access */}
                                      <Box
                                        position="absolute"
                                        top={2}
                                        right={2}
                                        bg={useColorModeValue('rgba(0,0,0,0.7)', 'rgba(0,0,0,0.7)')}
                                        borderRadius="full"
                                        p={1.5}
                                        cursor="pointer"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleMessageClick(e, msg._id)
                                        }}
                                        onContextMenu={(e) => {
                                          e.preventDefault()
                                          handleMessageClick(e, msg._id)
                                        }}
                                        title="Click for options (delete, reply, etc.)"
                                        _hover={{ bg: useColorModeValue('rgba(0,0,0,0.9)', 'rgba(0,0,0,0.9)') }}
                                        transition="background 0.2s"
                                        zIndex={10}
                                      >
                                        <Text fontSize="xs" color="white" fontWeight="bold">⋯</Text>
                                      </Box>
                                    </Box>
                                  )
                                } else if (isImage) {
                                  return (
                                    <Box position="relative" bg="transparent">
                                      <Image
                                        src={imgUrl}
                                        alt="Message attachment"
                                        maxW="100%"
                                        maxH="400px"
                                        borderRadius="md"
                                        objectFit="contain"
                                        bg="transparent" // No white background for images
                                        onDoubleClick={(e) => {
                                          // Double-click opens in new tab
                                          e.stopPropagation()
                                          window.open(imgUrl, '_blank')
                                        }}
                                        onError={(e) => {
                                          console.error('Image load error:', imgUrl)
                                          e.target.style.display = 'none'
                                        }}
                                        // Single click shows menu (handled by parent)
                                      />
                                      {/* Menu button overlay */}
                                      <Box
                                        position="absolute"
                                        top={2}
                                        right={2}
                                        bg={useColorModeValue('rgba(0,0,0,0.7)', 'rgba(0,0,0,0.7)')}
                                        borderRadius="full"
                                        p={1.5}
                                        cursor="pointer"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleMessageClick(e, msg._id)
                                        }}
                                        title="Click for options"
                                        _hover={{ bg: useColorModeValue('rgba(0,0,0,0.9)', 'rgba(0,0,0,0.9)') }}
                                        transition="background 0.2s"
                                      >
                                        <Text fontSize="xs" color="white" fontWeight="bold">⋯</Text>
                                      </Box>
                                    </Box>
                                  )
                                }
                                return null
                              })()}
                              {/* Seen status for image-only messages - overlay */}
                              {!msg.text && isOwn && (
                                <Box
                                  position="absolute"
                                  bottom={2}
                                  right={2}
                                  bg={useColorModeValue('rgba(255,255,255,0.9)', 'rgba(0,0,0,0.7)')}
                                  borderRadius="full"
                                  p={1}
                                >
                                  <Box as="span" color={msg.seen ? "blue.600" : "gray.600"}>
                                    <BsCheck2All size={14} />
                                  </Box>
                                </Box>
                              )}
                            </Box>
                          )}
                          {/* Text message bubble */}
                          {msg.text && (() => {
                            // Check if message is emoji-only (contains only emojis and whitespace)
                            const emojiOnlyRegex = /^[\s\p{Emoji}]+$/u
                            const isEmojiOnly = emojiOnlyRegex.test(msg.text.trim())
                            
                            return (
                              <Flex
                                bg={isEmojiOnly ? 'transparent' : (isOwn ? 'white' : useColorModeValue('gray.200', '#1a1a1a'))}
                                color={isOwn ? 'black' : useColorModeValue('black', 'white')}
                                p={isEmojiOnly ? 0 : { base: 2.5, md: 3 }}
                                borderRadius={isEmojiOnly ? 0 : "xl"}
                                borderTopLeftRadius={isEmojiOnly ? 0 : (isOwn ? 'xl' : 'sm')}
                                borderTopRightRadius={isEmojiOnly ? 0 : (isOwn ? 'sm' : 'xl')}
                                wordBreak="break-word"
                                alignItems="flex-end"
                                gap={1}
                                cursor="pointer"
                                onClick={(e) => handleMessageClick(e, msg._id)}
                                _hover={{ opacity: 0.9 }}
                                data-message-id={msg._id}
                              >
                                <Text 
                                  fontSize={isEmojiOnly ? { base: "2xl", md: "3xl" } : { base: "sm", md: "md" }} 
                                  whiteSpace="pre-wrap" 
                                  flex={1}
                                >
                                  {msg.text}
                                </Text>
                                {isOwn && (
                                  <Box alignSelf="flex-end" color={msg.seen ? "blue.600" : "gray.600"} flexShrink={0} ml={1}>
                                    <BsCheck2All size={16} />
                                  </Box>
                                )}
                              </Flex>
                            )
                          })()}
                        </Flex>
                        <Text
                          fontSize={{ base: "2xs", md: "xs" }}
                          color="gray.500"
                          mt={0.5}
                          px={2}
                        >
                          {msg.createdAt &&
                            formatDistanceToNow(new Date(msg.createdAt), {
                              addSuffix: true,
                            })}
                        </Text>
                        {/* Message Reactions */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <Flex
                            gap={1}
                            mt={1}
                            px={2}
                            flexWrap="wrap"
                            alignItems="center"
                          >
                            {Object.entries(
                              msg.reactions.reduce((acc, reaction) => {
                                const emoji = reaction.emoji
                                if (!acc[emoji]) {
                                  acc[emoji] = []
                                }
                                acc[emoji].push(reaction)
                                return acc
                              }, {})
                            ).map(([emoji, reactions]) => {
                              const hasUserReacted = reactions.some(r => {
                                const reactUserId = r.userId?._id ? 
                                  (typeof r.userId._id === 'string' ? r.userId._id : r.userId._id.toString()) :
                                  (typeof r.userId === 'string' ? r.userId : String(r.userId))
                                return reactUserId === currentUserId
                              })
                              
                              return (
                                <Flex
                                  key={emoji}
                                  alignItems="center"
                                  gap={1}
                                  bg={hasUserReacted ? useColorModeValue('blue.100', 'blue.900') : useColorModeValue('gray.100', 'gray.800')}
                                  px={2}
                                  py={0.5}
                                  borderRadius="full"
                                  cursor="pointer"
                                  _hover={{ bg: useColorModeValue('gray.200', 'gray.700') }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleReaction(msg._id, emoji)
                                  }}
                                >
                                  <Text fontSize="sm">{emoji}</Text>
                                  <Text fontSize="xs" color="gray.500">
                                    {reactions.length}
                                  </Text>
                                </Flex>
                              )
                            })}
                          </Flex>
                        )}
                        {/* Quick Reaction Bar (WhatsApp style) */}
                        {emojiPickerOpen === msg._id && (
                          <Box
                            ref={emojiPickerRef}
                            position="absolute"
                            left={isOwn ? 'auto' : 0}
                            right={isOwn ? 0 : 'auto'}
                            bottom="100%"
                            mb={2}
                            zIndex={1000}
                          >
                            <Flex
                              bg={useColorModeValue('white', '#2a2a2a')}
                              borderRadius="full"
                              px={2}
                              py={1.5}
                              gap={0.5}
                              alignItems="center"
                              boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                              border="1px solid"
                              borderColor={useColorModeValue('gray.200', 'gray.700')}
                              sx={{
                                animation: 'slideUp 0.2s ease-out'
                              }}
                            >
                              {/* Reply button */}
                              <Box
                                as="button"
                                fontSize={{ base: "lg", md: "xl" }}
                                p={{ base: 1, md: 1.5 }}
                                borderRadius="full"
                                _hover={{ 
                                  bg: useColorModeValue('gray.100', 'gray.700'),
                                  transform: 'scale(1.3)'
                                }}
                                transition="all 0.15s ease"
                                cursor="pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReply(msg)
                                }}
                                _active={{
                                  transform: 'scale(1.1)'
                                }}
                                title="Reply"
                              >
                                <BsReply />
                              </Box>
                              {/* Delete button - show for all messages (any participant can delete) */}
                              <Box
                                as="button"
                                fontSize={{ base: "lg", md: "xl" }}
                                p={{ base: 1, md: 1.5 }}
                                borderRadius="full"
                                color="red.500"
                                _hover={{ 
                                  bg: useColorModeValue('red.100', 'red.900'),
                                  transform: 'scale(1.3)'
                                }}
                                transition="all 0.15s ease"
                                cursor="pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteMessage(msg._id)
                                  setEmojiPickerOpen(null)
                                }}
                                _active={{
                                  transform: 'scale(1.1)'
                                }}
                                title="Delete message"
                              >
                                <BsTrash />
                              </Box>
                              {['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉'].map((emoji) => (
                                <Box
                                  key={emoji}
                                  as="button"
                                  fontSize={{ base: "lg", md: "xl" }}
                                  p={{ base: 1, md: 1.5 }}
                                  borderRadius="full"
                                  _hover={{ 
                                    bg: useColorModeValue('gray.100', 'gray.700'),
                                    transform: 'scale(1.3)'
                                  }}
                                  transition="all 0.15s ease"
                                  cursor="pointer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEmojiClick({ emoji }, msg._id)
                                  }}
                                  _active={{
                                    transform: 'scale(1.1)'
                                  }}
                                >
                                  {emoji}
                                </Box>
                              ))}
                            </Flex>
                          </Box>
                        )}
                      </Flex>
                    </Flex>
                  )
                })}
                {/* Typing indicator */}
                {isTyping && (
                  <Flex
                    justifyContent="flex-start"
                    alignItems="flex-end"
                    gap={2}
                    w="100%"
                    px={2}
                  >
                    <Avatar
                      size="xs"
                      src={selectedConversation.participants[0]?.profilePic}
                      name={selectedConversation.participants[0]?.name || selectedConversation.participants[0]?.username || 'User'}
                      bg={useColorModeValue('blue.500', 'blue.600')}
                      display={{ base: "none", sm: "flex" }}
                    />
                    <Flex
                      bg={useColorModeValue('gray.200', '#1a1a1a')}
                      p={3}
                      borderRadius="xl"
                      borderTopLeftRadius="sm"
                      borderTopRightRadius="xl"
                    >
                      <Flex gap={1.5} alignItems="center">
                        <Box
                          w={2}
                          h={2}
                          bg="gray.500"
                          borderRadius="full"
                          sx={{
                            animation: 'typing 1.4s infinite',
                            animationDelay: '0s'
                          }}
                        />
                        <Box
                          w={2}
                          h={2}
                          bg="gray.500"
                          borderRadius="full"
                          sx={{
                            animation: 'typing 1.4s infinite',
                            animationDelay: '0.2s'
                          }}
                        />
                        <Box
                          w={2}
                          h={2}
                          bg="gray.500"
                          borderRadius="full"
                          sx={{
                            animation: 'typing 1.4s infinite',
                            animationDelay: '0.4s'
                          }}
                        />
                      </Flex>
                    </Flex>
                  </Flex>
                )}
                <div ref={messagesEndRef} />
                {/* Unread message indicator (WhatsApp style) - Sticky at bottom of visible chat area */}
                {(() => {
                  // Always check actual scroll position to determine if we should show indicator
                  if (unreadCountInView === 0) return null
                  
                  const container = messagesContainerRef.current
                  if (!container) return null
                  
                  const scrollTop = container.scrollTop
                  const scrollHeight = container.scrollHeight
                  const clientHeight = container.clientHeight
                  const distanceFromBottom = scrollHeight - scrollTop - clientHeight
                  const isActuallyAtBottom = distanceFromBottom <= 20
                  
                  // Show indicator if we have unread messages AND we're not at bottom
                  // Also hide if unread count is 0 (shouldn't happen, but safety check)
                  if (isActuallyAtBottom || unreadCountInView === 0) {
                    // If at bottom, clear the count (in case it wasn't cleared by scroll handler)
                    if (isActuallyAtBottom && unreadCountInView > 0) {
                      setUnreadCountInView(0)
                    }
                    return null
                  }
                  
                  return (
                    <Box
                      position="sticky"
                      bottom={4}
                      zIndex={100}
                      cursor="pointer"
                      w="fit-content"
                      mx="auto"
                      my={2}
                      pointerEvents="auto"
                      onClick={() => {
                        if (messagesContainerRef.current) {
                          const container = messagesContainerRef.current
                          isUserScrollingRef.current = false
                          // Clear unread count immediately
                          setUnreadCountInView(0)
                          setIsAtBottom(true)
                          // Scroll to bottom
                          container.scrollTop = container.scrollHeight
                          // Verify scroll after a brief delay
                          setTimeout(() => {
                            if (messagesContainerRef.current) {
                              const container = messagesContainerRef.current
                              container.scrollTop = container.scrollHeight
                            }
                          }, 50)
                        }
                      }}
                    >
                      <Flex
                        bg="blue.500"
                        color="white"
                        px={4}
                        py={2}
                        borderRadius="full"
                        alignItems="center"
                        gap={2}
                        boxShadow="lg"
                        _hover={{ bg: 'blue.600' }}
                        transition="all 0.2s"
                      >
                        <Text fontSize="sm" fontWeight="semibold">
                          {unreadCountInView} new {unreadCountInView === 1 ? 'message' : 'messages'}
                        </Text>
                        <Box as="span" fontSize="lg">↓</Box>
                      </Flex>
                    </Box>
                  )
                })()}
              </VStack>
            </Box>

            {/* Message Input - Mobile optimized */}
            <Flex
              direction="column"
              borderTop="1px solid"
              borderColor={borderColor}
              bg={bgColor}
              mb={{ base: 'env(safe-area-inset-bottom)', md: 0 }}
            >
              {/* Quoted message preview (when replying) */}
              {replyingTo && (
                <Flex
                  p={2}
                  bg={useColorModeValue('gray.100', 'gray.800')}
                  borderBottom="1px solid"
                  borderColor={borderColor}
                  alignItems="center"
                  gap={2}
                  position="relative"
                  zIndex={1}
                >
                  <Box
                    flex={1}
                    borderLeft="3px solid"
                    borderLeftColor="blue.500"
                    pl={2}
                  >
                    <Text fontSize="xs" color="blue.500" fontWeight="semibold" mb={0.5}>
                      Replying to {(() => {
                        const replySenderId = replyingTo.sender?._id ? 
                          (typeof replyingTo.sender._id === 'string' ? replyingTo.sender._id : replyingTo.sender._id.toString()) :
                          (typeof replyingTo.sender === 'string' ? replyingTo.sender : String(replyingTo.sender))
                        const currentUserId = typeof user._id === 'string' ? user._id : user._id.toString()
                        return replySenderId === currentUserId ? 'yourself' : (replyingTo.sender?.name || replyingTo.sender?.username || 'User')
                      })()}
                    </Text>
                    <Text fontSize="xs" color={useColorModeValue('gray.600', 'gray.400')} noOfLines={1}>
                      {replyingTo.text || 'Message'}
                    </Text>
                    <Text fontSize="2xs" color={useColorModeValue('gray.500', 'gray.500')} mt={1} fontStyle="italic">
                      Type your reply in the input field below
                    </Text>
                  </Box>
                  <IconButton
                    aria-label="Cancel reply"
                    icon={<Text fontSize="lg">×</Text>}
                    size="sm"
                    variant="ghost"
                    onClick={handleCancelReply}
                  />
                </Flex>
              )}
              {/* Upload progress bar */}
              {(uploadProgress > 0 && uploadProgress < 100) || isProcessing ? (
                <Flex
                  p={3}
                  bg={useColorModeValue('blue.50', 'blue.900')}
                  borderBottom="1px solid"
                  borderColor={borderColor}
                  alignItems="center"
                  gap={3}
                  flexDirection="column"
                >
                  <Flex w="100%" alignItems="center" gap={2}>
                    <Spinner size="sm" color="blue.500" />
                    <Text fontSize="sm" color={useColorModeValue('blue.700', 'blue.300')} fontWeight="semibold" flex={1}>
                      {uploadProgress === 100 && isProcessing
                        ? `Processing file on server...` 
                        : `Uploading to Cloudinary... ${uploadProgress}%`}
                    </Text>
                  </Flex>
                  <Box w="100%" bg={useColorModeValue('blue.200', 'blue.700')} borderRadius="full" h={2} overflow="hidden">
                    <Box
                      bg="blue.500"
                      h="100%"
                      w={isProcessing ? "100%" : `${uploadProgress}%`}
                      transition="width 0.3s ease"
                      borderRadius="full"
                    />
                  </Box>
                </Flex>
              ) : null}
              {/* Image/Video preview */}
              {imagePreview && (
                <Flex
                  p={2}
                  bg={useColorModeValue('gray.100', 'gray.800')}
                  borderBottom="1px solid"
                  borderColor={borderColor}
                  alignItems="center"
                  gap={2}
                  position="relative"
                >
                  <Box position="relative" maxW="100px" maxH="100px">
                    {(() => {
                      // Check if preview is image or video
                      const fileType = image?.type || ''
                      const previewUrl = typeof imagePreview === 'string' ? imagePreview : ''
                      
                      const isVideo = fileType.startsWith('video/') || 
                                      previewUrl.match(/\.(mp4|webm|ogg|mov)$/i) ||
                                      previewUrl.includes('blob:') && fileType.startsWith('video/')
                      
                      const isImage = fileType.startsWith('image/') || 
                                      previewUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i) ||
                                      (!isVideo && previewUrl) // Default to image if not video
                      
                      if (isVideo) {
                        return (
                          <Box
                            as="video"
                            src={imagePreview}
                            controls={false}
                            maxW="100px"
                            maxH="100px"
                            borderRadius="md"
                            objectFit="cover"
                          />
                        )
                      } else if (isImage) {
                        return (
                          <Image 
                            src={imagePreview} 
                            alt="Preview" 
                            borderRadius="md" 
                            maxW="100px" 
                            maxH="100px"
                            objectFit="cover"
                            onError={(e) => {
                              console.error('Preview image load error:', imagePreview)
                            }}
                          />
                        )
                      }
                      return null
                    })()}
                  </Box>
                  <Text fontSize="xs" color={useColorModeValue('gray.600', 'gray.400')} flex={1} noOfLines={1}>
                    {(() => {
                      const isImage = typeof image === 'object' && image?.url
                        ? image.url.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i) || !image.url.match(/\.(mp4|webm|ogg|mov)$/i)
                        : image?.type?.startsWith('image/') || imagePreview.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i) || !imagePreview.match(/\.(mp4|webm|ogg|mov)$/i)
                      return isImage ? 'Image' : 'Video'
                    })()} ready
                  </Text>
                  <IconButton
                    aria-label="Remove image"
                    icon={<Text fontSize="lg">×</Text>}
                    size="sm"
                    variant="ghost"
                    onClick={handleClearImage}
                  />
                </Flex>
              )}
                    <Flex
                      p={{ base: 2, md: 4 }}
                      pb={{ base: '60px', md: 4 }}
                      pt={{ base: 2, md: 4 }}
                      gap={{ base: 1.5, md: 2 }}
                      alignItems="center"
                      flexWrap="wrap"
                      position="relative"
                      zIndex={2}
                    >
              {/* G button - Opens emoji picker for sending emoji messages */}
              <Box
                position="relative"
                flexShrink={0}
              >
                <Box
                  w={{ base: 10, sm: 10 }}
                  h={{ base: 10, sm: 10 }}
                  bg="green.500"
                  borderRadius="full"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  cursor="pointer"
                  _hover={{ bg: 'green.600' }}
                  onClick={() => setEmojiPickerForMessage(!emojiPickerForMessage)}
                  title="Send emoji"
                >
                  <Text color="white" fontWeight="bold" fontSize={{ base: "md", md: "lg" }}>G</Text>
                </Box>
                {/* Emoji picker for sending messages */}
                {emojiPickerForMessage && (
                  <Box
                    ref={emojiPickerForMessageRef}
                    position="absolute"
                    bottom="100%"
                    left={0}
                    mb={2}
                    zIndex={1000}
                  >
                    <EmojiPicker
                      theme={emojiPickerTheme}
                      onEmojiClick={(emojiData) => {
                        // Add emoji to message input
                        setNewMessage((prev) => prev + emojiData.emoji)
                        setEmojiPickerForMessage(false)
                      }}
                      autoFocusSearch={false}
                    />
                  </Box>
                )}
              </Box>
              {/* Image/Video upload button - Uploads to Cloudinary via backend */}
              <IconButton
                aria-label="Upload image or video"
                icon={<BsFillImageFill size={18} />}
                bg={useColorModeValue('gray.300', 'gray.600')}
                color={useColorModeValue('black', 'white')}
                _hover={{ bg: useColorModeValue('gray.400', 'gray.500') }}
                onClick={() => imageInputRef.current?.click()}
                borderRadius="full"
                size={{ base: "sm", md: "md" }}
                flexShrink={0}
                title="Upload image or video"
              />
              <Input
                type="file"
                accept="image/*,video/*"
                hidden
                ref={imageInputRef}
                onChange={handleFileSelect}
              />
              {/* Call button with menu - Optimized for mobile */}
              <Menu>
                <MenuButton
                  as={IconButton}
                  aria-label="Start call"
                  icon={<FaPhone size={14} />}
                  bg="blue.500"
                  color="white"
                  _hover={{ bg: 'blue.600' }}
                  borderRadius="full"
                  size={{ base: "sm", md: "md" }}
                  isDisabled={
                    !selectedConversation?.participants[0]?._id || 
                    callAccepted || 
                    !callUser ||
                    busyUsers?.has(selectedConversation?.participants[0]?._id) ||
                    selectedConversation?.participants[0]?.inCall ||
                    busyUsers?.has(user?._id) ||
                    user?.inCall
                  }
                  flexShrink={0}
                  title={
                    busyUsers?.has(selectedConversation?.participants[0]?._id) || selectedConversation?.participants[0]?.inCall || busyUsers?.has(user?._id) || user?.inCall
                      ? "User is currently in a call"
                      : "Start call"
                  }
                />
                <MenuList 
                  bg={bgColor} 
                  borderColor={borderColor}
                  borderRadius="lg"
                  boxShadow="xl"
                  py={1}
                  minW="150px"
                  w="auto"
                >
                  <MenuItem
                    icon={<FaVideo />}
                    onClick={() => {
                      const recipientId = selectedConversation?.participants[0]?._id
                      if (recipientId && callUser) {
                        // Check if user is busy before calling - check both socket AND database
                        if (busyUsers?.has(recipientId) || selectedConversation?.participants[0]?.inCall || busyUsers?.has(user?._id) || user?.inCall) {
                          showToast('Error', 'User is currently in a call', 'error')
                          return
                        }
                        // Get recipient name from conversation
                        const recipientName = selectedConversation?.participants[0]?.name || selectedConversation?.participants[0]?.username
                        callUser(recipientId, recipientName, 'video')
                      }
                    }}
                    bg={bgColor}
                    color={useColorModeValue('black', 'white')}
                    _hover={{
                      bg: useColorModeValue('blue.50', 'blue.900'),
                      color: useColorModeValue('blue.600', 'blue.200'),
                      transform: 'translateX(4px)',
                      transition: 'all 0.2s ease'
                    }}
                    _focus={{
                      bg: useColorModeValue('blue.50', 'blue.900'),
                      color: useColorModeValue('blue.600', 'blue.200'),
                    }}
                    transition="all 0.2s ease"
                    cursor="pointer"
                    borderRadius="md"
                    py={2}
                    px={3}
                    closeOnSelect
                  >
                    <Text fontWeight="medium">Video Call</Text>
                  </MenuItem>
                  <MenuItem
                    icon={<FaPhone />}
                    onClick={() => {
                      const recipientId = selectedConversation?.participants[0]?._id
                      if (recipientId && callUser) {
                        // Check if user is busy before calling - check both socket AND database
                        if (busyUsers?.has(recipientId) || selectedConversation?.participants[0]?.inCall || busyUsers?.has(user?._id) || user?.inCall) {
                          showToast('Error', 'User is currently in a call', 'error')
                          return
                        }
                        // Get recipient name from conversation
                        const recipientName = selectedConversation?.participants[0]?.name || selectedConversation?.participants[0]?.username
                        callUser(recipientId, recipientName, 'audio')
                      }
                    }}
                    bg={bgColor}
                    color={useColorModeValue('black', 'white')}
                    _hover={{
                      bg: useColorModeValue('green.50', 'green.900'),
                      color: useColorModeValue('green.600', 'green.200'),
                      transform: 'translateX(4px)',
                      transition: 'all 0.2s ease'
                    }}
                    _focus={{
                      bg: useColorModeValue('green.50', 'green.900'),
                      color: useColorModeValue('green.600', 'green.200'),
                    }}
                    transition="all 0.2s ease"
                    cursor="pointer"
                    borderRadius="md"
                    py={2}
                    px={3}
                    closeOnSelect
                  >
                    <Text fontWeight="medium">Voice Call</Text>
                  </MenuItem>
                </MenuList>
              </Menu>
              <Input
                ref={messageInputRef}
                type="text"
                placeholder={replyingTo ? "Type a reply..." : "Message..."}
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value)
                  handleTyping()
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    e.stopPropagation()
                    e.nativeEvent?.stopImmediatePropagation?.()
                    if (!sending && (newMessage.trim() || image || imagePreview)) {
                      await handleSendMessage(e).catch(err => {
                        console.error('Error in handleSendMessage:', err)
                      })
                    }
                    return false
                  }
                }}
                bg={inputBg}
                borderRadius="full"
                flex={1}
                minW={{ base: "120px", sm: "150px" }}
                fontSize={{ base: "sm", md: "md" }}
                h={{ base: "44px", md: "40px" }}
                py={{ base: 3, md: 2 }}
                isDisabled={sending}
                border={replyingTo ? "2px solid" : "1px solid"}
                borderColor={replyingTo ? "blue.500" : borderColor}
              />
              <Button
                type="button"
                bg="green.500"
                color="white"
                _hover={{ bg: 'green.600' }}
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.nativeEvent?.stopImmediatePropagation?.()
                  if (!sending && (newMessage.trim() || image || imagePreview)) {
                    await handleSendMessage(e).catch(err => {
                      console.error('Error in handleSendMessage:', err)
                    })
                  }
                  return false
                }}
                isLoading={sending || (uploadProgress > 0 && uploadProgress < 100) || isProcessing}
                isDisabled={sending || (uploadProgress > 0 && uploadProgress < 100) || isProcessing || (!newMessage.trim() && !image && !imagePreview)}
                borderRadius="md"
                px={{ base: 3, sm: 4, md: 6 }}
                size={{ base: "sm", md: "md" }}
                fontSize={{ base: "sm", md: "md" }}
                flexShrink={0}
              >
                <Text display={{ base: "none", sm: "block" }}>Send</Text>
                <Text display={{ base: "block", sm: "none" }}>✓</Text>
              </Button>
              </Flex>
            </Flex>
          </>
        ) : (
          <Flex
            justifyContent="center"
            alignItems="center"
            h="full"
            color="gray.500"
          >
            <Text fontSize="lg">
              Select a conversation or search for a friend to start chatting
            </Text>
          </Flex>
        )}
      </Box>

      {/* Right Sidebar - Online Friends */}
      <Box
        w="250px"
        borderLeft="1px solid"
        borderColor={borderColor}
        bg={bgColor}
        display={{ base: 'none', lg: 'flex' }}
        flexDirection="column"
        h="100%"
        overflowY="auto"
      >
        <Box p={4} borderBottom="1px solid" borderColor={borderColor}>
          <Text fontSize="lg" fontWeight="bold" color={useColorModeValue('black', 'white')}>
            Online Friends
          </Text>
        </Box>
        
        <VStack align="stretch" spacing={0} p={2}>
          {followedUsers
            .filter(user => onlineUser?.some(ou => (ou.userId || ou._id) === user._id))
            .sort((a, b) => {
              // Get onlineAt timestamps for both users
              const aOnline = onlineUser?.find(ou => (ou.userId || ou._id) === a._id)?.onlineAt || 0
              const bOnline = onlineUser?.find(ou => (ou.userId || ou._id) === b._id)?.onlineAt || 0
              // Sort by most recent first (highest timestamp first)
              return bOnline - aOnline
            })
            .map((friend) => (
              <Flex
                key={friend._id}
                p={3}
                alignItems="center"
                gap={3}
                cursor="pointer"
                _hover={{ bg: hoverBg }}
                borderRadius="md"
                onClick={() => startConversation(friend._id)}
              >
                <Box position="relative">
                  <Avatar
                    size="md"
                    src={friend.profilePic}
                    name={friend.name || friend.username || 'User'}
                    bg={useColorModeValue('blue.500', 'blue.600')}
                  />
                  <Box
                    position="absolute"
                    bottom={0}
                    right={0}
                    w={4}
                    h={4}
                    bg="green.500"
                    borderRadius="full"
                    border="2px solid"
                    borderColor={bgColor}
                  />
                </Box>
                <Box flex={1} minW={0}>
                  <Text
                    fontWeight="semibold"
                    noOfLines={1}
                    color={useColorModeValue('black', 'white')}
                  >
                    {friend.name}
                  </Text>
                </Box>
              </Flex>
            ))}
          {followedUsers.filter(user => onlineUser?.some(ou => (ou.userId || ou._id) === user._id)).length === 0 && (
            <Text px={4} py={8} color="gray.500" fontSize="sm" textAlign="center">
              No friends online
            </Text>
          )}
        </VStack>
      </Box>
    </Flex>
  )
}

export default MessagesPage

