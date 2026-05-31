/**
 * Screen share stage with zoom, pan (when zoomed), and fullscreen.
 * Portrait mobile shares scale to fill available height (fixes tiny phone share on desktop).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Flex, Text, IconButton, HStack, Badge } from '@chakra-ui/react';

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const ScreenShareViewer = ({ track, name, flex = 1, minH = '0' }) => {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [portrait, setPortrait] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!track || !videoRef.current) return;
    const el = videoRef.current;
    try { track.attach(el); } catch (_) {}
    return () => {
      try { track.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [track]);

  useEffect(() => {
    if (!track) return;
    const syncDims = () => {
      const d = track.dimensions;
      setPortrait(Boolean(d?.height && d?.width && d.height > d.width));
    };
    syncDims();
    track.on?.('dimensionsChanged', syncDims);
    return () => { track.off?.('dimensionsChanged', syncDims); };
  }, [track]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((z) => clamp(Number((z + ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const next = clamp(Number((z - ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (_) {}
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => {
      const next = clamp(Number((z + delta).toFixed(2)), ZOOM_MIN, ZOOM_MAX);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const onPointerDown = useCallback((e) => {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [zoom, pan]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current || zoom <= 1) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({
      x: dragRef.current.panX + dx,
      y: dragRef.current.panY + dy,
    });
  }, [zoom]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  return (
    <Box
      ref={containerRef}
      position="relative"
      flex={flex}
      minH={minH}
      h={isFullscreen ? '100vh' : undefined}
      w={isFullscreen ? '100vw' : undefined}
      bg="black"
      borderRadius={isFullscreen ? 0 : 'xl'}
      overflow="hidden"
      border={isFullscreen ? 'none' : '1px solid'}
      borderColor="whiteAlpha.300"
      onWheel={onWheel}
    >
      <Flex
        h="100%"
        w="100%"
        align="center"
        justify="center"
        overflow="hidden"
        cursor={zoom > 1 ? 'grab' : 'default'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        userSelect="none"
      >
        <Box
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragRef.current ? 'none' : 'transform 0.12s ease-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
          }}
        >
          <Box
            as="video"
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              display: 'block',
              objectFit: 'contain',
              maxHeight: '100%',
              maxWidth: '100%',
              height: portrait ? '100%' : 'auto',
              width: portrait ? 'auto' : '100%',
            }}
          />
        </Box>
      </Flex>

      <Badge position="absolute" top={3} left={3} colorScheme="teal" borderRadius="full" px={3} py={1} zIndex={2}>
        {name} sharing screen
      </Badge>

      <HStack
        position="absolute"
        bottom={3}
        right={3}
        spacing={1}
        bg="blackAlpha.700"
        borderRadius="full"
        px={2}
        py={1}
        zIndex={2}
        border="1px solid"
        borderColor="whiteAlpha.300"
      >
        <IconButton
          aria-label="Zoom out"
          icon={<Text fontSize="sm" fontWeight="bold">−</Text>}
          size="xs"
          variant="ghost"
          color="white"
          onClick={zoomOut}
          isDisabled={zoom <= ZOOM_MIN}
        />
        <Text color="white" fontSize="xs" fontWeight="bold" minW="38px" textAlign="center">
          {zoomLabel}
        </Text>
        <IconButton
          aria-label="Zoom in"
          icon={<Text fontSize="sm" fontWeight="bold">+</Text>}
          size="xs"
          variant="ghost"
          color="white"
          onClick={zoomIn}
          isDisabled={zoom >= ZOOM_MAX}
        />
        <IconButton
          aria-label="Reset zoom"
          icon={<Text fontSize="xs">↺</Text>}
          size="xs"
          variant="ghost"
          color="white"
          onClick={resetView}
        />
        <IconButton
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          icon={<Text fontSize="sm">{isFullscreen ? '⤡' : '⛶'}</Text>}
          size="xs"
          variant="ghost"
          color="white"
          onClick={toggleFullscreen}
        />
      </HStack>
    </Box>
  );
};

export default ScreenShareViewer;
