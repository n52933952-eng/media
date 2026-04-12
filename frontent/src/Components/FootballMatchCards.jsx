import React from 'react'
import { Box, Flex, Text, Image, VStack, Grid, GridItem, useColorModeValue } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { footballMatchKey } from '../utils/footballFeed'

/**
 * Clock / phase for live fixtures — minute shown large (cf. Google score cards), separate from “Live” pill.
 */
function getLiveClockDisplay(match, statusShort) {
  const raw = match?.fixture?.status?.elapsed ?? match?.status?.elapsed
  const elapsed = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null
  const u = String(statusShort || '').toUpperCase()

  if (u === 'HT') return { kind: 'phase', label: 'Half-time' }
  if (u === 'BT') return { kind: 'phase', label: 'Break' }
  if (u === 'P') return { kind: 'phase', label: 'Penalties' }
  if (u === 'ET') {
    if (elapsed != null) return { kind: 'minute', minute: elapsed, sub: 'ET' }
    return { kind: 'phase', label: 'Extra time' }
  }
  if (elapsed != null && elapsed >= 0) return { kind: 'minute', minute: elapsed }
  return { kind: 'phase', label: 'Live' }
}

/**
 * Live football match cards (feed + post detail).
 * When enableNavigate + ids are set, opens post detail with ?fixture= so the detail view can show one game.
 */
