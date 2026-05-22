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
import { ensureChannelLivePost, scrollToHomeFeed } from '../utils/channelNavigation'

const CACHE_KEY = 'suggestedChannelsCache'

/**
 * Mobile channels:
 * - Tap channel name → add to feed + scroll (like desktop "Watch Live")
 * - Tap avatar → open post detail page (same as tapping post avatar in feed)
 */
const MobileChannelsStrip = () => {
  const navigate = useNavigate()
  const showToast = useShowToast()
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState(null)
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

  /** Add stream to feed and scroll — does not leave home. */
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

  /** Avatar tap → post detail (full page). */
  const openChannelPost = async (channel, streamIndex = 0) => {
    if (!channel?.id || !channel?.username) return
    const key = `nav-${channel.id}-${streamIndex}`
    setBusyKey(key)
    try {
      const result = await ensureChannelLivePost(channel, streamIndex)
      if (result.ok) {
        navigate(`/${channel.username}/post/${result.postId}`)
        return
      }
      showToast('Error', result.error || 'Could not open channel', 'error')
    } catch (e) {
      console.error('[MobileChannelsStrip] openChannelPost', e)
      showToast('Error', 'Could not open channel', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const onChannelLabelTap = (channel) => {
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
        Channels
      </Text>
      <Text fontSize="2xs" color={textColor} opacity={0.65} mb={2}>
        Tap name to add to feed · tap avatar for full post
      </Text>
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <>
          <HStack spacing={3} overflowX="auto" pb={1} sx={{ WebkitOverflowScrolling: 'touch' }}>
            {channels.map((channel) => {
              const busy = busyKey?.startsWith(`${channel.id}-`) || busyKey === `nav-${channel.id}-0`
              return (
                <Box
                  key={channel.id || channel.username}
                  flexShrink={0}
                  textAlign="center"
                  minW="64px"
                  borderRadius="md"
                  p={1}
                  border="1px solid"
                  borderColor={expandedId === channel.id ? 'blue.400' : 'transparent'}
                  opacity={busy ? 0.75 : 1}
                >
                  {busy && !busyKey?.startsWith('nav-') ? (
                    <Spinner size="sm" mx="auto" mb={1} />
                  ) : (
                    <Avatar
                      as="button"
                      type="button"
                      name={channel.name}
                      size="sm"
                      bg="blue.500"
                      mx="auto"
                      mb={1}
                      cursor="pointer"
                      _hover={{ transform: 'scale(1.05)' }}
                      transition="transform 0.15s"
                      onClick={() => openChannelPost(channel, 0)}
                      aria-label={`Open ${channel.name} post`}
                    />
                  )}
                  <Box
                    as="button"
                    type="button"
                    w="full"
                    onClick={() => onChannelLabelTap(channel)}
                    borderRadius="md"
                    _hover={{ bg: hoverBg }}
                    py={0.5}
                  >
                    <Text fontSize="2xs" color={textColor} noOfLines={2} maxW="72px" mx="auto">
                      {channel.name}
                    </Text>
                  </Box>
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
                {expanded.name} — add to feed
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
                      isLoading={busyKey === key}
                      onClick={() => addChannelToFeed(expanded, index)}
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
