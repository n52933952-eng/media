import React, { useEffect, useState } from 'react'
import {
  Box,
  SimpleGrid,
  VStack,
  Avatar,
  Text,
  Spinner,
  Button,
  useColorModeValue,
} from '@chakra-ui/react'
import useShowToast from '../hooks/useShowToast'
import { ensureChannelLivePost, scrollToHomeFeed } from '../utils/channelNavigation'

const CACHE_KEY = 'suggestedChannelsCache'

/** Mobile live channels — same idea as desktop: tap adds to feed, then scroll to watch. */
const MobileChannelsStrip = () => {
  const showToast = useShowToast()
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const textColor = useColorModeValue('gray.800', 'white')
  const cardBg = useColorModeValue('white', '#252b3b')
  const borderColor = useColorModeValue('gray.200', '#2d2d2d')
  const hoverBg = useColorModeValue('gray.50', 'gray.700')

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

  const addChannelToFeed = async (channel, streamIndex = 0) => {
    if (!channel?.id) return
    const key = `${channel.id}-${streamIndex}`
    setBusyKey(key)
    try {
      const result = await ensureChannelLivePost(channel, streamIndex)
      if (!result.ok) {
        showToast('Error', result.error || 'Could not add channel', 'error')
        return
      }
      const msg = result.posted
        ? `🔴 ${channel.name} added to your feed!`
        : `${channel.name} is already in your feed`
      showToast('Success', msg, 'success')
      setExpandedId(null)
      scrollToHomeFeed(result.postId)
    } catch (e) {
      console.error('[MobileChannelsStrip] addChannelToFeed', e)
      showToast('Error', 'Could not add channel', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const onChannelTap = (channel) => {
    const streams = channel.streams || []
    if (streams.length > 1) {
      setExpandedId((prev) => (prev === channel.id ? null : channel.id))
      return
    }
    addChannelToFeed(channel, 0)
  }

  if (!loading && channels.length === 0) return null

  const expanded = channels.find((c) => c.id === expandedId)

  return (
    <Box>
      <Text fontSize="sm" fontWeight="bold" color={textColor} mb={2}>
        🔴 Live Channels
      </Text>
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <>
          <SimpleGrid columns={3} spacing={2}>
            {channels.map((channel) => {
              const isExpanded = expandedId === channel.id
              const isBusy = busyKey?.startsWith(`${channel.id}-`)
              return (
                <Box
                  key={channel.id}
                  as="button"
                  type="button"
                  w="full"
                  p={2}
                  borderRadius="md"
                  border="1px solid"
                  borderColor={isExpanded ? 'blue.400' : borderColor}
                  bg={isExpanded ? hoverBg : cardBg}
                  _hover={{ bg: hoverBg, borderColor: 'blue.300' }}
                  onClick={() => onChannelTap(channel)}
                  textAlign="center"
                  opacity={isBusy ? 0.7 : 1}
                >
                  {isBusy ? (
                    <Spinner size="sm" mx="auto" mb={1} />
                  ) : (
                    <Avatar
                      name={channel.name}
                      size="sm"
                      bg="blue.500"
                      mx="auto"
                      mb={1}
                      pointerEvents="none"
                    />
                  )}
                  <Text fontSize="2xs" color={textColor} noOfLines={2} lineHeight="short">
                    {channel.name}
                  </Text>
                </Box>
              )
            })}
          </SimpleGrid>

          {expanded && expanded.streams?.length > 1 && (
            <Box
              mt={3}
              p={2}
              bg={cardBg}
              borderRadius="md"
              border="1px solid"
              borderColor={borderColor}
            >
              <Text fontSize="xs" color={textColor} mb={2} fontWeight="semibold">
                {expanded.name} — choose language
              </Text>
              <VStack align="stretch" spacing={2}>
                {expanded.streams.map((stream, index) => {
                  const key = `${expanded.id}-${index}`
                  return (
                    <Button
                      key={key}
                      size="sm"
                      colorScheme="blue"
                      w="full"
                      isLoading={busyKey === key}
                      onClick={(e) => {
                        e.stopPropagation()
                        addChannelToFeed(expanded, index)
                      }}
                      leftIcon={<Box w={2} h={2} bg="red.500" borderRadius="full" />}
                    >
                      Watch Live {stream.name ? `(${stream.name})` : ''}
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