export default function FootballMatchCards({
  matches,
  enableNavigate = false,
  postId,
  postedByUsername,
}) {
  const navigate = useNavigate()
  const textColor = useColorModeValue('gray.800', 'white')
  const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
  const footballMatchCardBg = useColorModeValue('white', '#1e2433')
  const footballMatchCardBorder = useColorModeValue('gray.200', 'gray.600')
  const footballMatchCardHoverBorder = useColorModeValue('blue.200', 'blue.500')
  /** Minute clock — Google-style emphasis (green), separate from red “Live” chip */
  const liveMinuteColor = useColorModeValue('green.600', 'green.300')

  if (!matches?.length) return null

  const canNav = Boolean(enableNavigate && postId && postedByUsername)

  return (
    <VStack spacing={4} mt={4} mb={2} align="stretch" w="full">
      {matches.map((match, index) => {
        const statusShort = match.status?.short || match.fixture?.status?.short || ''
        const isLive = ['1H', '2H', 'HT', 'BT', 'ET', 'P', 'LIVE', 'IN_PLAY', 'PAUSED'].includes(statusShort)
        const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort)
        const homeGoals = match.score?.home ?? match.goals?.home
        const awayGoals = match.score?.away ?? match.goals?.away
        const hasScore =
          homeGoals !== null && homeGoals !== undefined && awayGoals !== null && awayGoals !== undefined
        const goalEvents = (match.events || []).filter((e) => e.type === 'Goal')
        const matchKey = footballMatchKey(match, index)
        const clock = isLive ? getLiveClockDisplay(match, statusShort) : null

        return (
          <Box
            key={matchKey}
            bg={footballMatchCardBg}
            borderRadius="xl"
            border="1px solid"
            borderColor={footballMatchCardBorder}
            boxShadow="md"
            p={4}
            w="full"
            _hover={canNav ? { shadow: 'lg', borderColor: footballMatchCardHoverBorder } : undefined}
            transition="all 0.2s"
            cursor={canNav ? 'pointer' : 'default'}
            onClick={
              canNav
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigate(`/${postedByUsername}/post/${postId}?fixture=${encodeURIComponent(matchKey)}`)
                  }
                : undefined
            }
            role={canNav ? 'button' : undefined}
          >
            <Flex align="center" mb={3} pb={2} borderBottom="1px solid" borderColor={footballMatchCardBorder}>
              {match.league?.logo && (
                <Image src={match.league.logo} boxSize="16px" mr={2} alt={match.league.name} />
              )}
              <Text fontSize="xs" fontWeight="semibold" color={secondaryTextColor}>
                {match.league?.name || 'Premier League'}
              </Text>

              {isLive && clock && (
                <Flex ml="auto" align="flex-end" direction="column" gap={1} textAlign="right">
                  {clock.kind === 'minute' ? (
                    <Flex align="baseline" gap={1} justify="flex-end" title={match.status?.long || match.fixture?.status?.long || 'Live'}>
                      <Text
                        fontSize="xl"
                        fontWeight="extrabold"
                        color={liveMinuteColor}
                        lineHeight="1.1"
                        letterSpacing="-0.02em"
                      >
                        {clock.minute}'
                      </Text>
                      {clock.sub ? (
                        <Text as="span" fontSize="xs" fontWeight="semibold" color={secondaryTextColor}>
                          {clock.sub}
                        </Text>
                      ) : null}
                    </Flex>
                  ) : (
                    <Text
                      fontSize="sm"
                      fontWeight="bold"
                      color={liveMinuteColor}
                      lineHeight="1.2"
                      title={match.status?.long || match.fixture?.status?.long || clock.label}
                    >
                      {clock.label}
                    </Text>
                  )}
                  <Flex align="center" bg="red.500" px={2} py={0.5} borderRadius="full" boxShadow="sm">
                    <Box w="6px" h="6px" bg="white" borderRadius="full" mr={1} aria-hidden />
                    <Text fontSize="10px" fontWeight="bold" color="white" letterSpacing="wide">
                      LIVE
                    </Text>
                  </Flex>
                </Flex>
              )}

              {isFinished && (
                <Text ml="auto" fontSize="xs" fontWeight="bold" color="gray.500">
                  FT
                </Text>
              )}
            </Flex>

            <Flex align="center" justify="space-between" mb={2}>
              <Flex align="center" flex={1} mr={2}>
                {(match.homeTeam?.logo || match.teams?.home?.logo) && (
                  <Image
                    src={match.homeTeam?.logo || match.teams?.home?.logo}
                    boxSize="28px"
                    mr={2}
                    alt={match.homeTeam?.name || match.teams?.home?.name}
                  />
                )}
                <Text fontSize="sm" fontWeight="bold" color={textColor} noOfLines={1}>
                  {match.homeTeam?.name || match.teams?.home?.name || 'Home'}
                </Text>
              </Flex>

              <Flex align="center" justify="center" minW="80px" direction="column">
                {hasScore ? (
                  <Flex align="center" gap={2}>
                    <Text fontSize="xl" fontWeight="bold" color={textColor}>
                      {homeGoals ?? 0}
                    </Text>
                    <Text fontSize="lg" fontWeight="bold" color={secondaryTextColor}>
                      -
                    </Text>
                    <Text fontSize="xl" fontWeight="bold" color={textColor}>
                      {awayGoals ?? 0}
                    </Text>
                  </Flex>
                ) : (
                  <Text fontSize="xs" fontWeight="bold" color={secondaryTextColor}>
                    ⏰ {match.time}
                  </Text>
                )}
              </Flex>

              <Flex align="center" flex={1} ml={2} justify="flex-end">
                <Text fontSize="sm" fontWeight="bold" color={textColor} noOfLines={1} textAlign="right">
                  {match.awayTeam?.name || match.teams?.away?.name || 'Away'}
                </Text>
                {(match.awayTeam?.logo || match.teams?.away?.logo) && (
                  <Image
                    src={match.awayTeam?.logo || match.teams?.away?.logo}
                    boxSize="28px"
                    ml={2}
                    alt={match.awayTeam?.name || match.teams?.away?.name}
                  />
                )}
              </Flex>
            </Flex>

            {goalEvents.length > 0 && (
              <Box mt={3} pt={3} borderTop="1px solid" borderColor={footballMatchCardBorder}>
                <Grid templateColumns="1fr auto 1fr" gap={2} fontSize="xs">
                  <GridItem textAlign="right">
                    {goalEvents
                      .filter((e) => e.team === (match.homeTeam?.name || match.teams?.home?.name))
                      .map((event, idx) => (
                        <Text key={idx} color={textColor} mb={1}>
                          {event.player}{' '}
                          {event.time !== '?' && event.time ? `${event.time}'` : ''}
                          {event.detail?.includes('Penalty') || event.detail?.includes('PENALTY') ? ' (P)' : ''}
                        </Text>
                      ))}
                  </GridItem>
                  <GridItem display="flex" alignItems="flex-start" justifyContent="center">
                    <Text color="white" filter="drop-shadow(0 0 1px rgba(0,0,0,0.5))">
                      ⚽
                    </Text>
                  </GridItem>
                  <GridItem textAlign="left">
                    {goalEvents
                      .filter((e) => e.team === (match.awayTeam?.name || match.teams?.away?.name))
                      .map((event, idx) => (
                        <Text key={idx} color={textColor} mb={1}>
                          {event.player}{' '}
                          {event.time !== '?' && event.time ? `${event.time}'` : ''}
                          {event.detail?.includes('Penalty') || event.detail?.includes('PENALTY') ? ' (P)' : ''}
                        </Text>
                      ))}
                  </GridItem>
                </Grid>
              </Box>
            )}
          </Box>
        )
      })}

      <Text fontSize="xs" color={secondaryTextColor} textAlign="center" mt={1}>
        🔗 Check Football page for live updates!
      </Text>
    </VStack>
  )
}
