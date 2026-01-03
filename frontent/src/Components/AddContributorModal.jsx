import React, { useState, useEffect, useContext } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Input,
  VStack,
  HStack,
  Avatar,
  Text,
  Button,
  Box,
  useColorModeValue,
  Spinner,
  Badge,
  Flex
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const AddContributorModal = ({ isOpen, onClose, post, onContributorAdded }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState([])
  const { user } = useContext(UserContext)
  const showToast = useShowToast()

  const bgColor = useColorModeValue('white', '#252b3b')
  const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
  const textColor = useColorModeValue('gray.800', 'white')
  const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
  const hoverBg = useColorModeValue('gray.50', '#2d3548')

  // Get existing contributor IDs
  const existingContributorIds = post?.contributors?.map(c => (c._id || c).toString()) || []
  const postOwnerId = post?.postedBy?._id?.toString()

  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      const timeoutId = setTimeout(() => {
        searchUsers(searchQuery)
      }, 300) // Debounce search

      return () => clearTimeout(timeoutId)
    } else {
      setSearchResults([])
    }
  }, [searchQuery])

  const searchUsers = async (query) => {
    setIsSearching(true)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/search?search=${encodeURIComponent(query)}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      
      if (res.ok && Array.isArray(data)) {
        // Filter out:
        // - Current user
        // - Post owner (already a contributor)
        // - Already existing contributors
        const filtered = data.filter(u => {
          const userId = u._id?.toString()
          return userId !== user?._id?.toString() &&
                 userId !== postOwnerId &&
                 !existingContributorIds.includes(userId)
        })
        setSearchResults(filtered)
      } else {
        setSearchResults([])
      }
    } catch (error) {
      console.error('Error searching users:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectUser = (selectedUser) => {
    if (!selectedUsers.some(u => u._id === selectedUser._id)) {
      setSelectedUsers([...selectedUsers, selectedUser])
      setSearchQuery('')
      setSearchResults([])
    }
  }

  const handleRemoveSelected = (userId) => {
    setSelectedUsers(selectedUsers.filter(u => u._id !== userId))
  }

  const handleAddContributors = async () => {
    if (selectedUsers.length === 0) {
      showToast('Error', 'Please select at least one user', 'error')
      return
    }

    try {
      const results = await Promise.all(
        selectedUsers.map(async (selectedUser) => {
          const res = await fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/collaborative/${post._id}/contributor`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ contributorId: selectedUser._id })
            }
          )
          const data = await res.json()
          return { res, data, username: selectedUser.username }
        })
      )

      const successful = results.filter(r => r.res.ok)
      const failed = results.filter(r => !r.res.ok)

      if (successful.length > 0) {
        showToast(
          'Success',
          `Added ${successful.length} contributor${successful.length > 1 ? 's' : ''}`,
          'success'
        )
        onContributorAdded?.()
        onClose()
        setSelectedUsers([])
        setSearchQuery('')
      }

      if (failed.length > 0) {
        failed.forEach(({ data, username }) => {
          showToast('Error', `${username}: ${data.message || 'Failed to add'}`, 'error')
        })
      }
    } catch (error) {
      console.error('Error adding contributors:', error)
      showToast('Error', 'Failed to add contributors', 'error')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalOverlay />
      <ModalContent bg={bgColor}>
        <ModalHeader>Add Contributors</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <VStack spacing={4} align="stretch">
            {/* Search Input */}
            <Box>
              <Input
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {isSearching && (
                <Flex justify="center" mt={2}>
                  <Spinner size="sm" />
                </Flex>
              )}
            </Box>

            {/* Selected Users */}
            {selectedUsers.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="bold" mb={2}>
                  Selected ({selectedUsers.length}):
                </Text>
                <VStack spacing={2} align="stretch">
                  {selectedUsers.map((selectedUser) => (
                    <HStack
                      key={selectedUser._id}
                      p={2}
                      bg={hoverBg}
                      borderRadius="md"
                      justify="space-between"
                    >
                      <HStack>
                        <Avatar
                          src={selectedUser.profilePic}
                          name={selectedUser.name || selectedUser.username}
                          size="sm"
                        />
                        <VStack align="start" spacing={0}>
                          <Text fontSize="sm" fontWeight="bold">
                            {selectedUser.name}
                          </Text>
                          <Text fontSize="xs" color={secondaryTextColor}>
                            @{selectedUser.username}
                          </Text>
                        </VStack>
                      </HStack>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        onClick={() => handleRemoveSelected(selectedUser._id)}
                      >
                        Remove
                      </Button>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="bold" mb={2}>
                  Search Results:
                </Text>
                <VStack spacing={2} align="stretch" maxH="300px" overflowY="auto">
                  {searchResults.map((result) => (
                    <HStack
                      key={result._id}
                      p={3}
                      bg={hoverBg}
                      borderRadius="md"
                      cursor="pointer"
                      _hover={{ bg: useColorModeValue('gray.100', '#3d4558') }}
                      onClick={() => handleSelectUser(result)}
                      justify="space-between"
                    >
                      <HStack>
                        <Avatar
                          src={result.profilePic}
                          name={result.name || result.username}
                          size="md"
                        />
                        <VStack align="start" spacing={0}>
                          <Text fontSize="sm" fontWeight="bold">
                            {result.name}
                          </Text>
                          <Text fontSize="xs" color={secondaryTextColor}>
                            @{result.username}
                          </Text>
                          {result.bio && (
                            <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                              {result.bio}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                      <Button size="sm" colorScheme="blue" variant="outline">
                        Add
                      </Button>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
              <Text fontSize="sm" color={secondaryTextColor} textAlign="center" py={4}>
                No users found
              </Text>
            )}

            {/* Action Buttons */}
            <HStack justify="flex-end" pt={4}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorScheme="blue"
                onClick={handleAddContributors}
                isDisabled={selectedUsers.length === 0}
              >
                Add {selectedUsers.length > 0 ? `${selectedUsers.length} ` : ''}Contributor{selectedUsers.length !== 1 ? 's' : ''}
              </Button>
            </HStack>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default AddContributorModal
