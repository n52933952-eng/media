/**
 * Host camera pip while live + sharing on home / chess (not on /live/broadcast).
 * Drag to reposition.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Box } from '@chakra-ui/react';
import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';

const PIP_W = 120;
const PIP_H = 90;

const LiveCameraPip = () => {
  const location = useLocation();
  const { isLive, isSharing, localTrack } = useLiveBroadcast();
  const videoRef = useRef(null);
  const dragRef = useRef(null);

  const onLivePage = location.pathname === '/live/broadcast';
  const visible = isLive && isSharing && localTrack && !onLivePage;

  const [pos, setPos] = useState({ x: null, y: 72 });
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  useEffect(() => {
    if (!visible || !localTrack || !videoRef.current) return undefined;
    const el = videoRef.current;
    const attach = () => {
      try { localTrack.attach(el); } catch (_) {}
    };
    attach();
    const raf = requestAnimationFrame(attach);
    const t = setTimeout(attach, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      try { localTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [visible, localTrack]);

  const onPointerDown = useCallback((e) => {
    if (!dragRef.current) return;
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

  const onPointerMove = useCallback((e) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const maxX = window.innerWidth - PIP_W - 8;
    const maxY = window.innerHeight - PIP_H - 8;
    setPos({
      x: Math.min(maxX, Math.max(8, dragState.current.originX + dx)),
      y: Math.min(maxY, Math.max(72, dragState.current.originY + dy)),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current.dragging = false;
  }, []);

  if (!visible) return null;

  const style = {
    position: 'fixed',
    zIndex: 1690,
    width: `${PIP_W}px`,
    height: `${PIP_H}px`,
    cursor: 'grab',
    touchAction: 'none',
    ...(pos.x != null
      ? { left: pos.x, top: pos.y, right: 'auto' }
      : { top: `${pos.y}px`, right: '12px' }),
  };

  return (
    <Box
      ref={dragRef}
      sx={style}
      borderRadius="lg"
      overflow="hidden"
      border="2px solid"
      borderColor="whiteAlpha.500"
      bg="black"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Box as="video" ref={videoRef} autoPlay muted playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
      />
    </Box>
  );
};

export default LiveCameraPip;
