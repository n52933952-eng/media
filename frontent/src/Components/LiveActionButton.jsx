/**
 * Vertical live action rail button — matches mobile LiveActionButton style.
 */

import { Box, Text } from '@chakra-ui/react';

const LiveActionButton = ({
  ui,
  icon,
  iconNode,
  label,
  onClick,
  disabled = false,
  primary = false,
  highlight = false,
  circleStyle = {},
}) => (
  <Box
    as="button"
    type="button"
    display="flex"
    flexDir="column"
    alignItems="center"
    bg="transparent"
    border="none"
    cursor={disabled ? 'not-allowed' : 'pointer'}
    opacity={disabled ? 0.38 : 1}
    onClick={disabled ? undefined : onClick}
    aria-label={label}
    _hover={disabled ? {} : { opacity: 0.92 }}
  >
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="full"
      bg={primary ? 'blue.500' : highlight ? 'rgba(29, 161, 242, 0.55)' : 'rgba(0,0,0,0.48)'}
      border="1px solid"
      borderColor={
        primary
          ? 'transparent'
          : highlight
            ? 'rgba(147, 197, 253, 0.55)'
            : 'rgba(255,255,255,0.22)'
      }
      w={ui?.actionCircle?.width}
      h={ui?.actionCircle?.height}
      {...circleStyle}
    >
      {iconNode || (
        <Text userSelect="none" fontSize={ui?.actionIcon?.fontSize} lineHeight={1}>
          {icon}
        </Text>
      )}
    </Box>
    <Text
      mt="2px"
      color="white"
      fontWeight="600"
      textAlign="center"
      lineHeight="1.15"
      textShadow="0 1px 3px rgba(0,0,0,0.8)"
      fontSize={ui?.actionLabel?.fontSize}
      maxW={ui?.actionLabel?.maxWidth}
      noOfLines={2}
    >
      {label}
    </Text>
  </Box>
);

export default LiveActionButton;
