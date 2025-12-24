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
} from '@chakra-ui/react'
import { SearchIcon, ArrowBackIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import { formatDistanceToNow } from 'date-fns'
import { FaPhone, FaPhoneSlash } from 'react-icons/fa'
import { BsCheck2All } from 'react-icons/bs'
import EmojiPicker from 'emoji-picker-react'

const MessagesPage = () => {
  const { user } = useContext(UserContext)
  const socketContext = useContext(SocketContext)
  const { socket, onlineUser, callUser, callAccepted, callEnded, call, answerCall, leaveCall, myVideo, userVideo, stream, busyUsers } = socketContext || {}
  const showToast = useShowToast()

  // State
  const [conversations, setConversations] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [followedUsers, setFollowedUsers] = useState([])
  const [isTyping, setIsTyping] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(null) // Store messageId when picker is open
  const [isAtBottom, setIsAtBottom] = useState(true) // Track if user is scrolled to bottom
  const [unreadCountInView, setUnreadCountInView] = useState(0) // Count of unread messages while scrolled up

  // Refs
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const emojiPickerRef = useRef(null)
  const lastMessageCountRef = useRef(0) // Track message count to detect new messages
  const isUserScrollingRef = useRef(false) // Track if user is manually scrolling
  const scrollTimeoutRef = useRef(null) // Timeout to detect when user stops scrolling

  // Theme colors - white for light mode, dark for dark mode
  const bgColor = useColorModeValue('white', '#101010')  // White in light mode, dark in dark mode
  const borderColor = useColorModeValue('gray.200', '#1a1a1a')  // Light gray border in light mode
  const inputBg = useColorModeValue('gray.100', '#1a1a1a')  // Light gray input in light mode
  const hoverBg = useColorModeValue('gray.50', '#1a1a1a')  // Light hover in light mode
  const emojiPickerTheme = useColorModeValue('light', 'dark')

  // Fetch conversations
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/conversations`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (res.ok) {
          setConversations(data)
        }
      } catch (error) {
        showToast('Error', 'Failed to load conversations', 'error')
      } finally {
        setLoading(false)
      }
    }

    if (user) {
      fetchConversations()
    }
  }, [user, showToast])

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

    const fetchMessages = async () => {
      if (!selectedConversation) return

      const otherUser = selectedConversation.participants[0]
      if (!otherUser?._id) return

      try {
        const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${otherUser._id}`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (res.ok) {
          setMessages(data)
          lastMessageCountRef.current = data.length
          setUnreadCountInView(0)
          setIsAtBottom(true)
          // Scroll to bottom when conversation is opened (WhatsApp style)
          setTimeout(() => {
            if (messagesContainerRef.current) {
              const container = messagesContainerRef.current
              container.scrollTop = container.scrollHeight // Direct scroll without animation
            }
          }, 100)
        }
      } catch (error) {
        showToast('Error', 'Failed to load messages', 'error')
      }
    }

    // Only fetch messages if conversation has _id (existing conversation)
    // New conversations (no _id) start with empty messages
    if (selectedConversation && selectedConversation._id) {
      fetchMessages()
    } else if (selectedConversation) {
      setMessages([])
    }
  }, [selectedConversation?._id, selectedConversation?.participants, showToast])

  // Track scroll position
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollTop = container.scrollTop
      const scrollHeight = container.scrollHeight
      const clientHeight = container.clientHeight
      // Check if at bottom - use a small threshold (10px) to account for rounding
      const isAtBottom = scrollHeight - scrollTop - clientHeight <= 10

      setIsAtBottom(isAtBottom)
      isUserScrollingRef.current = true // User is manually scrolling
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // Set timeout to detect when user stops scrolling (after 300ms of no scrolling)
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 300)
      
      // If scrolled to bottom, clear unread count and update state
      if (isAtBottom) {
        setUnreadCountInView(0)
      }
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
  }, [selectedConversation?._id]) // Re-run when conversation changes

  // Track new messages and handle auto-scroll/unread indicator
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current && user?._id) {
      const container = messagesContainerRef.current
      if (!container) {
        lastMessageCountRef.current = messages.length
        return
      }

      // Get new messages that were just added
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


  // Listen for new messages via Socket.io
  useEffect(() => {
    if (!socket) return

    const handleNewMessage = (message) => {
      if (
        selectedConversation &&
        message.conversationId &&
        selectedConversation._id &&
        message.conversationId.toString() === selectedConversation._id.toString()
      ) {
        setMessages((prev) => [...prev, message])
      } else {
        // If message is for a different conversation, increment unread count
        setConversations(prev => prev.map(conv => {
          if (conv._id && message.conversationId && conv._id.toString() === message.conversationId.toString()) {
            // Only increment if message is not from current user
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
            
            if (messageSenderId !== currentUserId) {
              return { ...conv, unreadCount: (conv.unreadCount || 0) + 1 }
            }
          }
          return conv
        }))
      }
      // Always refresh conversations to update last message preview
      fetchConversations()
    }

    socket.on('newMessage', handleNewMessage)

    return () => {
      socket.off('newMessage', handleNewMessage)
    }
  }, [socket, selectedConversation?._id, user?._id])

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
        // Update messages to mark them as seen
        setMessages((prev) => {
          return prev.map((message) => {
            if (!message.seen) {
              return { ...message, seen: true }
            }
            return message
          })
        })

        // Update conversations list to mark lastMessage as seen and clear unread count
        setConversations((prev) => {
          return prev.map((conv) => {
            if (conv._id && conv._id.toString() === conversationId) {
              return {
                ...conv,
                lastMessage: {
                  ...conv.lastMessage,
                  seen: true
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
            const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${otherUser._id}`, {
              credentials: 'include',
            })
            const data = await res.json()
            if (res.ok) {
              setMessages(data)
            }
          }
        } catch (error) {
          console.log('Error fetching updated messages:', error)
        }
      }
    }

    socket.on("messageReactionUpdated", handleReactionUpdate)

    return () => {
      socket.off("messageReactionUpdated", handleReactionUpdate)
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

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/conversations`, {
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        setConversations(data)
        return data
      }
      return []
    } catch (error) {
      console.log('Error fetching conversations:', error)
      return []
    }
  }

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
        const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/${recipientId}`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (res.ok) {
          setMessages(data)
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

  // Close emoji picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        // Also check if click is not on a message bubble
        const messageBubble = event.target.closest('[data-message-id]')
        if (!messageBubble) {
          setEmojiPickerOpen(null)
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return

    const recipientId = selectedConversation.participants[0]?._id
    if (!recipientId) return

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
    try {
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipientId,
          message: newMessage,
        }),
      })

      const data = await res.json()
      if (res.ok) {
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
        setMessages((prev) => [...prev, messageWithSender])
        setNewMessage('')
        setSending(false) // Stop spinner immediately after message is added
        
        // Refresh conversations list in background (don't wait for it)
        fetchConversations().then(updatedConversations => {
          // If this was a new conversation, update selectedConversation to the real one
          if (selectedConversation && !selectedConversation._id && data.conversationId) {
            const updatedConv = updatedConversations.find(c => 
              c._id && c._id.toString() === data.conversationId.toString()
            )
            if (updatedConv) {
              setSelectedConversation(updatedConv)
            }
          }
        }).catch(err => {
          console.log('Error refreshing conversations:', err)
        })
      } else {
        setSending(false)
        showToast('Error', data.error || 'Failed to send message', 'error')
      }
    } catch (error) {
      setSending(false)
      showToast('Error', 'Failed to send message', 'error')
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

        <Box overflowY="auto" flex={1}>
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
              {conversations.length === 0 ? (
                <Text px={4} py={8} color="gray.500" textAlign="center" fontSize="sm">
                  No conversations yet. Search for friends to start chatting!
                </Text>
              ) : (
                conversations.map((conv) => {
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
                          
                          return (
                            <Flex alignItems="center" gap={1} mt={0.5}>
                              {/* Show seen indicator only if current user sent the last message */}
                              {isLastMessageFromMe && (
                                <Box color={conv.lastMessage.seen ? "blue.600" : "white"}>
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
                                {conv.lastMessage.text?.length > 30 
                                  ? conv.lastMessage.text.substring(0, 30) + "..." 
                                  : conv.lastMessage.text || "📷 Image"}
                              </Text>
                            </Flex>
                          )
                        })()}
                      </Box>
                    </Flex>
                  )
                })
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
              </Flex>
            </Flex>

            {/* Video Call - Inline in chat - Mobile optimized */}
            {callAccepted && !callEnded && stream && myVideo && userVideo && (
              <Box
                borderBottom="1px solid"
                borderColor={borderColor}
                p={{ base: 2, md: 4 }}
                bg={useColorModeValue('gray.50', 'gray.900')}
              >
                <Flex direction="column" gap={{ base: 2, md: 3 }}>
                  <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Text fontWeight="semibold" fontSize={{ base: "xs", md: "md" }} color={useColorModeValue('black', 'white')}>
                      Video Call Active
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
                </Flex>
              </Box>
            )}

            {/* Incoming call notification - Mobile optimized */}
            {call && call.isReceivingCall && !callAccepted && (
              <Box
                borderBottom="1px solid"
                borderColor={borderColor}
                p={{ base: 3, md: 4 }}
                bg={useColorModeValue('blue.50', 'blue.900')}
              >
                <Flex direction="column" gap={{ base: 2, md: 3 }} alignItems="center">
                  <Text fontWeight="semibold" fontSize={{ base: "sm", md: "md" }} textAlign="center" color={useColorModeValue('black', 'white')}>
                    {call?.name} is calling...
                  </Text>
                  <Flex gap={{ base: 2, md: 3 }} w="full" justifyContent="center" flexWrap="wrap">
                    <Button
                      colorScheme="green"
                      leftIcon={<FaPhone />}
                      onClick={() => answerCall?.()}
                      size={{ base: "sm", md: "md" }}
                      flex={{ base: 1, sm: 0 }}
                      minW={{ base: "auto", sm: "120px" }}
                    >
                      Answer
                    </Button>
                    <Button
                      colorScheme="red"
                      leftIcon={<FaPhoneSlash />}
                      onClick={() => leaveCall?.()}
                      size={{ base: "sm", md: "md" }}
                      flex={{ base: 1, sm: 0 }}
                      minW={{ base: "auto", sm: "120px" }}
                    >
                      Decline
                    </Button>
                  </Flex>
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
              {/* Unread message indicator (WhatsApp style) */}
              {(() => {
                // Always check actual scroll position to determine if we should show indicator
                if (unreadCountInView === 0) return false
                
                const container = messagesContainerRef.current
                if (!container) return !isAtBottom // Fallback to state
                
                const scrollTop = container.scrollTop
                const scrollHeight = container.scrollHeight
                const clientHeight = container.clientHeight
                const distanceFromBottom = scrollHeight - scrollTop - clientHeight
                const isActuallyAtBottom = distanceFromBottom <= 10
                
                // Show indicator if we have unread messages AND we're not at bottom
                return !isActuallyAtBottom
              })() && (
                <Box
                  position="absolute"
                  bottom={4}
                  left="50%"
                  transform="translateX(-50%)"
                  zIndex={100}
                  cursor="pointer"
                  onClick={() => {
                    if (messagesContainerRef.current) {
                      const container = messagesContainerRef.current
                      isUserScrollingRef.current = false // Reset scroll tracking
                      container.scrollTop = container.scrollHeight // Direct scroll to bottom
                      setUnreadCountInView(0)
                      setIsAtBottom(true)
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
              )}
              <VStack align="stretch" spacing={{ base: 3, md: 4 }} px={{ base: 2, sm: 3, md: 4 }}>
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
                          bg={isOwn ? 'white' : useColorModeValue('gray.200', '#1a1a1a')}
                          color={isOwn ? 'black' : useColorModeValue('black', 'white')}
                          p={{ base: 2.5, md: 3 }}
                          borderRadius="xl"
                          borderTopLeftRadius={isOwn ? 'xl' : 'sm'}
                          borderTopRightRadius={isOwn ? 'sm' : 'xl'}
                          wordBreak="break-word"
                          alignItems="flex-end"
                          gap={1}
                          cursor="pointer"
                          onClick={(e) => handleMessageClick(e, msg._id)}
                          _hover={{ opacity: 0.9 }}
                        >
                          <Text fontSize={{ base: "sm", md: "md" }} whiteSpace="pre-wrap" flex={1}>{msg.text}</Text>
                          {isOwn && (
                            <Box alignSelf="flex-end" color={msg.seen ? "blue.600" : "gray.600"} flexShrink={0} ml={1}>
                              <BsCheck2All size={16} />
                            </Box>
                          )}
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
              </VStack>
            </Box>

            {/* Message Input - Mobile optimized */}
            <Flex
              p={{ base: 2, md: 4 }}
              pb={{ base: '60px', md: 4 }}
              pt={{ base: 2, md: 4 }}
              borderTop="1px solid"
              borderColor={borderColor}
              gap={{ base: 1.5, md: 2 }}
              alignItems="center"
              bg={bgColor}
              flexWrap="wrap"
              mb={{ base: 'env(safe-area-inset-bottom)', md: 0 }}
            >
              {/* Game button - Show on all screens now */}
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
                flexShrink={0}
              >
                <Text color="white" fontWeight="bold" fontSize={{ base: "md", md: "lg" }}>G</Text>
              </Box>
              {/* Call button - Optimized for mobile */}
              <IconButton
                aria-label="Start video call"
                icon={<FaPhone size={14} />}
                bg="blue.500"
                color="white"
                _hover={{ bg: 'blue.600' }}
                onClick={() => {
                  const recipientId = selectedConversation?.participants[0]?._id
                  if (recipientId && callUser) {
                    // Check if user is busy before calling
                    if (busyUsers?.has(recipientId) || busyUsers?.has(user?._id)) {
                      showToast('Error', 'User is currently in a call', 'error')
                      return
                    }
                    callUser(recipientId)
                  }
                }}
                borderRadius="full"
                size={{ base: "sm", md: "md" }}
                isDisabled={
                  !selectedConversation?.participants[0]?._id || 
                  callAccepted || 
                  !callUser ||
                  busyUsers?.has(selectedConversation?.participants[0]?._id) ||
                  busyUsers?.has(user?._id)
                }
                flexShrink={0}
                title={
                  busyUsers?.has(selectedConversation?.participants[0]?._id) || busyUsers?.has(user?._id)
                    ? "User is currently in a call"
                    : "Start video call"
                }
              />
              <Input
                placeholder="Message..."
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value)
                  handleTyping()
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                bg={inputBg}
                borderRadius="full"
                flex={1}
                minW={{ base: "120px", sm: "150px" }}
                fontSize={{ base: "sm", md: "md" }}
                h={{ base: "44px", md: "40px" }}
                py={{ base: 3, md: 2 }}
              />
              <Button
                bg="green.500"
                color="white"
                _hover={{ bg: 'green.600' }}
                onClick={handleSendMessage}
                isLoading={sending}
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

