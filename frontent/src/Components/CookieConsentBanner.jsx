import { useEffect, useState } from 'react'
import { Box, Button, Text, Link as ChakraLink, useColorModeValue } from '@chakra-ui/react'
import { Link } from 'react-router-dom'

const STORAGE_KEY = 'playsocial_cookie_consent_v1'

/**
 * Lightweight notice for cookies / ads transparency. Does not block the app.
 * For stricter EEA/UK personalized ads, you may need a certified CMP later.
 */
export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)
  const bg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      if (window.localStorage.getItem(STORAGE_KEY)) return
      setVisible(true)
    } catch {
      /* private mode / blocked storage */
    }
  }, [])

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <Box
      position="fixed"
      left={0}
      right={0}
      bottom={0}
      zIndex={9998}
      px={3}
      py={3}
      bg={bg}
      borderTopWidth="1px"
      borderColor={border}
      boxShadow="0 -4px 24px rgba(0,0,0,0.15)"
    >
      <Box maxW="620px" mx="auto" display="flex" flexDirection={{ base: 'column', sm: 'row' }} gap={3} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <Text fontSize="sm" flex={1}>
          We use cookies and similar tech to run the site, keep you signed in, and (where enabled) show or measure ads.{' '}
          <ChakraLink as={Link} to="/privacy" color="blue.400" fontWeight="600">
            Privacy Policy
          </ChakraLink>
        </Text>
        <Button size="sm" colorScheme="blue" onClick={dismiss} flexShrink={0}>
          OK
        </Button>
      </Box>
    </Box>
  )
}
