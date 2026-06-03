/**
 * Draggable picture-in-picture tile for 1:1 calls.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { Box, Text } from '@chakra-ui/react';

const DraggableCallPip = ({
  children,
  label,
  width = 142,
  height = 106,
  defaultRight = 16,
  defaultBottom = 118,
  zIndex = 25,
}) => {
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || pos) return;
    const place = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) {
        setPos({
          x: Math.max(0, w - width - defaultRight),
          y: Math.max(0, h - height - defaultBottom),
        });
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(host);
    return () => ro.disconnect();
  }, [pos, width, height, defaultRight, defaultBottom]);

  const clamp = useCallback((x, y) => {
    const host = hostRef.current;
    if (!host) return { x, y };
    const maxX = Math.max(0, host.clientWidth - width);
    const maxY = Math.max(0, host.clientHeight - height);
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(0, y)),
    };
  }, [width, height]);

  const onPointerDown = useCallback((e) => {
    if (!pos) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clamp(dragRef.current.originX + dx, dragRef.current.originY + dy));
  }, [clamp]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  if (!pos) return null;

  return (
    <Box ref={hostRef} position="absolute" inset={0} pointerEvents="none" zIndex={zIndex}>
      <Box
        position="absolute"
        left={`${pos.x}px`}
        top={`${pos.y}px`}
        w={`${width}px`}
        h={`${height}px`}
        borderRadius="xl"
        overflow="hidden"
        border="2px solid"
        borderColor="whiteAlpha.500"
        boxShadow="0 6px 20px rgba(0,0,0,0.45)"
        bg="black"
        pointerEvents="auto"
        cursor="grab"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        _active={{ cursor: 'grabbing' }}
      >
        {label ? (
          <Text
            position="absolute"
            bottom={1}
            left={1}
            right={1}
            zIndex={2}
            fontSize="10px"
            fontWeight="600"
            color="white"
            textAlign="center"
            bg="blackAlpha.700"
            borderRadius="md"
            px={1}
            noOfLines={1}
          >
            {label}
          </Text>
        ) : null}
        {children}
      </Box>
    </Box>
  );
};

export default DraggableCallPip;
