import {
  Box, Text, Flex, Input, Button, VStack, IconButton, useColorModeValue,
} from '@chakra-ui/react'
import { CloseIcon } from '@chakra-ui/icons'
import { useEffect, useRef, useState, useContext, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { UserContext } from '../context/UserContext'
import { useLiveBroadcast } from '../context/LiveBroadcastContext'
import useShowToast from '../hooks/useShowToast'

const PANEL_Z = 1710
const PANEL_W = 300
const PANEL_H = 320
const VIEWPORT_PAD = 8
const ANCHOR_GAP = 10

function computePanelPosition(anchorEl) {
  const rect = anchorEl.getBoundingClientRect()
  let left = rect.left + rect.width / 2 - PANEL_W / 2
  let top = rect.top - PANEL_H - ANCHOR_GAP

  if (top < VIEWPORT_PAD) {
    top = rect.bottom + ANCHOR_GAP
  }

  left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - PANEL_W - VIEWPORT_PAD))
  top = Math.max(VIEWPORT_PAD, Math.min(top, window.innerHeight - PANEL_H - VIEWPORT_PAD))

  return { left, top }
}

const LiveViewerChatModal = ({ isOpen, onClose, anchorRef, layoutKey }) => {
  const { user } = useContext(UserContext)
  const { liveChatMessages, sendChat } = useLiveBroadcast()
  const showToast = useShowToast()
  const [input, setInput] = useState('')
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 })
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const panelBg = useColorModeValue('white', 'gray.900')
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200')
  const footerBg = useColorModeValue('gray.50', 'gray.950')
  const mutedText = useColorModeValue('gray.500', 'gray.400')

  const updatePosition = useCallback(() => {
    const anchor = anchorRef?.current
    if (!anchor) return
    setPanelPos(computePanelPosition(anchor))
  }, [anchorRef])

  useEffect(() => {
    if (!isOpen) return
    updatePosition()
    const onLayout = () => updatePosition()
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  }, [isOpen, updatePosition, layoutKey])

  useEffect(() => {
    if (!isOpen) return
    const onDocDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('touchstart', onDocDown)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('touchstart', onDocDown)
    }
  }, [isOpen, onClose, anchorRef])

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
      inputRef.current?.focus()
    }, 80)
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

  if (!isOpen || !anchorRef?.current) return null

  return createPortal(
    <Box
      ref={panelRef}
      position="fixed"
      left={`${panelPos.left}px`}
      top={`${panelPos.top}px`}
      w={`${PANEL_W}px`}
      h={`${PANEL_H}px`}
      zIndex={PANEL_Z}
      bg={panelBg}
      borderRadius="xl"
      border="1px solid"
      borderColor={borderColor}
      boxShadow="0 12px 40px rgba(0,0,0,0.55)"
      display="flex"
      flexDirection="column"
      overflow="hidden"
      pointerEvents="auto"
      role="dialog"
      aria-modal="false"
      aria-label="Live messages"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <Flex
        align="center"
        justify="space-between"
        px={3}
        h="40px"
        borderBottom="1px solid"
        borderColor={borderColor}
        flexShrink={0}
        bg={footerBg}
      >
        <Text fontWeight="bold" fontSize="sm">Live Chat</Text>
        <IconButton
          aria-label="Close live messages"
          icon={<CloseIcon boxSize={2.5} />}
          size="xs"
          variant="ghost"
          onClick={handleClose}
        />
      </Flex>

      <Box
        ref={listRef}
        flex={1}
        minH={0}
        overflowY="auto"
        px={3}
        py={2}
      >
        {liveChatMessages.length === 0 ? (
          <Flex align="center" justify="center" h="full">
            <Text color={mutedText} fontSize="xs">No messages yet</Text>
          </Flex>
        ) : (
          <VStack align="stretch" spacing={2} pb={1}>
            {liveChatMessages.map((item) => (
              <Box key={item.id}>
                <Text fontSize="xs" fontWeight="bold" color="blue.400" mb={0.5} noOfLines={1}>
                  {item.sender}
                </Text>
                <Text fontSize="xs" lineHeight="short" wordBreak="break-word">{item.text}</Text>
              </Box>
            ))}
          </VStack>
        )}
      </Box>

      <Flex
        as="form"
        px={2}
        py={2}
        gap={1.5}
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
          size="sm"
          h="34px"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Say something…"
          borderRadius="full"
          bg={panelBg}
          px={3}
          fontSize="xs"
        />
        <Button
          type="submit"
          colorScheme="blue"
          size="sm"
          h="34px"
          borderRadius="full"
          px={3}
          fontSize="xs"
          flexShrink={0}
          isDisabled={!input.trim()}
        >
          Send
        </Button>
      </Flex>
    </Box>,
    document.body,
  )
}

export default LiveViewerChatModal
