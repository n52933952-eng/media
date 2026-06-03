/**
 * Letterboxed video — full camera visible (no cover crop).
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { Box, Flex } from '@chakra-ui/react';

const CallVideoFrame = ({ videoRef: externalRef, track, trackKey = 'video', muted = false }) => {
  const internalRef = useRef(null);
  const videoRef = externalRef ?? internalRef;
  const containerRef = useRef(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [vid, setVid] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = videoRef.current;
    if (!track || !el) return undefined;
    try { track.attach(el); } catch (_) {}
    return () => {
      try { track.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [track, trackKey, videoRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setVp({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const read = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setVid({ w: v.videoWidth, h: v.videoHeight });
      }
    };
    v.addEventListener('loadedmetadata', read);
    v.addEventListener('resize', read);
    read();
    const t = setInterval(read, 500);
    return () => {
      v.removeEventListener('loadedmetadata', read);
      v.removeEventListener('resize', read);
      clearInterval(t);
    };
  }, [videoRef, trackKey]);

  const fit = useMemo(() => {
    if (!vp.w || !vp.h || !vid.w || !vid.h) return null;
    const scale = Math.min(vp.w / vid.w, vp.h / vid.h);
    return {
      w: Math.max(1, Math.round(vid.w * scale)),
      h: Math.max(1, Math.round(vid.h * scale)),
    };
  }, [vp.w, vp.h, vid.w, vid.h]);

  if (!track) return null;

  return (
    <Flex
      ref={containerRef}
      w="100%"
      h="100%"
      minH={0}
      flex={1}
      align="center"
      justify="center"
      bg="black"
    >
      <Box
        w={fit ? `${fit.w}px` : '100%'}
        h={fit ? `${fit.h}px` : '100%'}
        maxW="100%"
        maxH="100%"
        position="relative"
      >
        <Box
          key={trackKey}
          as="video"
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          w="100%"
          h="100%"
          style={{ display: 'block', objectFit: 'contain' }}
        />
      </Box>
    </Flex>
  );
};

export default CallVideoFrame;
