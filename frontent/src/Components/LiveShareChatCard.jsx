/**

 * Compact live card inside chat — avatar, name, tap to watch.

 */



import { Box, Flex, Avatar, Text, Badge, useColorModeValue } from '@chakra-ui/react';



const LiveShareChatCard = ({ live, onPress, isOwn, expired = false }) => {

  const name = live?.streamerName || 'User';

  const borderColor = useColorModeValue(

    expired ? 'gray.300' : 'red.300',

    expired ? 'gray.600' : 'red.400',

  );

  const bg = useColorModeValue(

    expired ? 'gray.100' : 'red.50',

    expired ? 'rgba(55,65,81,0.5)' : 'rgba(127,29,29,0.4)',

  );

  const nameColor = useColorModeValue('gray.900', 'white');

  const hintColor = useColorModeValue('gray.600', 'gray.300');



  return (

    <Box

      mt={1}

      mb={1}

      p={3}

      borderRadius="xl"

      border="1px solid"

      borderColor={borderColor}

      bg={bg}

      maxW="240px"

      minW="190px"

      cursor="pointer"

      onClick={(e) => {

        e.stopPropagation();

        onPress?.();

      }}

      _hover={{ opacity: 0.92 }}

    >

      <Flex align="center" gap={3}>

        <Box position="relative" flexShrink={0}>

          <Avatar src={live?.streamerProfilePic} name={name} size="md" opacity={expired ? 0.7 : 1} />

          {!expired && (

            <Box

              position="absolute"

              bottom={0}

              right={0}

              w="10px"

              h="10px"

              borderRadius="full"

              bg="red.500"

              border="2px solid white"

            />

          )}

        </Box>

        <Box flex={1} minW={0}>

          <Badge colorScheme={expired ? 'gray' : 'red'} fontSize="10px" px={1.5} borderRadius="sm" mb={1}>

            {expired ? 'ENDED' : 'LIVE'}

          </Badge>

          <Text fontWeight="bold" fontSize="sm" noOfLines={1} color={nameColor}>

            {name}

          </Text>

          <Text fontSize="xs" color={hintColor} mt={0.5}>

            {expired ? 'Tap to open profile' : 'Tap to watch live'}

          </Text>

        </Box>

      </Flex>

    </Box>

  );

};



export default LiveShareChatCard;


