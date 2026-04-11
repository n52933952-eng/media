import { Box, Heading, Text, VStack, Link as ChakraLink, useColorModeValue } from '@chakra-ui/react'
import { Link } from 'react-router-dom'

const SUPPORT_EMAIL = 'j4116507@gmail.com'

export default function TermsOfService() {
  const muted = useColorModeValue('gray.600', 'gray.400')
  const cardBg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  return (
    <Box py={8} px={1}>
      <VStack align="stretch" spacing={6} maxW="640px" mx="auto">
        <Box>
          <Heading size="lg" mb={2}>
            Terms of Service
          </Heading>
          <Text fontSize="sm" color={muted}>
            Last updated: {new Date().toISOString().slice(0, 10)} · playsocial
          </Text>
        </Box>

        <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="md" p={5}>
          <VStack align="stretch" spacing={4} fontSize="sm" lineHeight="tall">
            <Text>
              By accessing or using <strong>playsocial</strong> (the “Service”), you agree to these Terms. If you do not
              agree, do not use the Service.
            </Text>

            <Heading size="sm">1. The Service</Heading>
            <Text>
              playsocial offers social features (e.g. posts, messaging, games, calls) as described in the product. We may
              change, suspend, or discontinue features with reasonable notice where practicable.
            </Text>

            <Heading size="sm">2. Accounts</Heading>
            <Text>
              You must provide accurate information and keep your credentials secure. You are responsible for activity
              under your account. We may suspend or terminate accounts that violate these Terms or harm the community.
            </Text>

            <Heading size="sm">3. User content</Heading>
            <Text>
              You retain rights to content you post. You grant us a license to host, display, and distribute your content
              on the Service as needed to operate it. You represent you have the rights to post your content.
            </Text>

            <Heading size="sm">4. Prohibited conduct</Heading>
            <Text>
              No illegal activity, harassment, hate, threats, non-consensual intimate imagery, malware, spam, scraping
              that overloads the Service, impersonation, or attempts to break security. No content that infringes others’
              intellectual property.
            </Text>

            <Heading size="sm">5. Moderation</Heading>
            <Text>
              We may remove content or restrict accounts to protect users and comply with law. We are not obligated to
              monitor all content but may do so.
            </Text>

            <Heading size="sm">6. Third parties & ads</Heading>
            <Text>
              The Service may include links or integrations (e.g. sign-in providers, media hosts, advertising). Their
              terms apply to those features. See our{' '}
              <ChakraLink as={Link} to="/privacy" color="blue.400">
                Privacy Policy
              </ChakraLink>{' '}
              for how data is used, including advertising technologies.
            </Text>

            <Heading size="sm">7. Disclaimers</Heading>
            <Text>
              The Service is provided “as is” without warranties of any kind. We do not guarantee uninterrupted or
              error-free operation.
            </Text>

            <Heading size="sm">8. Limitation of liability</Heading>
            <Text>
              To the maximum extent permitted by law, playsocial and its operators are not liable for indirect,
              incidental, or consequential damages arising from your use of the Service.
            </Text>

            <Heading size="sm">9. Governing law</Heading>
            <Text>
              You agree that disputes will be handled in accordance with applicable law and jurisdiction appropriate for
              the operator of the Service (update this section with your country/state if you want specificity).
            </Text>

            <Heading size="sm">10. Contact</Heading>
            <Text>
              <ChakraLink href={`mailto:${SUPPORT_EMAIL}`} color="blue.400">
                {SUPPORT_EMAIL}
              </ChakraLink>
            </Text>

            <Text fontSize="xs" color={muted} pt={2}>
              These terms are a practical template, not legal advice. Have them reviewed for your jurisdiction before
              relying on them commercially.
            </Text>
          </VStack>
        </Box>

        <Text fontSize="sm" color={muted} textAlign="center">
          <ChakraLink as={Link} to="/privacy" color="blue.400">
            Privacy Policy
          </ChakraLink>
          {' · '}
          <ChakraLink as={Link} to="/" color="blue.400">
            Home / Login
          </ChakraLink>
        </Text>
      </VStack>
    </Box>
  )
}
