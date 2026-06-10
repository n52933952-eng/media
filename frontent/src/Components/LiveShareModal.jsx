/**
 * Share a live stream to people you follow (DM).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  Box, Flex, Avatar, Text, Input, Spinner, useToast,
} from '@chakra-ui/react';
import { buildLiveShareMessage } from '../utils/liveShareMessage';

const API_BASE = import.meta.env.VITE_API_URL || '';

const LiveShareModal = ({ isOpen, onClose, live }) => {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sendingToId, setSendingToId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = String(u?.name || '').toLowerCase();
      const username = String(u?.username || '').toLowerCase();
      return name.includes(q) || username.includes(q);
    });
  }, [users, searchQuery]);

  const fetchFollowing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/following`, { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.users || []);
      setUsers(list);
    } catch {
      setUsers([]);
      toast({ title: 'Could not load people you follow', status: 'error', duration: 3000, position: 'top' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      fetchFollowing();
    }
  }, [isOpen, fetchFollowing]);

  const sendToUser = async (followUser) => {
    if (!live?.streamerId || sendingToId) return;
    const recipientId = String(followUser?._id || '');
    if (!recipientId) return;

    setSendingToId(recipientId);
    try {
      const res = await fetch(`${API_BASE}/api/message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientId,
          message: buildLiveShareMessage(live),
        }),
      });
      if (!res.ok) throw new Error('send failed');
      const label = followUser?.name || followUser?.username || 'user';
      toast({ title: `Live shared with ${label}`, status: 'success', duration: 2500, position: 'top' });
      onClose();
    } catch {
      toast({ title: 'Could not send live', status: 'error', duration: 3000, position: 'top' });
    } finally {
      setSendingToId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      isCentered
      scrollBehavior="inside"
      blockScrollOnMount={false}
      portalProps={{ zIndex: 2000 }}
    >
      <ModalOverlay bg="blackAlpha.700" zIndex={2000} />
      <ModalContent maxH="80vh" zIndex={2001}>
        <ModalHeader>Share live</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <Input
            placeholder="Search…"
            mb={3}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {loading ? (
            <Flex justify="center" py={8}><Spinner /></Flex>
          ) : filteredUsers.length === 0 ? (
            <Text color="gray.500" textAlign="center" py={6}>No people found</Text>
          ) : (
            <Box maxH="50vh" overflowY="auto">
              {filteredUsers.map((item) => {
                const name = item?.name || item?.username || 'User';
                const busy = sendingToId === String(item?._id || '');
                return (
                  <Flex
                    key={String(item._id)}
                    align="center"
                    gap={3}
                    py={2}
                    px={1}
                    borderBottom="1px solid"
                    borderColor="gray.100"
                    cursor={busy ? 'wait' : 'pointer'}
                    onClick={() => !busy && sendToUser(item)}
                    _hover={{ bg: 'gray.50' }}
                    borderRadius="md"
                  >
                    <Avatar src={item?.profilePic} name={name} size="sm" />
                    <Box flex={1} minW={0}>
                      <Text fontWeight="600" fontSize="sm" noOfLines={1}>{name}</Text>
                      {item?.username && (
                        <Text fontSize="xs" color="gray.500" noOfLines={1}>@{item.username}</Text>
                      )}
                    </Box>
                    {busy ? <Spinner size="sm" /> : <Text fontSize="sm" color="blue.500" fontWeight="600">Send</Text>}
                  </Flex>
                );
              })}
            </Box>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default LiveShareModal;
