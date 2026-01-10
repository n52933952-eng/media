import React, { useState, useEffect, useContext } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
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
  const [followingUsers, setFollowingUsers] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState([])
  const [isAdding, setIsAdding] = useState(false) // Loading state for Add button
  const { user } = useContext(UserContext)
  const showToast = useShowToast()

  const bgColor = useColorModeValue('white', '#252b3b')
  const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
  const textColor = useColorModeValue('gray.800', 'white')
  const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
  const hoverBg = useColorModeValue('gray.50', '#2d3548')

  // Get existing contributor IDs - always use the latest from post prop
  const existingContributorIds = post?.contributors?.map(c => (c._id || c).toString()) || []
  const postOwnerId = post?.postedBy?._id?.toString()

  // Load following users when modal opens and reset when closes
  useEffect(() => {
    if (isOpen && user?._id) {
      // Fetch fresh following users list
      fetchFollowingUsers()
      console.log('🔵 [AddContributorModal] Modal opened, existing contributors:', existingContributorIds)
    } else {
      // Reset ALL states when modal closes
      setFollowingUsers([])
      setSearchQuery('')
      setSearchResults([])
      setSelectedUsers([]) // Clear selected users
      setIsAdding(false)
    }
  }, [isOpen, user?._id, post?._id]) // Also depend on post._id to refresh when post changes

  useEffect(() => {
    const query = searchQuery.trim()
    
    if (query.length >= 1) {
      // Get fresh contributor list
      const currentContributorIds = post?.contributors?.map(c => (c._id || c).toString()) || []
      
      // First, filter following users by search query (instant, no API call)
      const filteredFollowing = followingUsers.filter(u => {
        const userId = u._id?.toString()
        const nameMatch = u.name?.toLowerCase().includes(query.toLowerCase())
        const usernameMatch = u.username?.toLowerCase().includes(query.toLowerCase())
        const isAlreadySelected = selectedUsers.some(su => su._id === userId)
        const isAlreadyContributor = currentContributorIds.includes(userId)
        
        return (nameMatch || usernameMatch) && !isAlreadySelected && !isAlreadyContributor
      })
      
      // If we have filtered results from following, show them immediately
      if (filteredFollowing.length > 0 && query.length < 2) {
        setSearchResults(filteredFollowing)
        return
      }
      
      // For 2+ characters, also search globally via API
      if (query.length >= 2) {
        const timeoutId = setTimeout(() => {
          searchUsers(query)
        }, 300) // Debounce search

        return () => clearTimeout(timeoutId)
      } else {
        // 1 character: show filtered following users
        setSearchResults(filteredFollowing)
      }
    } else {
      setSearchResults([])
    }
  }, [searchQuery, followingUsers, selectedUsers, post?.contributors])

  // System accounts to exclude from contributor selection
  const systemAccounts = ['Weather', 'Football', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 
                          'SkyNews', 'Cartoonito', 'NatGeoKids', 'SciShowKids', 
                          'JJAnimalTime', 'KidsArabic', 'NatGeoAnimals', 'MBCDrama', 'Fox11']

  const fetchFollowingUsers = async () => {
    setIsLoadingFollowing(true)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/following`,
        { credentials: 'include' }
      )
      const data = await res.json()
      
      if (res.ok && Array.isArray(data)) {
        // Filter out:
        // - Current user
        // - Post owner (already a contributor)
        // - Already existing contributors
        // - System accounts (Weather, Football, channels)
        const filtered = data.filter(u => {
          const userId = u._id?.toString()
          const isSystemAccount = systemAccounts.includes(u.username)
          return userId !== user?._id?.toString() &&
                 userId !== postOwnerId &&
                 !existingContributorIds.includes(userId) &&
                 !isSystemAccount
        })
        setFollowingUsers(filtered)
      } else {
        setFollowingUsers([])
      }
    } catch (error) {
      console.error('Error fetching following users:', error)
      setFollowingUsers([])
    } finally {
      setIsLoadingFollowing(false)
    }
  }

  const searchUsers = async (query) => {
    setIsSearching(true)
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/search?search=${encodeURIComponent(query)}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      
      if (res.ok && Array.isArray(data)) {
        // Get fresh contributor list from post
        const currentContributorIds = post?.contributors?.map(c => (c._id || c).toString()) || []
        
        // Filter out:
        // - Current user
        // - Post owner (already a contributor)
        // - Already existing contributors (use fresh list)
        // - Already selected users
        // - System accounts (Weather, Football, channels)
        const filtered = data.filter(u => {
          const userId = u._id?.toString()
          const isSystemAccount = systemAccounts.includes(u.username)
          const isAlreadySelected = selectedUsers.some(su => su._id === userId)
          
          return userId !== user?._id?.toString() &&
                 userId !== postOwnerId &&
                 !currentContributorIds.includes(userId) &&
                 !isAlreadySelected &&
                 !isSystemAccount
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

    setIsAdding(true) // Start loading
    
    try {
      console.log('🔵 [AddContributorModal] Adding contributors:', selectedUsers.map(u => u.username))
      
      const results = await Promise.all(
        selectedUsers.map(async (selectedUser) => {
          try {
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
            console.log(`🔵 [AddContributorModal] Response for ${selectedUser.username}:`, { ok: res.ok, status: res.status, data })
            return { res, data, username: selectedUser.username, success: res.ok }
          } catch (error) {
            console.error(`❌ [AddContributorModal] Error adding ${selectedUser.username}:`, error)
            return { res: null, data: { message: error.message }, username: selectedUser.username, success: false }
          }
        })
      )

      const successful = results.filter(r => r.success)
      const failed = results.filter(r => !r.success)

      console.log('🔵 [AddContributorModal] Results:', { successful: successful.length, failed: failed.length })

      // Always fetch updated post if at least one succeeded
      if (successful.length > 0) {
        try {
          console.log('🔵 [AddContributorModal] Fetching updated post...')
          const postRes = await fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/getPost/${post._id}`,
            { credentials: 'include' }
          )
          const postData = await postRes.json()
          
          console.log('🔵 [AddContributorModal] Updated post data:', postData)
          
          if (postRes.ok && postData.post) {
            // Show success toast BEFORE closing modal
            showToast(
              'Success',
              `Added ${successful.length} contributor${successful.length > 1 ? 's' : ''}`,
              'success'
            )
            
            // Call callback with updated post data
            if (onContributorAdded) {
              console.log('✅ [AddContributorModal] Calling onContributorAdded with updated post')
              onContributorAdded(postData.post)
            }
            
            // Close modal and reset
            onClose()
            setSelectedUsers([])
            setSearchQuery('')
          } else {
            throw new Error('Failed to fetch updated post')
          }
        } catch (error) {
          console.error('❌ [AddContributorModal] Error fetching updated post:', error)
          // Show success for adding but couldn't refresh
          showToast('Success', 'Contributors added. Please refresh to see updates.', 'success')
          onClose()
          setSelectedUsers([])
          setSearchQuery('')
        }
      }

      // Only show failed errors if there were actually failures
      if (failed.length > 0) {
        console.log('❌ [AddContributorModal] Failed additions:', failed)
        failed.forEach(({ data, username }) => {
          const errorMsg = data?.message || data?.error || 'Failed to add'
          console.error(`❌ Failed to add ${username}:`, errorMsg)
          showToast('Error', `${username}: ${errorMsg}`, 'error')
        })
      }
      
      // If all failed, close modal anyway
      if (successful.length === 0 && failed.length > 0) {
        onClose()
        setSelectedUsers([])
        setSearchQuery('')
      }
    } catch (error) {
      console.error('❌ [AddContributorModal] Fatal error adding contributors:', error)
      showToast('Error', 'Failed to add contributors', 'error')
    } finally {
      setIsAdding(false) // Stop loading
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
      <ModalOverlay />
      <ModalContent bg={bgColor} maxH="90vh" display="flex" flexDirection="column">
        <ModalHeader>Add Contributors</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6} overflowY="auto" flex="1">
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

            {/* Following Users - Show only when no search query */}
            {!searchQuery && followingUsers.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="bold" mb={2}>
                  People You Follow:
                </Text>
                {isLoadingFollowing ? (
                  <Flex justify="center" py={4}>
                    <Spinner size="sm" />
                  </Flex>
                ) : (
                  <VStack spacing={2} align="stretch" maxH="200px" overflowY="auto">
                    {followingUsers.map((followingUser) => (
                      <HStack
                        key={followingUser._id}
                        p={3}
                        bg={hoverBg}
                        borderRadius="md"
                        cursor="pointer"
                        _hover={{ bg: useColorModeValue('gray.100', '#3d4558') }}
                        onClick={() => handleSelectUser(followingUser)}
                        justify="space-between"
                      >
                        <HStack>
                          <Avatar
                            src={followingUser.profilePic}
                            name={followingUser.name || followingUser.username}
                            size="md"
                          />
                          <VStack align="start" spacing={0}>
                            <Text fontSize="sm" fontWeight="bold">
                              {followingUser.name}
                            </Text>
                            <Text fontSize="xs" color={secondaryTextColor}>
                              @{followingUser.username}
                            </Text>
                            {followingUser.bio && (
                              <Text fontSize="xs" color={secondaryTextColor} noOfLines={1}>
                                {followingUser.bio}
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
                )}
              </Box>
            )}

            {/* Search Results - Show when searching (1+ characters) */}
            {searchQuery && searchQuery.trim().length >= 1 && searchResults.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight="bold" mb={2}>
                  Search Results:
                </Text>
                <VStack spacing={2} align="stretch" maxH="200px" overflowY="auto">
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

            {searchQuery && searchQuery.trim().length >= 1 && searchResults.length === 0 && !isSearching && (
              <Text fontSize="sm" color={secondaryTextColor} textAlign="center" py={4}>
                {searchQuery.trim().length === 1 
                  ? 'No matching users found. Type more characters to search globally.'
                  : 'No users found'}
              </Text>
            )}

            {!searchQuery && !isLoadingFollowing && followingUsers.length === 0 && (
              <Text fontSize="sm" color={secondaryTextColor} textAlign="center" py={4}>
                You're not following anyone yet. Search for users to add as contributors.
              </Text>
            )}

          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack justify="flex-end" w="full">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleAddContributors}
              isDisabled={selectedUsers.length === 0}
              isLoading={isAdding}
              loadingText="Adding..."
            >
              Add {selectedUsers.length > 0 ? `${selectedUsers.length} ` : ''}Contributor{selectedUsers.length !== 1 ? 's' : ''}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default AddContributorModal


