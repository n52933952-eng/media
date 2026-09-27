import React, { useCallback, useContext, useEffect, useState } from 'react'
import { Box, Flex, Text, Avatar, Button, Image, IconButton, Spinner, useColorModeValue } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'
import { followPostHeaders } from '../utils/followRequest.js'
import API_BASE_URL from '../config/api'

const ExplorePage = () => {
  const { user: currentUser, setUser } = useContext(UserContext)
  const showToast = useShowToast()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [followingId, setFollowingId] = useState('')
  const cardBg = useColorModeValue('white', 'gray.800')
  const border = useColorModeValue('gray.200', 'gray.700')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const emptyBg = useColorModeValue('gray.50', 'whiteAlpha.100')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
      const res = await fetch(`${base}/api/user/explore?limit=12`, { credentials: 'include' })
      const data = await res.json()
      setUsers(Array.isArray(data?.users) ? data.users : [])
    } catch (e) {
      showToast('Error', e?.message || 'Could not load people', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { load() }, [load])

  const follow = async (target) => {
    const targetId = String(target?._id || '')
    if (!targetId || !currentUser?._id || followingId) return
    setFollowingId(targetId)
    try {
      const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
      const res = await fetch(`${base}/api/user/follow/${targetId}`, {
        method: 'POST',
        credentials: 'include',
        headers: followPostHeaders,
      })
      const data = await res.json()
      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }
      if (data.current) {
        const next = { ...currentUser, following: data.current.following, followers: data.current.followers }
        localStorage.setItem('userInfo', JSON.stringify(next))
        setUser(next)
      }
      setUsers((prev) => prev.filter((u) => String(u._id) !== targetId))
      showToast('Success', `Following ${target?.name || target?.username || 'user'}`, 'success')
    } catch (e) {
      showToast('Error', e?.message || 'Follow failed', 'error')
    } finally {
      setFollowingId('')
    }
  }

  return (
    <Box py={4}>
      <Flex align="center" justify="space-between" mb={4}>
        <Text fontSize="xl" fontWeight="bold">Explore people</Text>
        <IconButton aria-label="Refresh" icon={<Text fontSize="lg">↻</Text>} onClick={load} variant="ghost" />
      </Flex>
      {loading ? (
        <Flex justify="center" py={16}><Spinner /></Flex>
      ) : users.length === 0 ? (
        <Text color={muted} textAlign="center" py={10}>No people to show yet. Tap refresh.</Text>
      ) : (
        <Flex direction="column" gap={4}>
          {users.map((item) => {
            const preview = item.latestPost
            return (
              <Box key={item._id} p={3} borderWidth="1px" borderColor={border} borderRadius="lg" bg={cardBg}>
                <Flex align="center" gap={3} mb={3}>
                  <Avatar
                    src={item.profilePic}
                    name={item.name || item.username}
                    cursor="pointer"
                    onClick={() => item.username && navigate(`/${item.username}`)}
                  />
                  <Box flex={1} minW={0} cursor="pointer" onClick={() => item.username && navigate(`/${item.username}`)}>
                    <Text fontWeight="bold" noOfLines={1}>{item.name || item.username}</Text>
                    <Text fontSize="sm" color={muted} noOfLines={1}>@{item.username}</Text>
                  </Box>
                  <Button
                    size="sm"
                    colorScheme="blue"
                    isLoading={followingId === String(item._id)}
                    onClick={() => follow(item)}
                  >
                    Follow
                  </Button>
                </Flex>
                {preview?.img ? (
                  <Image src={preview.img} alt="" w="100%" maxH="220px" objectFit="cover" borderRadius="md" />
                ) : (
                  <Box bg={emptyBg} borderRadius="md" px={4} pt={2} pb={4} minH="120px">
                    <Text fontSize="3xl" lineHeight="1" color="blue.400" opacity={0.45} fontWeight="bold">
                      “
                    </Text>
                    <Text fontSize="md" fontWeight="medium" noOfLines={5} mt={-1}>
                      {preview?.text ? String(preview.text).trim() : 'No posts yet'}
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Flex>
      )}
    </Box>
  )
}

export default ExplorePage
