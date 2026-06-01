/**
 * Draggable host camera pip with +/- resize while screen sharing.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, HStack, IconButton } from '@chakra-ui/react';
import { AddIcon, MinusIcon, CloseIcon } from '@chakra-ui/icons';
import {
  PIP_SIZE_STEPS, PIP_DEFAULT_SIZE_INDEX, clampPipPosition,
} from '../utils/liveCameraPipLayout';

const HostCameraPipOverlay = ({
  track, visible = true, defaultTop = 72, zIndex = 1690, onClose,
}) => {
  const videoRef = useRef(null);
  const dragRef = useRef(null);
  const [sizeIndex, setSizeIndex] = useState(PIP_DEFAULT_SIZE_INDEX);
  const [pos, setPos] = useState({ x: null, y: defaultTop });

  const { w: pipW, h: pipH } = PIP_SIZE_STEPS[sizeIndex];
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const sizeRef = useRef({ pipW, pipH });
  sizeRef.current = { pipW, pipH };

  useEffect(() => {
    if (!visible || !track || !videoRef.current) return undefined;
    const el = videoRef.current;
    const attach = () => {
      try { track.attach(el); } catch (_) {}
    };
    attach();
    const raf = requestAnimationFrame(attach);
    const t = setTimeout(attach, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      try { track.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [visible, track]);

  useEffect(() => {
    if (!visible || !dragRef.current) return;
    setPos((prev) => {
      const rect = dragRef.current?.getBoundingClientRect();
      const x = prev.x ?? (rect ? rect.left : window.innerWidth - pipW - 12);
      const y = prev.y ?? defaultTop;
      return clampPipPosition(x, y, pipW, pipH, window.innerWidth, window.innerHeight, defaultTop);
    });
  }, [pipW, pipH, visible, defaultTop]);

  const onDragDown = useCallback((e) => {
    if (!dragRef.current || e.target.closest('[data-pip-ctrl]')) return;
    const rect = dragRef.current.getBoundingClientRect();
    const x = pos.x ?? rect.left;
    const y = pos.y ?? rect.top;
    dragState.current = {
      dragging: true,
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
    const { pipW: w, pipH: h } = sizeRef.current;
    setPos(clampPipPosition(
      dragState.current.originX + dx,
      dragState.current.originY + dy,
      w,
      h,
      window.innerWidth,
      window.innerHeight,
      defaultTop,
    ));
  }, [defaultTop]);

  const onDragUp = useCallback(() => {
    dragState.current.dragging = false;
  }, []);

  if (!visible || !track) return null;

  const boxStyle = {
    position: 'fixed',
    zIndex,
    width: `${pipW}px`,
    height: `${pipH}px`,
    cursor: 'grab',
    touchAction: 'none',
    ...(pos.x != null
      ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' }
      : { top: `${pos.y}px`, right: '12px' }),
  };

  return (
    <Box
      ref={dragRef}
      sx={boxStyle}
      borderRadius="lg"
      overflow="hidden"
      border="2px solid"
      borderColor="whiteAlpha.500"
      bg="black"
      onPointerDown={onDragDown}
      onPointerMove={onDragMove}
      onPointerUp={onDragUp}
      onPointerCancel={onDragUp}
    >
      {onClose ? (
        <IconButton
          data-pip-ctrl
          aria-label="Hide camera preview"
          icon={<CloseIcon boxSize={2.5} />}
          size="xs"
          minW="24px"
          h="24px"
          borderRadius="full"
          position="absolute"
          top="4px"
          left="4px"
          zIndex={2}
          bg="blackAlpha.700"
          color="white"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        />
      ) : null}
      <Box
        as="video"
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
      />
      <HStack
        data-pip-ctrl
        position="absolute"
        bottom="4px"
        right="4px"
        spacing={1}
        pointerEvents="auto"
      >
        <IconButton
          data-pip-ctrl
          aria-label="Smaller camera"
          icon={<MinusIcon />}
          size="xs"
          minW="26px"
          h="26px"
          borderRadius="full"
          bg="blackAlpha.700"
          color="white"
          isDisabled={sizeIndex === 0}
          onClick={(e) => { e.stopPropagation(); setSizeIndex((i) => Math.max(0, i - 1)); }}
        />
        <IconButton
          data-pip-ctrl
          aria-label="Larger camera"
          icon={<AddIcon />}
          size="xs"
          minW="26px"
          h="26px"
          borderRadius="full"
          bg="blackAlpha.700"
          color="white"
          isDisabled={sizeIndex === PIP_SIZE_STEPS.length - 1}
          onClick={(e) => { e.stopPropagation(); setSizeIndex((i) => Math.min(PIP_SIZE_STEPS.length - 1, i + 1)); }}
        />
      </HStack>
    </Box>
  );
};

export default HostCameraPipOverlay;
