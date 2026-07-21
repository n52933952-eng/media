import React, { useMemo } from 'react'
import { Avatar, Box, Flex, Text, useColorModeValue } from '@chakra-ui/react'

const DEFAULT_SCRIPT =
  'https://pl30475410.effectivecpmnetwork.com/fc74cc04657e9bfb73f4a6bff8084c15/invoke.js'
const DEFAULT_CONTAINER = 'container-fc74cc04657e9bfb73f4a6bff8084c15'

/**
 * Adsterra Native Banner between feed posts.
 * Uses an iframe so the same zone (fixed container id) can appear after every post safely.
 */
export default function AdsterraFeedNative({ slotKey = 'feed' }) {
  const scriptSrc = (import.meta.env.VITE_ADSTERRA_NATIVE_SCRIPT || DEFAULT_SCRIPT).trim()
  const containerId = (import.meta.env.VITE_ADSTERRA_NATIVE_CONTAINER || DEFAULT_CONTAINER).trim()
  const allowDev = import.meta.env.VITE_ADSTERRA_ALLOW_DEV === 'true'
  const enabled = !!scriptSrc && !!containerId && (import.meta.env.PROD || allowDev)

  const cardBg = useColorModeValue('white', 'gray.800')
  const border = useColorModeValue('gray.200', 'gray.700')
  const muted = useColorModeValue('gray.500', 'gray.400')
  const mediaBg = useColorModeValue('gray.100', 'black')

  const srcDoc = useMemo(() => {
    if (!enabled) return ''
    let src = scriptSrc
    if (src.startsWith('//')) src = `https:${src}`
    const safeSrc = src.replace(/"/g, '&quot;')
    const safeId = containerId.replace(/"/g, '')
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
      html,body{margin:0;padding:0;background:transparent;overflow:hidden;}
      #${safeId}{width:100%;min-height:120px;}
      img,iframe{max-width:100%;height:auto;}
    </style></head><body>
      <script async="async" data-cfasync="false" src="${safeSrc}"><\/script>
      <div id="${safeId}"></div>
    </body></html>`
  }, [enabled, scriptSrc, containerId])

  if (!enabled) return null

  return (
    <Flex
      gap={3}
      mb={4}
      py={5}
      w="100%"
      maxW="100%"
      px={{ base: 3, md: 0 }}
      data-ad-network="adsterra"
      data-ad-format="native-banner"
      data-ad-slot={slotKey}
    >
      <Flex flexDirection="column" alignItems="center">
        <Avatar size="md" name="Sponsored" bg="gray.600" color="white" />
        <Box w="1px" h="full" bg="gray.light" my={2} minH="40px" />
      </Flex>
      <Box flex={1} minW={0}>
        <Flex justify="space-between" align="center" mb={2}>
          <Text fontWeight="bold" fontSize="sm">
            Sponsored
          </Text>
          <Text fontSize="xs" color={muted}>
            Ad
          </Text>
        </Flex>
        {/* Same visual frame as image posts: bordered media box */}
        <Box
          borderWidth="1px"
          borderColor={border}
          borderRadius="md"
          overflow="hidden"
          bg={mediaBg}
          w="100%"
        >
          <Box as="iframe"
            title={`Sponsored ${slotKey}`}
            srcDoc={srcDoc}
            width="100%"
            minH={{ base: '160px', md: '200px' }}
            h={{ base: '180px', md: '220px' }}
            border="0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            style={{ display: 'block', background: 'transparent' }}
          />
        </Box>
        <Text fontSize="xs" color={muted} mt={2}>
          Advertisement
        </Text>
      </Box>
    </Flex>
  )
}

/** Insert an ad after every N posts. Default 1 = between each post. */
export function getAdsterraFeedEvery() {
  const n = Number(import.meta.env.VITE_ADSTERRA_FEED_EVERY || 1)
  return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 1
}
