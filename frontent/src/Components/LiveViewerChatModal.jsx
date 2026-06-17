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
  const inputRef = useRef(null)
  const panelBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200')
  const footerBg = useColorModeValue('gray.50', 'gray.900')
  const mutedText = useColorModeValue('gray.500', 'gray.400')

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
      inputRef.current?.focus()
    }, 120)
    return () => clearTimeout(t)
  }, [isOpen, liveChatMessages.length])

  const handleClose = (e) => {
    e?.stopPropagation?.()
    e?.preventDefault?.()
    onClose()
  }

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
    inputRef.current?.focus()
  }

  if (!isOpen) return null

  return createPortal(
    <Box
      position="fixed"
      inset={0}
      zIndex={MODAL_Z}
      bg="rgba(0, 0, 0, 0.72)"
      backdropFilter="blur(3px)"
      pointerEvents="auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(e) }}
      onTouchEnd={(e) => { if (e.target === e.currentTarget) handleClose(e) }}
      role="dialog"
      aria-modal="true"
      aria-label="Live messages"
    >
      {/* Bottom sheet — full width, anchored to screen bottom */}
      <Box
        position="absolute"
        left={0}
        right={0}
        bottom={0}
        w="full"
        h={{ base: 'min(52vh, 420px)', sm: 'min(48vh, 400px)' }}
        bg={panelBg}
        borderTopRadius="2xl"
        boxShadow="0 -8px 40px rgba(0,0,0,0.45)"
        display="flex"
        flexDirection="column"
        overflow="hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        pb="max(env(safe-area-inset-bottom, 0px), 0px)"
      >
        {/* Header */}
        <Flex
          align="center"
          justify="space-between"
          px={4}
          h="52px"
          borderBottom="1px solid"
          borderColor={borderColor}
          flexShrink={0}
        >
          <Text fontWeight="bold" fontSize="md">Live messages</Text>
          <IconButton
            aria-label="Close live messages"
            icon={<CloseIcon boxSize={3} />}
            size="sm"
            variant="ghost"
            onClick={handleClose}
          />
        </Flex>

        {/* Messages */}
        <Box
          ref={listRef}
          flex={1}
          minH={0}
          overflowY="auto"
          px={4}
          py={3}
        >
          {liveChatMessages.length === 0 ? (
            <Flex align="center" justify="center" h="full">
              <Text color={mutedText} fontSize="sm">No messages yet</Text>
            </Flex>
          ) : (
            <VStack align="stretch" spacing={3} pb={1}>
              {liveChatMessages.map((item) => (
                <Box key={item.id}>
                  <Text fontSize="xs" fontWeight="bold" color="blue.400" mb={0.5}>
                    {item.sender}
                  </Text>
                  <Text fontSize="sm" lineHeight="short">{item.text}</Text>
                </Box>
              ))}
            </VStack>
          )}
        </Box>

        {/* Input — always at screen bottom */}
        <Flex
          as="form"
          px={3}
          py={3}
          gap={2}
          align="center"
          borderTop="1px solid"
          borderColor={borderColor}
          bg={footerBg}
          flexShrink={0}
          onSubmit={(e) => { e.preventDefault(); void onSend() }}
        >
          <Input
            ref={inputRef}
            flex={1}
            size="md"
            h="44px"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Say something…"
            borderRadius="full"
            bg={panelBg}
            px={4}
          />
          <Button
            type="submit"
            colorScheme="blue"
            h="44px"
            borderRadius="full"
            px={6}
            flexShrink={0}
            isDisabled={!input.trim()}
          >
            Send
          </Button>
        </Flex>
      </Box>
    </Box>,
    document.body,
  )
}

export default LiveViewerChatModal
