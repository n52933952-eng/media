import { Box, Heading, Text, VStack, Link as ChakraLink, useColorModeValue } from '@chakra-ui/react'
import { Link } from 'react-router-dom'

/**
 * Public privacy policy — required context for AdSense, cookies, and third-party services.
 * Replace SUPPORT_EMAIL with your real contact when you publish.
 */
const SUPPORT_EMAIL = 'j4116507@gmail.com'

export default function PrivacyPolicy() {
  const muted = useColorModeValue('gray.600', 'gray.400')
  const cardBg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  return (
    <Box py={8} px={1}>
      <VStack align="stretch" spacing={6} maxW="640px" mx="auto">
        <Box>
          <Heading size="lg" mb={2}>
            Privacy Policy
          </Heading>
          <Text fontSize="sm" color={muted}>
            Last updated: {new Date().toISOString().slice(0, 10)} · playsocial
          </Text>
        </Box>

        <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="md" p={5}>
          <VStack align="stretch" spacing={4} fontSize="sm" lineHeight="tall">
            <Text>
              This policy describes how <strong>playsocial</strong> (“we”, “us”) collects, uses, and shares information
              when you use our website and services (the “Service”), including if we show ads through Google AdSense or
              similar partners.
            </Text>

            <Heading size="sm">1. Information you provide</Heading>
            <Text>
              Account details (such as name, username, email, profile information, and content you post), messages you
              send, and other information you choose to submit (e.g. comments, media).
            </Text>

            <Heading size="sm">2. Information collected automatically</Heading>
            <Text>
              We may collect device and usage data such as IP address, browser type, approximate location, pages viewed,
              and timestamps. We use cookies and similar technologies for sign-in, preferences, security, analytics, and
              (where applicable) advertising.
            </Text>

            <Heading size="sm">3. Advertising (Google AdSense)</Heading>
            <Text>
              Third-party vendors, including <strong>Google</strong>, may use cookies to serve ads based on your visits
              to this site or other sites. Google’s use of advertising cookies enables it and its partners to serve ads to
              you. You may opt out of personalized advertising by visiting{' '}
              <ChakraLink href="https://www.google.com/settings/ads" isExternal color="blue.400">
                Google Ads Settings
              </ChakraLink>{' '}
              or{' '}
              <ChakraLink href="https://www.aboutads.info/choices/" isExternal color="blue.400">
                aboutads.info
              </ChakraLink>
              .
            </Text>
            <Text fontSize="xs" color={muted}>
              When we enable AdSense, we will load Google’s script only on the production site and in line with Google’s
              policies. You can control optional ad-related storage via your browser and, where required, consent tools.
            </Text>

            <Heading size="sm">4. Other third-party services</Heading>
            <Text>
              We may use providers for hosting, media (e.g. image/video delivery), authentication (e.g. Google sign-in),
              push/in-app messaging infrastructure, and analytics. Those providers process data under their own policies.
            </Text>

            <Heading size="sm">5. How we use information</Heading>
            <Text>
              To operate and improve the Service, secure accounts, communicate with you, enforce our{' '}
              <ChakraLink as={Link} to="/terms" color="blue.400">
                Terms of Service
              </ChakraLink>
              , comply with law, and (where allowed) show or measure advertising.
            </Text>

            <Heading size="sm">6. Sharing</Heading>
            <Text>
              We may share information with service providers, in connection with a legal request, or to protect rights and
              safety. Public content you post may be visible to other users and, depending on settings, on the open web.
            </Text>

            <Heading size="sm">7. Retention</Heading>
            <Text>
              We keep information as long as needed to provide the Service and for legitimate business or legal purposes,
              then delete or anonymize it where appropriate.
            </Text>

            <Heading size="sm">8. Your rights (EEA/UK and similar)</Heading>
            <Text>
              Depending on where you live, you may have rights to access, correct, delete, or restrict processing of your
              personal data, and to object to certain processing. Contact us to exercise these rights.
            </Text>

            <Heading size="sm">9. Children</Heading>
            <Text>
              The Service is not directed to children under 13 (or the minimum age in your country). Do not use the
              Service if you are under that age.
            </Text>

            <Heading size="sm">10. Contact</Heading>
            <Text>
              Questions about this policy:{' '}
              <ChakraLink href={`mailto:${SUPPORT_EMAIL}`} color="blue.400">
                {SUPPORT_EMAIL}
              </ChakraLink>
              .
            </Text>

            <Text fontSize="xs" color={muted} pt={2}>
              This page is provided for transparency. It is not legal advice. You may want a lawyer to review before
              launch in regulated markets.
            </Text>
          </VStack>
        </Box>

        <Text fontSize="sm" color={muted} textAlign="center">
          <ChakraLink as={Link} to="/terms" color="blue.400">
            Terms of Service
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
