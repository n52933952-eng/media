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
} from '@chakra-ui/react'
import { SearchIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import { formatDistanceToNow } from 'date-fns'
import VideoCall from '../Components/VideoCall'
import { FaPhone } from 'react-icons/fa'

const MessagesPage = () => {
  const { user } = useContext(UserContext)
  const { socket, onlineUser, callUser, callAccepted, callEnded } = useContext(SocketContext)
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
        const res = await fetch('http://localhost:5000/api/message/conversations', {
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
        const userRes = await fetch(`http://localhost:5000/api/user/getUserPro/${user._id}`, {
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
              
              const userRes = await fetch(`http://localhost:5000/api/user/getUserPro/${userId}`, {
                credentials: 'include',
              })
              
              if (!userRes.ok) {
                console.log(`Failed to fetch user ${userId}:`, userRes.status)
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
        const res = await fetch(`http://localhost:5000/api/message/${otherUser._id}`, {
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
      const res = await fetch('http://localhost:5000/api/message/conversations', {
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
        const res = await fetch(`http://localhost:5000/api/message/${recipientId}`, {
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
      const res = await fetch('http://localhost:5000/api/message', {
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
    <>
      <VideoCall />
      <Flex h="100%" gap={0}>
        {/* Left Sidebar - Conversations & Search */}
      <Box
        w="350px"
        borderRight="1px solid"
        borderColor={borderColor}
        bg={bgColor}
        display={{ base: selectedConversation ? 'none' : 'flex', md: 'flex' }}
        h="100%"
        flexDirection="column"
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
                  {onlineUser?.includes(u._id) && (
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
                      {onlineUser?.includes(otherUser?._id) && (
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
      <Box flex={1} display="flex" flexDirection="column" bg={bgColor}>
        {selectedConversation ? (
          <>
            {/* Chat Header - Responsive */}
            <Flex
              p={{ base: 3, md: 4 }}
              borderBottom="1px solid"
              borderColor={borderColor}
              alignItems="center"
              gap={{ base: 2, md: 3 }}
            >
              <Avatar
                size={{ base: "xs", md: "sm" }}
                src={selectedConversation.participants[0]?.profilePic}
                name={selectedConversation.participants[0]?.name}
              />
              <Box flex={1} minW={0}>
                <Text 
                  fontWeight="semibold"
                  fontSize={{ base: "sm", md: "md" }}
                  noOfLines={1}
                >
                  {selectedConversation.participants[0]?.name}
                </Text>
                {onlineUser?.includes(selectedConversation.participants[0]?._id) && (
                  <Text fontSize={{ base: "2xs", md: "xs" }} color="green.500">
                    Online
                  </Text>
                )}
              </Box>
            </Flex>

            {/* Messages */}
            <Box
              ref={messagesContainerRef}
              flex={1}
              overflowY="auto"
              p={4}
              bg={useColorModeValue('white', '#101010')}
            >
              <VStack align="stretch" spacing={4}>
                {messages.map((msg) => {
                  const isOwn = msg.sender?._id === user._id
                  return (
                    <Flex
                      key={msg._id}
                      justifyContent={isOwn ? 'flex-end' : 'flex-start'}
                      alignItems="flex-end"
                      gap={2}
                      direction={isOwn ? 'row-reverse' : 'row'}
                    >
                      <Avatar
                        size="sm"
                        src={isOwn ? user.profilePic : msg.sender?.profilePic}
                        name={isOwn ? user.name : msg.sender?.name}
                      />
                      <Flex direction="column" maxW="70%" align={isOwn ? 'flex-end' : 'flex-start'}>
                        <Box
                          bg={isOwn ? 'blue.500' : useColorModeValue('gray.200', '#1a1a1a')}
                          color={isOwn ? 'white' : useColorModeValue('black', 'white')}
                          p={3}
                          borderRadius="xl"
                          borderTopLeftRadius={isOwn ? 'xl' : 'sm'}
                          borderTopRightRadius={isOwn ? 'sm' : 'xl'}
                        >
                          <Text>{msg.text}</Text>
                        </Box>
                        <Text
                          fontSize="xs"
                          color="gray.500"
                          mt={1}
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

            {/* Message Input - Responsive */}
            <Flex
              p={{ base: 2, md: 4 }}
              borderTop="1px solid"
              borderColor={borderColor}
              gap={{ base: 1, md: 2 }}
              alignItems="center"
              bg={bgColor}
            >
              <Box
                w={{ base: 8, md: 10 }}
                h={{ base: 8, md: 10 }}
                bg="green.500"
                borderRadius="full"
                display="flex"
                alignItems="center"
                justifyContent="center"
                cursor="pointer"
                _hover={{ bg: 'green.600' }}
                flexShrink={0}
              >
                <Text color="white" fontWeight="bold" fontSize={{ base: "sm", md: "lg" }}>G</Text>
              </Box>
              <Button
                bg="blue.500"
                color="white"
                _hover={{ bg: 'blue.600' }}
                onClick={() => {
                  const recipientId = selectedConversation?.participants[0]?._id
                  if (recipientId) {
                    callUser(recipientId)
                  }
                }}
                borderRadius="full"
                size={{ base: "sm", md: "md" }}
                isDisabled={!selectedConversation?.participants[0]?._id || callAccepted}
                minW={{ base: "36px", md: "auto" }}
                px={{ base: 2, md: 4 }}
                flexShrink={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                <FaPhone size={{ base: 14, md: 16 }} />
              </Button>
              <Input
                placeholder="write something..."
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
                fontSize={{ base: "sm", md: "md" }}
                size={{ base: "sm", md: "md" }}
              />
              <Button
                bg="green.500"
                color="white"
                _hover={{ bg: 'green.600' }}
                onClick={handleSendMessage}
                isLoading={sending}
                borderRadius="md"
                px={{ base: 4, md: 6 }}
                size={{ base: "sm", md: "md" }}
                fontSize={{ base: "sm", md: "md" }}
                flexShrink={0}
              >
                Send
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
            .filter(user => onlineUser?.includes(user._id))
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
          {followedUsers.filter(user => onlineUser?.includes(user._id)).length === 0 && (
            <Text px={4} py={8} color="gray.500" fontSize="sm" textAlign="center">
              No friends online
            </Text>
          )}
        </VStack>
      </Box>
    </Flex>
    </>
  )
}

export default MessagesPage

