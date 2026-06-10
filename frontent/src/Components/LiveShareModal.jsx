/**
 * Share a live stream to people you follow (DM).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Box, Flex, Avatar, Text, Input, Spinner, useToast,
} from '@chakra-ui/react';
import { buildLiveShareMessage } from '../utils/liveShareMessage';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SHARE_MODAL_Z = 10000;

const LiveShareModal = ({ isOpen, onClose, live }) => {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sendingToId, setSendingToId] = useState(null);
  const [sentToIds, setSentToIds] = useState(() => new Set());
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
      setSentToIds(new Set());
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
    if (!recipientId || sentToIds.has(recipientId)) return;

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
      setSentToIds((prev) => new Set(prev).add(recipientId));
      toast({ title: `Live shared with ${label}`, status: 'success', duration: 2000, position: 'top' });
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
        borderRadius="2xl"
        w="100%"
        maxW="340px"
        maxH="72vh"
        display="flex"
        flexDirection="column"
        boxShadow="2xl"
        overflow="hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Flex
          align="center"
          justify="space-between"
          px={4}
          py={3}
          borderBottom="1px solid"
          borderColor="gray.200"
          flexShrink={0}
          bg="gray.50"
        >
          <Text fontWeight="bold" fontSize="md">Share live</Text>
          <Box
            as="button"
            type="button"
            aria-label="Close"
            onClick={onClose}
            w="32px"
            h="32px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="full"
            bg="gray.200"
            color="gray.700"
            fontSize="18px"
            fontWeight="bold"
            lineHeight={1}
            flexShrink={0}
            _hover={{ bg: 'gray.300' }}
          >
            ×
          </Box>
        </Flex>
        <Box px={4} py={3} overflowY="auto" flex={1}>
          <Input
            placeholder="Search…"
            mb={3}
            size="sm"
            borderRadius="full"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {loading ? (
            <Flex justify="center" py={8}><Spinner size="sm" /></Flex>
          ) : filteredUsers.length === 0 ? (
            <Text color="gray.500" textAlign="center" py={6} fontSize="sm">No people found</Text>
          ) : (
            <Box maxH="48vh" overflowY="auto">
              {filteredUsers.map((item) => {
                const name = item?.name || item?.username || 'User';
                const uid = String(item?._id || '');
                const busy = sendingToId === uid;
                const sent = sentToIds.has(uid);
                return (
                  <Flex
                    key={uid}
                    align="center"
                    gap={2.5}
                    py={2}
                    px={1}
                    borderBottom="1px solid"
                    borderColor="gray.100"
                    cursor={busy || sent ? 'default' : 'pointer'}
                    onClick={() => !busy && !sent && sendToUser(item)}
                    _hover={sent ? {} : { bg: 'gray.50' }}
                    borderRadius="md"
                  >
                    <Avatar src={item?.profilePic} name={name} size="sm" flexShrink={0} />
                    <Box flex={1} minW={0}>
                      <Text fontWeight="600" fontSize="sm" noOfLines={1}>{name}</Text>
                      {item?.username && (
                        <Text fontSize="xs" color="gray.500" noOfLines={1}>@{item.username}</Text>
                      )}
                    </Box>
                    {busy ? (
                      <Spinner size="sm" flexShrink={0} />
                    ) : sent ? (
                      <Text fontSize="xs" color="green.600" fontWeight="700" flexShrink={0}>Sent ✓</Text>
                    ) : (
                      <Text fontSize="xs" color="blue.500" fontWeight="700" flexShrink={0}>Send</Text>
                    )}
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
