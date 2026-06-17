import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  Box, Text, Flex, Input, Button, VStack,
} from '@chakra-ui/react'
import { useEffect, useRef, useState, useContext } from 'react'
import { UserContext } from '../context/UserContext'
import { useLiveBroadcast } from '../context/LiveBroadcastContext'
import useShowToast from '../hooks/useShowToast'

const LiveViewerChatModal = ({ isOpen, onClose }) => {
  const { user } = useContext(UserContext)
  const { liveChatMessages, sendChat } = useLiveBroadcast()
  const showToast = useShowToast()
  const [input, setInput] = useState('')
  const listRef = useRef(null)

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="md" blockScrollOnMount={false}>
      <ModalOverlay bg="blackAlpha.700" zIndex={1800} />
      <ModalContent maxH="52vh" display="flex" flexDirection="column" zIndex={1801}>
        <ModalHeader pb={2}>Live messages</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={4} display="flex" flexDirection="column" flex={1} minH={0}>
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
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default LiveViewerChatModal
