/**
 * Floating bar while the host is live but left the broadcast page (home / chess / card / race).
 * Draggable so it does not cover game controls (e.g. Resign).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Flex, Text, Button, IconButton, keyframes } from '@chakra-ui/react';
import { ChatIcon } from '@chakra-ui/icons';
import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import LiveViewerChatModal from './LiveViewerChatModal';
import { liveBroadcastNav } from '../services/liveBroadcastNav';
import {
  clampMiniBarPosition,
  loadSavedMiniBarPos,
  saveMiniBarPos,
} from '../utils/liveMiniBarLayout';

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50% { transform: scale(1.55); opacity: 0; }
`;

const DRAG_THRESHOLD = 6;
const GAME_PATH_RE = /^\/(chess|card|race)\//;

const LiveStreamMiniBar = () => {
  const location = useLocation();
  const {
    isLive, isMinimized, isSharing, viewerCount, hostPipVisible,
    returnToLiveControls, endLive, showHostPip,
    liveChatMessages,
  } = useLiveBroadcast();

  const [chatOpen, setChatOpen] = useState(false);
  const [seenChatCount, setSeenChatCount] = useState(0);
  const unreadChat = Math.max(0, liveChatMessages.length - seenChatCount);
  const suppressTapReturnRef = useRef(false);

  useEffect(() => {
    if (chatOpen) setSeenChatCount(liveChatMessages.length);
  }, [chatOpen, liveChatMessages.length]);

  useEffect(() => {
    if (!isLive) {
      setChatOpen(false);
      setSeenChatCount(0);
    }
  }, [isLive]);

  const openChat = useCallback((e) => {
    e?.stopPropagation?.();
    suppressTapReturnRef.current = true;
    setChatOpen(true);
    window.setTimeout(() => { suppressTapReturnRef.current = false; }, 400);
  }, []);

  const closeChat = useCallback(() => {
    suppressTapReturnRef.current = true;
    setChatOpen(false);
    window.setTimeout(() => { suppressTapReturnRef.current = false; }, 400);
  }, []);

  const onLivePage = location.pathname === '/live/broadcast';
  const isGamePage = GAME_PATH_RE.test(location.pathname);

  const barRef = useRef(null);
  const [barSize, setBarSize] = useState({ w: 360, h: 52 });
  const [pos, setPos] = useState(() => loadSavedMiniBarPos());

  const dragState = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  useEffect(() => {
    if (!barRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r?.width && r?.height) setBarSize({ w: r.width, h: r.height });
    });
    ro.observe(barRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!barRef.current || pos) return;
    const defaultTop = isGamePage ? 72 : null;
    if (defaultTop == null) return;
    const w = barRef.current.offsetWidth || barSize.w;
    const h = barRef.current.offsetHeight || barSize.h;
    setPos(clampMiniBarPosition(12, defaultTop, w, h, window.innerWidth, window.innerHeight, 56));
  }, [isGamePage, pos, barSize.w, barSize.h]);

  useEffect(() => {
    if (pos) saveMiniBarPos(pos);
  }, [pos]);

  const onLivePageVisible = isLive && isMinimized && !onLivePage;

  const onReturn = useCallback(() => {
    returnToLiveControls();
    liveBroadcastNav.returnToLive?.();
  }, [returnToLiveControls]);

  const onDragDown = useCallback((e) => {
    if (e.target.closest('[data-live-bar-ctrl]')) return;
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = pos?.x ?? rect.left;
    const y = pos?.y ?? rect.top;
    dragState.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: x,
      originY: y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [pos]);

  const onDragMove = useCallback((e) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      dragState.current.moved = true;
    }
    const { w, h } = barSize;
    setPos(clampMiniBarPosition(
      dragState.current.originX + dx,
      dragState.current.originY + dy,
      w,
      h,
      window.innerWidth,
      window.innerHeight,
      56,
    ));
  }, [barSize]);

  const onDragUp = useCallback((e) => {
    const wasDrag = dragState.current.moved;
    dragState.current.dragging = false;
    dragState.current.moved = false;
    if (suppressTapReturnRef.current || chatOpen) return;
    if (!wasDrag && !e.target.closest('[data-live-bar-ctrl]')) {
      onReturn();
    }
  }, [onReturn, chatOpen]);

  const anchoredBottom = pos == null;

  if (!onLivePageVisible) return null;

  if (chatOpen) {
    return <LiveViewerChatModal isOpen onClose={closeChat} />;
  }

  return (
    <Flex
      ref={barRef}
      position="fixed"
      zIndex={1700}
      gap={2}
      align="stretch"
      pointerEvents="auto"
      w={{ base: 'calc(100% - 20px)', sm: 'auto' }}
      maxW="520px"
      sx={anchoredBottom
        ? {
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: { base: '18px', md: '22px' },
        }
        : {
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          right: 'auto',
          bottom: 'auto',
          transform: 'none',
        }}
    >
      <Flex
        flex={1}
        align="center"
        gap={3}
        px={4}
        py={3}
        bg="red.600"
        borderRadius="2xl"
        border="1px solid"
        borderColor="whiteAlpha.300"
        boxShadow="0 8px 28px rgba(0,0,0,0.45)"
        _hover={{ bg: 'red.500' }}
        minH="52px"
        userSelect="none"
        cursor={anchoredBottom ? 'default' : 'grab'}
        touchAction="none"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
      >
        <Box position="relative" w="10px" h="10px" flexShrink={0} mt={1} alignSelf="flex-start">
          <Box w="10px" h="10px" borderRadius="full" bg="white" />
          <Box
            position="absolute"
            inset={0}
            borderRadius="full"
            bg="white"
            css={{ animation: `${pulse} 1.4s ease-out infinite` }}
          />
        </Box>
        <Box flex={1} minW={0}>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text color="white" fontWeight="800" fontSize="sm">🔴 LIVE</Text>
            {isSharing ? (
              <Text fontSize="xs" color="white" bg="whiteAlpha.200" px={2} py={0.5} borderRadius="full">
                🖥 sharing
              </Text>
            ) : null}
            {isSharing && !hostPipVisible ? (
              <Text
                as="button"
                type="button"
                data-live-bar-ctrl
                fontSize="xs"
                color="white"
                bg="whiteAlpha.200"
                px={2}
                py={0.5}
                borderRadius="full"
                cursor="pointer"
                onClick={(e) => { e.stopPropagation(); showHostPip(); }}
              >
                📷 camera
              </Text>
            ) : null}
            <Text color="whiteAlpha.900" fontSize="xs">👁 {viewerCount}</Text>
          </Flex>
          <Text color="whiteAlpha.800" fontSize="xs" fontWeight="600" mt={0.5}>
            Drag to move · tap to return
          </Text>
        </Box>
      </Flex>
      <Box position="relative" flexShrink={0} data-live-bar-ctrl>
        <IconButton
          aria-label="Live chat"
          icon={<ChatIcon />}
          colorScheme="red"
          variant="solid"
          borderRadius="2xl"
          minH="52px"
          minW="52px"
          onClick={openChat}
        />
        {unreadChat > 0 ? (
          <Box
            position="absolute"
            top="-4px"
            right="-4px"
            minW="18px"
            h="18px"
            px={1}
            borderRadius="full"
            bg="white"
            color="red.600"
            fontSize="10px"
            fontWeight="bold"
            display="flex"
            alignItems="center"
            justifyContent="center"
            pointerEvents="none"
          >
            {unreadChat > 9 ? '9+' : unreadChat}
          </Box>
        ) : null}
      </Box>
      <Button
        data-live-bar-ctrl
        colorScheme="red"
        variant="solid"
        borderRadius="2xl"
        minH="52px"
        px={6}
        onClick={(e) => { e.stopPropagation(); void endLive(); }}
        flexShrink={0}
      >
        End
      </Button>
    </Flex>
  );
};

export default LiveStreamMiniBar;
