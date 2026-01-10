import React, { useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  VStack,
  HStack,
  Avatar,
  Text,
  Button,
  Box,
  useColorModeValue,
  IconButton,
  Tooltip,
  Badge,
  Divider
} from '@chakra-ui/react'
import { MdPersonRemove } from "react-icons/md"
import { FaCrown } from "react-icons/fa"
import useShowToast from '../hooks/useShowToast'

const ManageContributorsModal = ({ isOpen, onClose, post, onContributorRemoved }) => {
  const [removing, setRemoving] = useState(null)
  const showToast = useShowToast()

  const bgColor = useColorModeValue('white', '#252b3b')
  const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
  const textColor = useColorModeValue('gray.800', 'white')
  const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
  const hoverBg = useColorModeValue('gray.50', '#2d3548')

  const postOwnerId = post?.postedBy?._id?.toString()
  const contributors = post?.contributors || []

  const handleRemoveContributor = async (contributorId, contributorName) => {
    if (!window.confirm(`Remove ${contributorName} from this collaborative post?`)) {
      return
    }

    setRemoving(contributorId)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/collaborative/${post._id}/contributor/${contributorId}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      )
      const data = await res.json()

      if (res.ok) {
        showToast('Success', `Removed ${contributorName}`, 'success')
        
        // Fetch the updated post with populated contributors
        try {
          const postRes = await fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/getPost/${post._id}`,
            { credentials: 'include' }
          )
          const postData = await postRes.json()
          
          if (postRes.ok && postData.post) {
            // Call callback with updated post data
            onContributorRemoved?.(postData.post)
          } else {
            // Still call callback even if fetch fails
            onContributorRemoved?.()
          }
        } catch (error) {
          console.error('Error fetching updated post:', error)
          // Still call callback even if fetch fails
          onContributorRemoved?.()
        }
        
        onClose()
      } else {
        showToast('Error', data.message || 'Failed to remove contributor', 'error')
      }
    } catch (error) {
      console.error('Error removing contributor:', error)
      showToast('Error', 'Failed to remove contributor', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalOverlay />
      <ModalContent bg={bgColor}>
        <ModalHeader>Manage Contributors</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <VStack spacing={4} align="stretch">
            {/* Post Owner */}
            {post?.postedBy && (
              <Box>
                <Text fontSize="sm" fontWeight="bold" mb={2} color={secondaryTextColor}>
                  Post Owner
                </Text>
                <HStack
                  p={3}
                  bg={hoverBg}
                  borderRadius="md"
                  justify="space-between"
                >
                  <HStack>
                    <Avatar
                      src={post.postedBy.profilePic}
                      name={post.postedBy.name || post.postedBy.username}
                      size="md"
                    />
                    <VStack align="start" spacing={0}>
                      <HStack>
                        <Text fontSize="sm" fontWeight="bold">
                          {post.postedBy.name}
                        </Text>
                        <Badge colorScheme="yellow" fontSize="xs">
                          <HStack spacing={1}>
                            <FaCrown size={10} />
                            <Text>Owner</Text>
                          </HStack>
                        </Badge>
                      </HStack>
                      <Text fontSize="xs" color={secondaryTextColor}>
                        @{post.postedBy.username}
                      </Text>
                    </VStack>
                  </HStack>
                </HStack>
              </Box>
            )}

            {/* Contributors */}
            {contributors.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="bold" mb={2} color={secondaryTextColor}>
                  Contributors ({contributors.filter(c => (c._id || c).toString() !== postOwnerId).length})
                </Text>
                <VStack spacing={2} align="stretch" maxH="400px" overflowY="auto">
                  {contributors
                    .filter(c => (c._id || c).toString() !== postOwnerId)
                    .map((contributor) => {
                      const contributorId = (contributor._id || contributor).toString()
                      const contributorName = contributor?.name || contributor?.username || 'Unknown'
                      
                      return (
                        <HStack
                          key={contributorId}
                          p={3}
                          bg={hoverBg}
                          borderRadius="md"
                          justify="space-between"
                        >
                          <HStack>
                            <Avatar
                              src={contributor?.profilePic}
                              name={contributorName}
                              size="md"
                            />
                            <VStack align="start" spacing={0}>
                              <Text fontSize="sm" fontWeight="bold">
                                {contributorName}
                              </Text>
                              <Text fontSize="xs" color={secondaryTextColor}>
                                @{contributor?.username || 'unknown'}
                              </Text>
                            </VStack>
                          </HStack>
                          <Tooltip label={`Remove ${contributorName}`}>
                            <IconButton
                              icon={<MdPersonRemove />}
                              size="sm"
                              colorScheme="red"
                              variant="ghost"
                              isLoading={removing === contributorId}
                              onClick={() => handleRemoveContributor(contributorId, contributorName)}
                              aria-label={`Remove ${contributorName}`}
                            />
                          </Tooltip>
                        </HStack>
                      )
                    })}
                </VStack>
              </Box>
            )}

            {contributors.filter(c => (c._id || c).toString() !== postOwnerId).length === 0 && (
              <Text fontSize="sm" color={secondaryTextColor} textAlign="center" py={4}>
                No contributors yet. Add some to start collaborating!
              </Text>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default ManageContributorsModal


