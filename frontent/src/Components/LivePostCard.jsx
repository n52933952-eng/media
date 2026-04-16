/**
 * LivePostCard — renders a live stream inside the normal feed.
 *
 * Shows: streamer avatar, name, LIVE badge, live video preview (muted),
 * viewer count, and a "Watch Live" button.
 *
 * Clicking the card or button navigates to /live/:streamerId (full viewer).
 */

import { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Flex, Avatar, Text, Badge, Button, VStack,
  useColorModeValue,
} from '@chakra-ui/react';
import { UserContext } from '../context/UserContext';

const LivePostCard = ({ post }) => {
  const navigate = useNavigate();
  const { user }  = useContext(UserContext);
  const bg        = useColorModeValue('white', 'gray.900');
  const border    = useColorModeValue('gray.200', 'gray.700');

  const streamer   = post.postedBy;
  const streamerId = streamer?._id;

  const goWatch = () => navigate(`/live/${streamerId}`);

  return (
    <Box
      bg={bg}
      border="1px solid"
      borderColor={border}
      borderRadius="2xl"
      overflow="hidden"
      cursor="pointer"
      onClick={goWatch}
      _hover={{ transform: 'translateY(-2px)', boxShadow: 'lg', transition: 'all 0.2s' }}
      transition="all 0.2s"
    >
      {/* Lightweight preview (no room join here, avoids fake views) */}
      <Box position="relative" h="240px" bg="black">
        <Flex h="100%" alignItems="center" justifyContent="center" bg="gray.900">
          <Avatar src={streamer?.profilePic} name={streamer?.name} size="2xl" />
        </Flex>

        {/* LIVE badge */}
        <Box position="absolute" top={3} left={3}>
          <Badge
            colorScheme="red" fontSize="sm" px={3} py={1} borderRadius="full"
            bg="red.500" color="white" fontWeight="bold"
            animation="pulse 1.5s ease-in-out infinite"
            sx={{
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.6 },
              },
            }}
          >
            🔴 LIVE
          </Badge>
        </Box>

        {/* Clear CTA label */}
        <Box position="absolute" top={3} right={3}>
          <Badge bg="blackAlpha.700" color="white" borderRadius="full" px={2} py={1} fontSize="xs">
            Tap to watch
          </Badge>
        </Box>
      </Box>

      {/* Footer */}
      <Flex p={3} alignItems="center" gap={3}>
        <Avatar src={streamer?.profilePic} name={streamer?.name} size="sm" />
        <VStack spacing={0} align="flex-start" flex={1}>
          <Text fontWeight="bold" fontSize="sm" noOfLines={1}>
            {streamer?.name || streamer?.username}
          </Text>
          <Text fontSize="xs" color="gray.500">Live now</Text>
        </VStack>
        <Button size="sm" colorScheme="red" borderRadius="full" onClick={e => { e.stopPropagation(); goWatch(); }}>
          Watch
        </Button>
      </Flex>
    </Box>
  );
};

export default LivePostCard;
