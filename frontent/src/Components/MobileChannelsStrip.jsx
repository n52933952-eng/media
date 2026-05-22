import React, { useEffect, useState } from 'react'
import { Box, HStack, Avatar, Text, Spinner, useColorModeValue } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import useShowToast from '../hooks/useShowToast'

const CACHE_KEY = 'suggestedChannelsCache'

/** Live channels row for mobile home — same data as desktop SuggestedChannels sidebar. */
const MobileChannelsStrip = () => {
  const navigate = useNavigate()
  const showToast = useShowToast()
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const textColor = useColorModeValue('gray.800', 'white')
  const hoverBg = useColorModeValue('gray.100', 'gray.700')

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

  const openChannel = async (channel) => {
    const channelUsername = channel?.username
    if (!channelUsername) return
    try {
      const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
      const userRes = await fetch(`${baseUrl}/api/user/getUserPro/${channelUsername}`, {
        credentials: 'include',
      })
      const userData = await userRes.json()
      if (!userRes.ok || !userData?._id) {
        showToast('Error', 'Channel not found', 'error')
        return
      }
      const postsRes = await fetch(`${baseUrl}/api/post/user/id/${userData._id}?limit=1`, {
        credentials: 'include',
      })
      const postsData = await postsRes.json()
      if (postsRes.ok && postsData.posts?.length > 0) {
        navigate(`/${channelUsername}/post/${postsData.posts[0]._id}`)
      } else {
        showToast('Info', 'No posts from this channel yet', 'info')
      }
    } catch (e) {
      console.error(e)
      showToast('Error', 'Could not load channel', 'error')
    }
  }

  if (!loading && channels.length === 0) return null

  return (
    <Box>
      <Text fontSize="sm" fontWeight="bold" color={textColor} mb={2}>
        Channels
      </Text>
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <HStack spacing={3} overflowX="auto" pb={1} sx={{ WebkitOverflowScrolling: 'touch' }}>
          {channels.map((channel) => (
            <Box
              key={channel.id || channel.username}
              as="button"
              type="button"
              onClick={() => openChannel(channel)}
              flexShrink={0}
              textAlign="center"
              minW="64px"
              _hover={{ bg: hoverBg }}
              borderRadius="md"
              p={1}
            >
              <Avatar name={channel.name} size="sm" bg="blue.500" mx="auto" mb={1} />
              <Text fontSize="2xs" color={textColor} noOfLines={2} maxW="72px">
                {channel.name}
              </Text>
            </Box>
          ))}
        </HStack>
      )}
    </Box>
  )
}

export default MobileChannelsStrip
