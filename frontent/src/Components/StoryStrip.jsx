import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Box, Flex, Text, Avatar, Spinner, useColorModeValue, useDisclosure } from '@chakra-ui/react'
import { AddIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import API_BASE_URL from '../config/api'
import AddStoryModal from './AddStoryModal'
import StoryViewerModal from './StoryViewerModal'

function userIdOf(entry) {
  const u = entry?.user
  if (!u) return ''
  return (u._id ?? u)?.toString?.() ?? String(u)
}

export default function StoryStrip() {
  const { user } = useContext(UserContext) || {}
  const [strip, setStrip] = useState([])
  const [loading, setLoading] = useState(true)
  const { isOpen: addOpen, onOpen: onAddOpen, onClose: onAddClose } = useDisclosure()
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerUserId, setViewerUserId] = useState(null)
  const [viewerPreview, setViewerPreview] = useState(null)

  const ringUnseen = useColorModeValue(
    'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
    'linear-gradient(45deg, #4facfe, #00f2fe, #43e97b, #38f9d7)'
  )
  const ringSeen = useColorModeValue('gray.300', 'whiteAlpha.400')
  const labelColor = useColorModeValue('gray.600', 'gray.400')
  const bgCard = useColorModeValue('gray.50', 'whiteAlpha.50')
  const stripBorder = useColorModeValue('gray.100', 'whiteAlpha.100')
  const addBadgeBorder = useColorModeValue('white', 'gray.900')

  const fetchStrip = useCallback(async () => {
    if (!user?._id) {
      setStrip([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/story/feed-strip`, { credentials: 'include' })
      const data = await res.json()
      if (res.ok) setStrip(Array.isArray(data.stories) ? data.stories : [])
      else setStrip([])
    } catch {
      setStrip([])
    } finally {
      setLoading(false)
    }
  }, [user?._id])

  useEffect(() => {
    fetchStrip()
  }, [fetchStrip])

  useEffect(() => {
    const onRefresh = () => fetchStrip()
    window.addEventListener('storyStripChanged', onRefresh)
    return () => window.removeEventListener('storyStripChanged', onRefresh)
  }, [fetchStrip])

  const myId = user?._id?.toString?.() ?? String(user?._id ?? '')
  const myEntry = useMemo(
    () => strip.find((s) => userIdOf(s) === myId),
    [strip, myId]
  )

  const others = useMemo(() => {
    return strip
      .filter((s) => userIdOf(s) !== myId)
      .sort((a, b) => {
        if (a.hasUnviewed === b.hasUnviewed) return 0
        return a.hasUnviewed ? -1 : 1
      })
  }, [strip, myId])

  const openViewer = (uid, previewUser) => {
    if (!uid) return
    setViewerUserId(uid)
    setViewerPreview(previewUser || null)
    setViewerOpen(true)
  }

  const closeViewer = () => {
    setViewerOpen(false)
    setViewerUserId(null)
    setViewerPreview(null)
    fetchStrip()
  }

  if (!user?._id) return null

  const AvatarRing = ({ unseen, children, ...boxProps }) => (
    <Box
      p="2px"
      borderRadius="full"
      bg={unseen ? ringUnseen : ringSeen}
      {...boxProps}
    >
      {children}
    </Box>
  )

  return (
    <>
      <Box
        mb={4}
        py={3}
        px={2}
        borderRadius="lg"
        bg={bgCard}
        borderWidth="1px"
        borderColor={stripBorder}
      >
        <Flex align="flex-start" gap={4} overflowX="auto" pb={1} sx={{ scrollbarGutter: 'stable' }}>
          {loading && (
            <Flex align="center" justify="center" minW="56px" minH="72px">
              <Spinner size="sm" />
            </Flex>
          )}

          {!loading && (
            <Flex direction="column" align="center" gap={1} flexShrink={0} w="72px">
              <Box position="relative">
                {myEntry ? (
                  <Box position="relative">
                    <AvatarRing unseen={!!myEntry.hasUnviewed}>
                      <Avatar
                        size="lg"
                        src={user.profilePic}
                        name={user.name || user.username}
                        cursor="pointer"
                        onClick={() => openViewer(myId, user)}
                      />
                    </AvatarRing>
                    <Flex
                      position="absolute"
                      bottom={0}
                      right={0}
                      w={6}
                      h={6}
                      borderRadius="full"
                      bg="blue.500"
                      align="center"
                      justify="center"
                      borderWidth="2px"
                      borderColor={addBadgeBorder}
                      cursor="pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddOpen()
                      }}
                    >
                      <AddIcon color="white" boxSize={2.5} />
                    </Flex>
                  </Box>
                ) : (
                  <Box position="relative">
                    <Avatar size="lg" src={user.profilePic} name={user.name || user.username} cursor="pointer" onClick={onAddOpen} />
                    <Flex
                      position="absolute"
                      bottom={0}
                      right={0}
                      w={6}
                      h={6}
                      borderRadius="full"
                      bg="blue.500"
                      align="center"
                      justify="center"
                      borderWidth="2px"
                      borderColor={addBadgeBorder}
                      cursor="pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddOpen()
                      }}
                    >
                      <AddIcon color="white" boxSize={2.5} />
                    </Flex>
                  </Box>
                )}
              </Box>
              <Text fontSize="xs" color={labelColor} textAlign="center" noOfLines={2} w="100%">
                Your story
              </Text>
            </Flex>
          )}

          {!loading &&
            others.map((s) => {
              const u = s.user || {}
              const id = userIdOf(s)
              return (
                <Flex key={id || s.storyId} direction="column" align="center" gap={1} flexShrink={0} w="72px">
                  <AvatarRing unseen={!!s.hasUnviewed}>
                    <Avatar
                      size="lg"
                      src={u.profilePic}
                      name={u.name || u.username}
                      cursor="pointer"
                      onClick={() => openViewer(id, u)}
                    />
                  </AvatarRing>
                  <Text fontSize="xs" color={labelColor} textAlign="center" noOfLines={2} w="100%">
                    {u.username || u.name || 'User'}
                  </Text>
                </Flex>
              )
            })}
        </Flex>
      </Box>

      <AddStoryModal isOpen={addOpen} onClose={onAddClose} onPosted={fetchStrip} />
      <StoryViewerModal
        isOpen={viewerOpen}
        onClose={closeViewer}
        userId={viewerUserId}
        userPreview={viewerPreview}
      />
    </>
  )
}
