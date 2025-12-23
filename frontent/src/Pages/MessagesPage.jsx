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
} from '@chakra-ui/react'
import { SearchIcon, ArrowBackIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import { formatDistanceToNow } from 'date-fns'
import { FaPhone, FaPhoneSlash } from 'react-icons/fa'

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

  // Refs
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)

  // Theme colors - white for light mode, dark for dark mode
  const bgColor = useColorModeValue('white', '#101010')  // White in light mode, dark in dark mode
  const borderColor = useColorModeValue('gray.200', '#1a1a1a')  // Light gray border in light mode
  const inputBg = useColorModeValue('gray.100', '#1a1a1a')  // Light gray input in light mode
  const hoverBg = useColorModeValue('gray.50', '#1a1a1a')  // Light hover in light mode

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

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

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
      }
      // Always refresh conversations to update last message preview
      fetchConversations()
    }

    socket.on('newMessage', handleNewMessage)

    return () => {
      socket.off('newMessage', handleNewMessage)
    }
  }, [socket, selectedConversation?._id])

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

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return

    const recipientId = selectedConversation.participants[0]?._id
    if (!recipientId) return

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
        setMessages((prev) => [...prev, data])
        setNewMessage('')
        
        // Refresh conversations list
        const updatedConversations = await fetchConversations()
        
        // If this was a new conversation, update selectedConversation to the real one
        if (selectedConversation && !selectedConversation._id && data.conversationId) {
          const updatedConv = updatedConversations.find(c => 
            c._id && c._id.toString() === data.conversationId.toString()
          )
          if (updatedConv) {
            setSelectedConversation(updatedConv)
          }
        }
      } else {
        showToast('Error', data.error || 'Failed to send message', 'error')
      }
    } catch (error) {
      showToast('Error', 'Failed to send message', 'error')
    } finally {
      setSending(false)
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
                  <Avatar size="md" src={u.profilePic} name={u.name} />
                  <Box flex={1}>
                    <Text fontWeight="semibold" color={useColorModeValue('black', 'white')}>
                      {u.name}
                    </Text>
                  </Box>
                  {onlineUser?.some(ou => (ou.userId || ou._id) === u._id) && (
                    <Box
                      w={3}
                      h={3}
                      bg="green.500"
                      borderRadius="full"
                      border="2px solid"
                      borderColor={bgColor}
                    />
                  )}
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
                      onClick={() => setSelectedConversation(conv)}
                      borderBottom="1px solid"
                      borderColor={borderColor}
                      alignItems="center"
                      gap={3}
                    >
                      <Avatar
                        size="md"
                        src={otherUser?.profilePic}
                        name={otherUser?.name}
                      />
                      <Box flex={1} minW={0}>
                        <Text fontWeight="semibold" noOfLines={1} color={useColorModeValue('black', 'white')}>
                          {otherUser?.name}
                        </Text>
                      </Box>
                      {onlineUser?.some(u => (u.userId || u._id) === otherUser?._id) && (
                        <Box
                          w={3}
                          h={3}
                          bg="green.500"
                          borderRadius="full"
                          border="2px solid"
                          borderColor={bgColor}
                        />
                      )}
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
                name={selectedConversation.participants[0]?.name}
              />
              <Flex flex={1} minW={0} alignItems="center" gap={2} flexWrap="wrap">
                <Text 
                  fontWeight="semibold"
                  fontSize={{ base: "sm", md: "md" }}
                  noOfLines={1}
                  color={useColorModeValue('black', 'white')}
                >
                  {selectedConversation.participants[0]?.name}
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
              p={{ base: 2, sm: 3, md: 4 }}
              bg={useColorModeValue('white', '#101010')}
            >
              <VStack align="stretch" spacing={{ base: 3, md: 4 }}>
                {messages.map((msg) => {
                  const isOwn = msg.sender?._id === user._id
                  return (
                    <Flex
                      key={msg._id}
                      justifyContent={isOwn ? 'flex-end' : 'flex-start'}
                      alignItems="flex-end"
                      gap={{ base: 1.5, md: 2 }}
                      direction={isOwn ? 'row-reverse' : 'row'}
                    >
                      <Avatar
                        size={{ base: "xs", sm: "sm" }}
                        src={isOwn ? user.profilePic : msg.sender?.profilePic}
                        name={isOwn ? user.name : msg.sender?.name}
                        display={{ base: "none", sm: "flex" }}
                      />
                      <Flex direction="column" maxW={{ base: "85%", sm: "75%", md: "70%" }} align={isOwn ? 'flex-end' : 'flex-start'}>
                        <Box
                          bg={isOwn ? 'blue.500' : useColorModeValue('gray.200', '#1a1a1a')}
                          color={isOwn ? 'white' : useColorModeValue('black', 'white')}
                          p={{ base: 2.5, md: 3 }}
                          borderRadius="xl"
                          borderTopLeftRadius={isOwn ? 'xl' : 'sm'}
                          borderTopRightRadius={isOwn ? 'sm' : 'xl'}
                          wordBreak="break-word"
                        >
                          <Text fontSize={{ base: "sm", md: "md" }} whiteSpace="pre-wrap">{msg.text}</Text>
                        </Box>
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
                      </Flex>
                    </Flex>
                  )
                })}
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
                onChange={(e) => setNewMessage(e.target.value)}
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
                    name={friend.name}
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

