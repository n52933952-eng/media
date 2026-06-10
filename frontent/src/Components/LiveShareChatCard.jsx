/**
 * Compact live card inside chat — avatar, name, tap to watch.
 */

import { Box, Flex, Avatar, Text, Badge, useColorModeValue } from '@chakra-ui/react';

const LiveShareChatCard = ({ live, onPress, isOwn }) => {
  const borderColor = useColorModeValue('gray.300', 'gray.600');
  const bgOwn = useColorModeValue('blackAlpha.50', 'whiteAlpha.100');
  const bgOther = useColorModeValue('whiteAlpha.100', 'blackAlpha.400');
  const nameColor = useColorModeValue('gray.800', 'white');
  const hintColor = useColorModeValue('gray.600', 'gray.400');
  const bg = isOwn ? bgOwn : bgOther;
  const name = live?.streamerName || 'User';

  return (
    <Box
      mt={2}
      mb={1}
      p={2.5}
      borderRadius="xl"
      border="1px solid"
      borderColor={borderColor}
      bg={bg}
      maxW="240px"
      cursor="pointer"
      onClick={(e) => {
        e.stopPropagation();
        onPress?.();
      }}
      _hover={{ opacity: 0.92 }}
    >
      <Flex align="center" gap={3}>
        <Avatar src={live?.streamerProfilePic} name={name} size="sm" />
        <Box flex={1} minW={0}>
          <Badge colorScheme="red" fontSize="10px" px={1.5} borderRadius="sm" mb={1}>
            🔴 LIVE
          </Badge>
          <Text fontWeight="bold" fontSize="sm" noOfLines={1} color={nameColor}>
            {name}
          </Text>
          <Text fontSize="xs" color={hintColor} mt={0.5}>
            Tap to watch
          </Text>
        </Box>
      </Flex>
    </Box>
  );
};

export default LiveShareChatCard;
