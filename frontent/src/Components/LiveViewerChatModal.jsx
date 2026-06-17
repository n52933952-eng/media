import {
  Box, Text, Flex, Input, Button, VStack, IconButton, useColorModeValue,
} from '@chakra-ui/react'
import { CloseIcon } from '@chakra-ui/icons'
import { useEffect, useRef, useState, useContext } from 'react'
import { createPortal } from 'react-dom'
import { UserContext } from '../context/UserContext'
import { useLiveBroadcast } from '../context/LiveBroadcastContext'
import useShowToast from '../hooks/useShowToast'

const MODAL_Z = 9990

const LiveViewerChatModal = ({ isOpen, onClose }) => {
  const { user } = useContext(UserContext)
  const { liveChatMessages, sendChat } = useLiveBroadcast()
  const showToast = useShowToast()
  const [input, setInput] = useState('')
  const listRef = useRef(null)
  const panelBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200')

  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(t)
  }, [isOpen, liveChatMessages.length])

  const onSend = async () => {
    const text = input.trim()
    if (!text) return
    const sender = user?.name || user?.username || 'Streamer'
    const sent = await sendChat(text, sender)
    if (!sent) {
      showToast('Slow down', 'Wait a moment before sending another message', 'warning')
      return
    }
    setInput('')
  }

  if (!isOpen) return null

  return createPortal(
    <Box
      position="fixed"
      inset={0}
      zIndex={MODAL_Z}
      bg="blackAlpha.750"
      display="flex"
      alignItems="center"
      justifyContent="center"
      px={4}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Live messages"
    >
      <Box
        bg={panelBg}
        borderRadius="xl"
        w="full"
        maxW="md"
        maxH="52vh"
        display="flex"
        flexDirection="column"
        boxShadow="2xl"
        border="1px solid"
        borderColor={borderColor}
        overflow="hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Flex align="center" justify="space-between" px={4} pt={4} pb={2}>
          <Text fontWeight="bold" fontSize="lg">Live messages</Text>
          <IconButton
            aria-label="Close live messages"
            icon={<CloseIcon />}
            size="sm"
            variant="ghost"
            onClick={onClose}
          />
        </Flex>
        <Box px={4} pb={4} display="flex" flexDirection="column" flex={1} minH={0}>
          <Box
            ref={listRef}
            flex={1}
            overflowY="auto"
            mb={3}
            pr={1}
            minH="200px"
            maxH="280px"
          >
            {liveChatMessages.length === 0 ? (
              <Text color="gray.500" fontSize="sm" textAlign="center" py={8}>
                No messages yet
              </Text>
            ) : (
              <VStack align="stretch" spacing={2}>
                {liveChatMessages.map((item) => (
                  <Box key={item.id}>
                    <Text fontSize="sm" fontWeight="bold" color="blue.400">{item.sender}</Text>
                    <Text fontSize="sm">{item.text}</Text>
                  </Box>
                ))}
              </VStack>
            )}
          </Box>
          <Flex gap={2}>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Say something…"
              onKeyDown={(e) => { if (e.key === 'Enter') onSend() }}
            />
            <Button colorScheme="blue" onClick={onSend}>Send</Button>
          </Flex>
        </Box>
      </Box>
    </Box>,
    document.body,
  )
}

export default LiveViewerChatModal
