/**
 * Screen share with zoom (scroll when zoomed) + fullscreen.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Text, IconButton, HStack, Badge } from '@chakra-ui/react';

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const ScreenShareViewer = ({
  track,
  name,
  flex = 1,
  minH = '0',
  /** Keep controls above page-level bottom UI (chat bar/send). */
  controlsBottom = '12px',
}) => {
  const containerRef = useRef(null);
  const viewportRef = useRef(null);
  const videoRef = useRef(null);
  const dragRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Attach whenever track or the video element is ready (layout can mount video after first paint).
  useEffect(() => {
    const el = videoRef.current;
    if (!track || !el) return undefined;
    try { track.attach(el); } catch (_) {}
    return () => {
      try { track.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [track, vpSize.w, vpSize.h, isFullscreen]);

  // Portrait phone shares need explicit letterbox sizing (100%×100% can crop on some browsers).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const read = () => {
      const w = el.videoWidth;
      const h = el.videoHeight;
      if (w > 0 && h > 0) setVideoSize({ w, h });
    };
    el.addEventListener('loadedmetadata', read);
    el.addEventListener('resize', read);
    read();
    const poll = setInterval(read, 400);
    return () => {
      el.removeEventListener('loadedmetadata', read);
      el.removeEventListener('resize', read);
      clearInterval(poll);
    };
  }, [track]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setVpSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  const resetScroll = useCallback((center = false) => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (center && zoom > 1) {
      vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2);
      vp.scrollTop = Math.max(0, (vp.scrollHeight - vp.clientHeight) / 2);
    } else {
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    }
  }, [zoom]);

  useEffect(() => {
    if (zoom <= 1) resetScroll(false);
    else requestAnimationFrame(() => resetScroll(true));
  }, [zoom, vpSize.w, vpSize.h, resetScroll]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const applyZoom = useCallback((next) => {
    setZoom(clamp(Number(next.toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const zoomIn = useCallback(() => applyZoom(zoom + ZOOM_STEP), [zoom, applyZoom]);
  const zoomOut = useCallback(() => applyZoom(zoom - ZOOM_STEP), [zoom, applyZoom]);
  const resetView = useCallback(() => {
    setZoom(1);
    resetScroll(false);
  }, [resetScroll]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch (_) {}
  }, []);

  const onWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    applyZoom(zoom + delta);
  }, [zoom, applyZoom]);

  const onPointerDown = useCallback((e) => {
    if (zoom <= 1 || !viewportRef.current) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewportRef.current.scrollLeft,
      scrollTop: viewportRef.current.scrollTop,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [zoom]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current || !viewportRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    viewportRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
    viewportRef.current.scrollTop = dragRef.current.scrollTop - dy;
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const canScroll = zoom > 1 && vpSize.w > 0 && vpSize.h > 0;
  const contentW = canScroll ? vpSize.w * zoom : '100%';
  const contentH = canScroll ? vpSize.h * zoom : '100%';
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const fitBox = useMemo(() => {
    if (canScroll || !vpSize.w || !vpSize.h || !videoSize.w || !videoSize.h) return null;
    const scale = Math.min(vpSize.w / videoSize.w, vpSize.h / videoSize.h);
    return {
      w: Math.max(1, Math.round(videoSize.w * scale)),
      h: Math.max(1, Math.round(videoSize.h * scale)),
    };
  }, [canScroll, vpSize.w, vpSize.h, videoSize.w, videoSize.h]);

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
      display="flex"
      flexDir="column"
    >
      <Box
        ref={viewportRef}
        flex={1}
        minH={0}
        w="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        overflow={canScroll ? 'scroll' : 'hidden'}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        cursor={canScroll ? 'grab' : 'default'}
        userSelect="none"
        css={{
          '&::-webkit-scrollbar': { width: '10px', height: '10px' },
          '&::-webkit-scrollbar-track': { background: 'rgba(255,255,255,0.06)' },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.35)', borderRadius: '6px' },
        }}
      >
        <Box
          w={canScroll ? contentW : (fitBox ? `${fitBox.w}px` : '100%')}
          h={canScroll ? contentH : (fitBox ? `${fitBox.h}px` : '100%')}
          maxW="100%"
          maxH="100%"
          position="relative"
          flexShrink={0}
        >
          <Box
            as="video"
            ref={videoRef}
            autoPlay
            playsInline
            muted
            pointerEvents="none"
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        </Box>
      </Box>

      <Badge position="absolute" top={3} left={3} colorScheme="teal" borderRadius="full" px={3} py={1} zIndex={2}>
        {name} sharing screen
      </Badge>

      {canScroll && (
        <Badge position="absolute" top={3} right={3} bg="blackAlpha.700" borderRadius="full" px={2} py={1} zIndex={2}>
          Scroll sideways / up-down to see hidden parts
        </Badge>
      )}

      <HStack
        position="absolute"
        bottom={controlsBottom}
        right={3}
        spacing={1}
        bg="blackAlpha.700"
        borderRadius="full"
        px={2}
        py={1}
        zIndex={30}
        border="1px solid"
        borderColor="whiteAlpha.300"
      >
        <IconButton aria-label="Zoom out" icon={<Text fontSize="sm" fontWeight="bold">−</Text>} size="xs" variant="ghost" color="white" onClick={zoomOut} isDisabled={zoom <= ZOOM_MIN} />
        <Text color="white" fontSize="xs" fontWeight="bold" minW="38px" textAlign="center">{zoomLabel}</Text>
        <IconButton aria-label="Zoom in" icon={<Text fontSize="sm" fontWeight="bold">+</Text>} size="xs" variant="ghost" color="white" onClick={zoomIn} isDisabled={zoom >= ZOOM_MAX} />
        <IconButton aria-label="Reset zoom" icon={<Text fontSize="xs">↺</Text>} size="xs" variant="ghost" color="white" onClick={resetView} />
        <IconButton aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} icon={<Text fontSize="sm">{isFullscreen ? '⤡' : '⛶'}</Text>} size="xs" variant="ghost" color="white" onClick={toggleFullscreen} />
      </HStack>
    </Box>
  );
};

export default ScreenShareViewer;
