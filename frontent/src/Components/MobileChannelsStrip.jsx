import React, { useEffect, useState } from 'react'
import {
  Box,
  SimpleGrid,
  VStack,
  Avatar,
  Text,
  Spinner,
  Button,
  Input,
  useColorModeValue,
} from '@chakra-ui/react'
import useShowToast from '../hooks/useShowToast'
import { ensureChannelLivePost, scrollToHomeFeed } from '../utils/channelNavigation'

const CACHE_KEY = 'suggestedChannelsCache'

/** Mobile live channels — same idea as desktop: tap adds to feed, then scroll to watch. */
const MobileChannelsStrip = () => {
  const showToast = useShowToast()
  const [channels, setChannels] = useState([])
  const [links, setLinks] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [caption, setCaption] = useState('')
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
        if (!cancelled && res.ok && Array.isArray(json.links)) {
          setLinks(json.links)
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
      const result = await ensureChannelLivePost(channel, streamIndex, caption.trim())
      if (!result.ok) {
        showToast('Error', result.error || 'Could not add channel', 'error')
        return
      }
      setExpandedId(null)
      if (!result.posted) {
        showToast('Info', 'Already in your feed', 'info')
        return
      }
      showToast('Success', `🔴 ${channel.name} added to your feed!`, 'success')
      scrollToHomeFeed(result.postId)
    } catch (e) {
      console.error('[MobileChannelsStrip] addChannelToFeed', e)
      showToast('Error', 'Could not add channel', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const onChannelTap = (channel) => {
    setExpandedId((prev) => (prev === channel.id ? null : channel.id))
  }

  const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'

  const saveLink = async () => {
    if (!addUrl.trim()) return
    setBusyKey('add')
    try {
      const res = await fetch(`${baseUrl}/api/news/links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: /^https?:\/\//i.test(addUrl.trim()) ? addUrl.trim() : `https://${addUrl.trim()}` }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('Error', data.error || 'Could not add link', 'error')
        return
      }
      if (data.link) {
        setLinks((prev) => [data.link, ...prev.filter((item) => String(item._id) !== String(data.link._id))])
      }
      setAddUrl('')
      setAddOpen(false)
      showToast('Success', 'Link added', 'success')
    } catch (e) {
      showToast('Error', 'Could not add link', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const hideChannel = async (channelId) => {
    setBusyKey(`hide-${channelId}`)
    try {
      const res = await fetch(`${baseUrl}/api/news/channels/hide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      })
      if (!res.ok) {
        showToast('Error', 'Could not remove channel', 'error')
        return
      }
      setChannels((prev) => prev.filter((c) => c.id !== channelId))
      setExpandedId(null)
    } catch (e) {
      showToast('Error', 'Could not remove channel', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const watchLink = async (link) => {
    setBusyKey(`link-${link._id}`)
    try {
      const res = await fetch(`${baseUrl}/api/news/links/${link._id}/watch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: caption.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('Error', data.error || 'Could not add to feed', 'error')
        return
      }
      if (data.posted === false) {
        showToast('Info', 'Already in your feed', 'info')
        return
      }
      showToast('Success', 'Added to your feed', 'success')
      scrollToHomeFeed(data.postId)
    } catch (e) {
      showToast('Error', 'Could not add to feed', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const shareBody = async (body, key) => {
    setBusyKey(key)
    try {
      const res = await fetch(`${baseUrl}/api/news/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, text: caption.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('Error', data.error || 'Could not share', 'error')
        return
      }
      showToast('Success', 'Shared to your followers', 'success')
      setExpandedId(null)
    } catch (e) {
      showToast('Error', 'Could not share', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const removeLink = async (linkId) => {
    setBusyKey(`del-${linkId}`)
    try {
      const res = await fetch(`${baseUrl}/api/news/links/${linkId}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        showToast('Error', 'Could not remove link', 'error')
        return
      }
      setLinks((prev) => prev.filter((item) => String(item._id) !== String(linkId)))
      setExpandedId(null)
    } catch (e) {
      showToast('Error', 'Could not remove link', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const expanded = channels.find((c) => c.id === expandedId)
  const expandedLink = links.find((link) => `link:${link._id}` === expandedId)

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
                  position="relative"
                >
                  <Box
                    as="button"
                    type="button"
                    position="absolute"
                    top="2px"
                    right="2px"
                    zIndex={2}
                    w="16px"
                    h="16px"
                    borderRadius="full"
                    bg="red.500"
                    color="white"
                    fontSize="10px"
                    lineHeight="14px"
                    onClick={(e) => { e.stopPropagation(); hideChannel(channel.id) }}
                  >
                    ✕
                  </Box>
                  {isBusy ? (
                    <Spinner size="sm" mx="auto" mb={1} />
                  ) : (
                    <Avatar
                      name={channel.name}
                      src={channel.thumbnail}
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
            {links.map((link) => (
              <Box
                key={link._id}
                as="button"
                type="button"
                w="full"
                p={2}
                borderRadius="md"
                border="1px solid"
                borderColor={expandedId === `link:${link._id}` ? 'blue.400' : borderColor}
                bg={cardBg}
                onClick={() => setExpandedId((prev) => (prev === `link:${link._id}` ? null : `link:${link._id}`))}
                position="relative"
              >
                <Box
                  as="button"
                  type="button"
                  position="absolute"
                  top="2px"
                  right="2px"
                  zIndex={2}
                  w="16px"
                  h="16px"
                  borderRadius="full"
                  bg="red.500"
                  color="white"
                  fontSize="10px"
                  lineHeight="14px"
                  onClick={(e) => { e.stopPropagation(); removeLink(link._id) }}
                >
                  ✕
                </Box>
                <Avatar name={link.title || 'Video'} src={link.thumbnail} size="sm" mx="auto" mb={1} bg="purple.500" />
                <Text fontSize="2xs" color={textColor} noOfLines={2}>{link.title || 'Video'}</Text>
              </Box>
            ))}
            <Box
              as="button"
              type="button"
              w="full"
              p={2}
              borderRadius="md"
              border="1px dashed"
              borderColor={borderColor}
              onClick={() => setAddOpen((open) => !open)}
            >
              <Text fontSize="lg" color={textColor}>+</Text>
              <Text fontSize="2xs" color={textColor}>Add</Text>
            </Box>
          </SimpleGrid>

          {addOpen && (
            <VStack mt={2} spacing={2} align="stretch">
              <Input size="sm" placeholder="Paste any link" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveLink() }} />
              <Button size="sm" colorScheme="blue" onClick={saveLink} isLoading={busyKey === 'add'}>Add link</Button>
            </VStack>
          )}

          {expandedLink && (
            <VStack mt={3} spacing={2} align="stretch">
              <Input size="sm" placeholder="Write something (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
              <Button size="sm" colorScheme="red" onClick={() => watchLink(expandedLink)} isLoading={busyKey === `link-${expandedLink._id}`}>Add to my feed</Button>
              <Button size="sm" variant="outline" onClick={() => shareBody({ linkId: expandedLink._id }, `share-${expandedLink._id}`)}>Share to feed</Button>
              <Button size="sm" variant="ghost" onClick={() => removeLink(expandedLink._id)}>Remove</Button>
            </VStack>
          )}

          {expanded && (
            <Box
              mt={3}
              p={2}
              bg={cardBg}
              borderRadius="md"
              border="1px solid"
              borderColor={borderColor}
            >
              <Text fontSize="xs" color={textColor} mb={2} fontWeight="semibold">
                {expanded.name}
              </Text>
              <Input size="sm" mb={2} placeholder="Write something (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
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
                      Add to my feed {stream.name ? `(${stream.name})` : ''}
                    </Button>
                  )
                })}
                {expanded.streams.map((stream, index) => (
                  <Button
                    key={`share-${index}`}
                    size="sm"
                    variant="outline"
                    onClick={() => shareBody({ channelId: expanded.id, streamIndex: index }, `share-${expanded.id}-${index}`)}
                  >
                    Share to feed {expanded.streams.length > 1 && stream.name ? `(${stream.name})` : ''}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => hideChannel(expanded.id)}>Remove</Button>
              </VStack>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

export default MobileChannelsStrip
