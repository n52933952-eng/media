import React, { useEffect, useState } from 'react'
import {
  Box,
  HStack,
  VStack,
  Avatar,
  Text,
  Spinner,
  Button,
  useColorModeValue,
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import useShowToast from '../hooks/useShowToast'
import { ensureChannelLivePost } from '../utils/channelNavigation'

const CACHE_KEY = 'suggestedChannelsCache'

/** Live channels on mobile — tap opens the channel post (creates stream post if needed). */
const MobileChannelsStrip = () => {
  const navigate = useNavigate()
  const showToast = useShowToast()
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [openingKey, setOpeningKey] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const textColor = useColorModeValue('gray.800', 'white')
  const hoverBg = useColorModeValue('gray.100', 'gray.700')
  const cardBg = useColorModeValue('gray.50', '#252b3b')
  const borderColor = useColorModeValue('gray.200', '#2d2d2d')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) {
          const data = JSON.parse(cached)
          if (data?.channels?.length) setChannels(data.channels)
        }

        const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
        const res = await fetch(`${baseUrl}/api/news/channels`, { credentials: 'include' })
        const json = await res.json()
        if (!cancelled && res.ok && json.channels) {
          setChannels(json.channels)
        }
      } catch (e) {
        console.error('[MobileChannelsStrip]', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const openChannel = async (channel, streamIndex = 0) => {
    if (!channel?.id || !channel?.username) return
    const key = `${channel.id}-${streamIndex}`
    setOpeningKey(key)
    try {
      const result = await ensureChannelLivePost(channel, streamIndex)
      if (result.ok) {
        navigate(`/${channel.username}/post/${result.postId}`)
        return
      }
      showToast('Error', result.error || 'Could not open channel', 'error')
    } catch (e) {
      console.error('[MobileChannelsStrip] openChannel', e)
      showToast('Error', 'Could not open channel', 'error')
    } finally {
      setOpeningKey(null)
    }
  }

  const onChannelTap = (channel) => {
    const streams = channel.streams || []
    if (streams.length > 1) {
      setExpandedId((prev) => (prev === channel.id ? null : channel.id))
      return
    }
    openChannel(channel, 0)
  }

  if (!loading && channels.length === 0) return null

  const expanded = channels.find((c) => c.id === expandedId)

  return (
    <Box>
      <Text fontSize="sm" fontWeight="bold" color={textColor} mb={2}>
        Channels
      </Text>
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <>
          <HStack spacing={3} overflowX="auto" pb={1} sx={{ WebkitOverflowScrolling: 'touch' }}>
            {channels.map((channel) => {
              const busy = openingKey?.startsWith(`${channel.id}-`)
              return (
                <Box
                  key={channel.id || channel.username}
                  as="button"
                  type="button"
                  onClick={() => onChannelTap(channel)}
                  flexShrink={0}
                  textAlign="center"
                  minW="64px"
                  _hover={{ bg: hoverBg }}
                  borderRadius="md"
                  p={1}
                  border="1px solid"
                  borderColor={expandedId === channel.id ? 'blue.400' : 'transparent'}
                  opacity={busy ? 0.7 : 1}
                >
                  {busy ? (
                    <Spinner size="sm" mx="auto" mb={1} />
                  ) : (
                    <Avatar name={channel.name} size="sm" bg="blue.500" mx="auto" mb={1} />
                  )}
                  <Text fontSize="2xs" color={textColor} noOfLines={2} maxW="72px">
                    {channel.name}
                  </Text>
                </Box>
              )
            })}
          </HStack>

          {expanded && expanded.streams?.length > 1 && (
            <Box
              mt={2}
              p={2}
              bg={cardBg}
              borderRadius="md"
              border="1px solid"
              borderColor={borderColor}
            >
              <Text fontSize="xs" color={textColor} mb={2} fontWeight="semibold">
                {expanded.name} — choose stream
              </Text>
              <VStack align="stretch" spacing={1}>
                {expanded.streams.map((stream, index) => {
                  const key = `${expanded.id}-${index}`
                  return (
                    <Button
                      key={key}
                      size="sm"
                      colorScheme="blue"
                      variant="outline"
                      isLoading={openingKey === key}
                      onClick={() => openChannel(expanded, index)}
                      leftIcon={<Box w={2} h={2} bg="red.500" borderRadius="full" />}
                    >
                      {stream.name || `Stream ${index + 1}`}
                    </Button>
                  )
                })}
              </VStack>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

export default MobileChannelsStrip
