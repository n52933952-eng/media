/**
 * Share a live stream to people you follow (DM).
 * Custom portal overlay — Chakra Modal content was hidden behind its own overlay on the live page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Box, Flex, Avatar, Text, Input, Spinner, IconButton, useToast,
} from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import { buildLiveShareMessage } from '../utils/liveShareMessage';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SHARE_MODAL_Z = 10000;

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

  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

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

  if (!isOpen) return null;

  return createPortal(
    <Box
      position="fixed"
      inset={0}
      zIndex={SHARE_MODAL_Z}
      display="flex"
      alignItems="center"
      justifyContent="center"
      px={4}
    >
      <Box
        position="absolute"
        inset={0}
        bg="blackAlpha.700"
        onClick={onClose}
        aria-hidden
      />
      <Box
        position="relative"
        bg="white"
        color="gray.800"
        borderRadius="xl"
        w="100%"
        maxW="md"
        maxH="80vh"
        display="flex"
        flexDirection="column"
        boxShadow="2xl"
        overflow="hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Flex
          align="center"
          justify="space-between"
          px={5}
          py={4}
          borderBottom="1px solid"
          borderColor="gray.200"
          flexShrink={0}
        >
          <Text fontWeight="bold" fontSize="lg">Share live</Text>
          <IconButton
            icon={<CloseIcon boxSize={3} />}
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
          />
        </Flex>
        <Box px={5} py={4} overflowY="auto" flex={1}>
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
        </Box>
      </Box>
    </Box>,
    document.body,
  );
};

export default LiveShareModal;
