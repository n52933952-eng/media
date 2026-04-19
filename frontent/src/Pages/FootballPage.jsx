import React, { useState, useEffect, useContext } from 'react'
import {
    Box,
    Container,
    Heading,
    Text,
    Flex,
    Image,
    Badge,
    Spinner,
    Tabs,
    TabList,
    TabPanels,
    Tab,
    TabPanel,
    useColorModeValue,
    VStack,
    HStack,
    Divider,
    Grid,
    GridItem
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'
import FootballIcon from '../Components/FootballIcon'

const FootballPage = () => {
    const { user } = useContext(UserContext)
    const { socket } = useContext(SocketContext) || {}
    const [liveMatches, setLiveMatches] = useState([])
    const [upcomingMatches, setUpcomingMatches] = useState([])
    const [finishedMatches, setFinishedMatches] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]) // Today by default
    
    const showToast = useShowToast()
    
    const bgColor = useColorModeValue('white', 'gray.800')
    const borderColor = useColorModeValue('gray.200', 'gray.700')
    const liveColor = useColorModeValue('red.500', 'red.400')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    
    // Fetch matches function (can be called manually or via socket)
    const fetchMatches = async (silent = false) => {
        try {
            if (!silent) {
                console.log('⚽ [FootballPage] Starting to fetch matches...')
                setLoading(true)
            }
            
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            
            // Fetch live matches (today - includes IN_PLAY, PAUSED status)
            if (!silent) console.log('⚽ [FootballPage] Fetching live matches (today)...')
            const today = new Date().toISOString().split('T')[0]
            const liveRes = await fetch(
                `${baseUrl}/api/football/matches?status=live&date=${today}`,
                { credentials: 'include' }
            )
            const liveData = await liveRes.json()
            if (!silent) console.log('⚽ [FootballPage] Live matches response:', { status: liveRes.status, ok: liveRes.ok, data: liveData })
            
            // Fetch upcoming matches (next 7 days - no date filter, backend handles it)
            if (!silent) console.log('⚽ [FootballPage] Fetching upcoming matches (next 7 days)')
            const upcomingRes = await fetch(
                `${baseUrl}/api/football/matches?status=upcoming`,
                { credentials: 'include' }
            )
            const upcomingData = await upcomingRes.json()
            if (!silent) console.log('⚽ [FootballPage] Upcoming matches response:', { status: upcomingRes.status, ok: upcomingRes.ok, data: upcomingData })
            
            // Fetch finished matches (last 3 days - no date filter, backend handles it)
            if (!silent) console.log('⚽ [FootballPage] Fetching finished matches (last 3 days)')
            const finishedRes = await fetch(
                `${baseUrl}/api/football/matches?status=finished`,
                { credentials: 'include' }
            )
            const finishedData = await finishedRes.json()
            if (!silent) console.log('⚽ [FootballPage] Finished matches response:', { status: finishedRes.status, ok: finishedRes.ok, data: finishedData })
            
            if (liveRes.ok) {
                if (!silent) console.log('⚽ [FootballPage] Setting live matches:', liveData.matches?.length || 0)
                setLiveMatches(liveData.matches || [])
            } else {
                console.error('⚽ [FootballPage] Live matches request failed:', liveData)
            }
            
            if (upcomingRes.ok) {
                if (!silent) console.log('⚽ [FootballPage] Setting upcoming matches:', upcomingData.matches?.length || 0)
                setUpcomingMatches(upcomingData.matches || [])
            } else {
                console.error('⚽ [FootballPage] Upcoming matches request failed:', upcomingData)
            }
            
            if (finishedRes.ok) {
                if (!silent) console.log('⚽ [FootballPage] Setting finished matches:', finishedData.matches?.length || 0)
                setFinishedMatches(finishedData.matches || [])
            } else {
                console.error('⚽ [FootballPage] Finished matches request failed:', finishedData)
            }
            
        } catch (error) {
            console.error('⚽ [FootballPage] Error fetching matches:', error)
            if (!silent) {
                showToast('Error', 'Failed to load matches', 'error')
            }
        } finally {
            if (!silent) {
                setLoading(false)
                console.log('⚽ [FootballPage] Finished fetching matches')
            }
        }
    }
    
    // Initial fetch on mount (only once)
    useEffect(() => {
        fetchMatches()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    
    // Listen for real-time match updates via socket (NO API CALLS - Direct state update!)
    useEffect(() => {
        if (!socket) return
        
        // Only log in development
        const isDev = import.meta.env.DEV
        
        const handleFootballPageUpdate = (data) => {
            // Only log in development (optional - remove if not needed)
            if (isDev) {
                console.log('📥 [FootballPage] Update received:', {
                    live: data.live?.length || 0,
                    upcoming: data.upcoming?.length || 0,
                    finished: data.finished?.length || 0
                })
            }
            
            // Update state directly - no API calls needed!
            if (data.live !== undefined) {
                setLiveMatches(data.live)
            }
            if (data.upcoming !== undefined) {
                setUpcomingMatches(data.upcoming)
            }
            if (data.finished !== undefined) {
                setFinishedMatches(data.finished)
            }
        }
        
        // Listen for feed post updates (from feed page)
        const handleFootballMatchUpdate = (data) => {
            console.log('⚽ [FootballPage] Feed post update received, refreshing matches silently...')
            // Only refresh if we're on the page and user might be viewing feed
            // For Football page, we rely on footballPageUpdate event
            fetchMatches(true)
        }
        
        // Connection status listeners (only log errors in production)
        socket.on('connect', () => {
            if (isDev) {
                console.log('✅ [FootballPage] Socket connected')
            }
        })
        
        socket.on('disconnect', () => {
            // Always log disconnections (important)
            console.warn('⚠️ [FootballPage] Socket disconnected')
        })
        
        socket.on('connect_error', (error) => {
            // Always log connection errors (important)
            console.error('❌ [FootballPage] Socket connection error:', error)
        })
        
        // Listen for football updates
        socket.on('footballPageUpdate', handleFootballPageUpdate)
        socket.on('footballMatchUpdate', handleFootballMatchUpdate)
        
        return () => {
            socket.off('footballPageUpdate', handleFootballPageUpdate)
            socket.off('footballMatchUpdate', handleFootballMatchUpdate)
            socket.off('connect')
            socket.off('disconnect')
            socket.off('connect_error')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket])
    
    // Format time
    const formatTime = (date) => {
        const matchDate = new Date(date)
        return matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    
    // Generate next 7 days for date selector
    const getNext7Days = () => {
        const days = []
        const today = new Date()
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(today)
            date.setDate(today.getDate() + i)
            
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
            const dayNumber = date.getDate()
            const monthName = date.toLocaleDateString('en-US', { month: 'short' })
            const dateString = date.toISOString().split('T')[0]
            
            days.push({
                dayName,
                dayNumber,
                monthName,
                dateString,
                isToday: i === 0
            })
        }
        
        return days
    }
    
    // Filter matches by selected date
    const filterMatchesByDate = (matches) => {
        if (!selectedDate) return matches
        
        return matches.filter(match => {
            const matchDate = new Date(match.fixture?.date).toISOString().split('T')[0]
            return matchDate === selectedDate
        })
    }
    
    // Render match card
    const MatchCard = ({ match, showStatus = true }) => (
        <Box
            bg={bgColor}
            borderRadius="lg"
            border="1px solid"
            borderColor={borderColor}
            p={4}
            mb={3}
            _hover={{ shadow: 'md' }}
            transition="all 0.2s"
        >
            {/* League info */}
            <Flex align="center" mb={3}>
                {match.league?.logo && (
                    <Image src={match.league.logo} boxSize="20px" mr={2} />
                )}
                <Text fontSize="sm" color={secondaryTextColor} fontWeight="medium">
                    {match.league?.name}
                </Text>
                {showStatus && match.fixture?.status?.short === '1H' && (
                    <Badge ml="auto" colorScheme="red" fontSize="xs">
                        🔴 LIVE {match.fixture?.status?.elapsed}'
                    </Badge>
                )}
                {showStatus && match.fixture?.status?.short === '2H' && (
                    <Badge ml="auto" colorScheme="red" fontSize="xs">
                        🔴 LIVE {match.fixture?.status?.elapsed}'
                    </Badge>
                )}
                {showStatus && match.fixture?.status?.short === 'HT' && (
                    <Badge ml="auto" colorScheme="orange" fontSize="xs">
                        HALF TIME
                    </Badge>
                )}
            </Flex>
            
            {/* Teams and score */}
            <Grid templateColumns="1fr auto 1fr" gap={4} alignItems="center">
                {/* Home team */}
                <GridItem textAlign="right">
                    <Flex align="center" justify="flex-end">
                        <Text fontSize="md" fontWeight="semibold" color={textColor}>
                            {match.teams?.home?.name}
                        </Text>
                        {match.teams?.home?.logo && (
                            <Image src={match.teams.home.logo} boxSize="30px" ml={2} />
                        )}
                    </Flex>
                </GridItem>
                
                {/* Score or time */}
                <GridItem>
                    {match.fixture?.status?.short === 'NS' ? (
                        <Text fontSize="sm" color={secondaryTextColor} fontWeight="medium">
                            {formatTime(match.fixture?.date)}
                        </Text>
                    ) : (
                        <HStack spacing={2}>
                            <Text fontSize="2xl" fontWeight="bold" color={textColor}>
                                {match.goals?.home ?? 0}
                            </Text>
                            <Text fontSize="lg" color={secondaryTextColor}>-</Text>
                            <Text fontSize="2xl" fontWeight="bold" color={textColor}>
                                {match.goals?.away ?? 0}
                            </Text>
                        </HStack>
                    )}
                </GridItem>
                
                {/* Away team */}
                <GridItem>
                    <Flex align="center">
                        {match.teams?.away?.logo && (
                            <Image src={match.teams.away.logo} boxSize="30px" mr={2} />
                        )}
                        <Text fontSize="md" fontWeight="semibold" color={textColor}>
                            {match.teams?.away?.name}
                        </Text>
                    </Flex>
                </GridItem>
            </Grid>
            
            {/* Scorers, Cards, Substitutions - ONLY for finished matches */}
            {match.fixture?.status?.short === 'FT' && match.events && match.events.length > 0 && (
                <Box mt={4} pt={4} borderTop="1px solid" borderColor={borderColor}>
                    <Text fontSize="xs" color={secondaryTextColor} mb={2} fontWeight="semibold">
                        MATCH EVENTS
                    </Text>
                    <VStack align="stretch" spacing={1}>
                        {match.events
                            .filter(e => e.type === 'Goal')
                            .map((event, idx) => (
                                <Flex key={idx} justify="space-between" align="center" fontSize="xs">
                                    <HStack spacing={1}>
                                        <Text color={textColor} fontWeight="medium">
                                            ⚽ {event.player}
                                        </Text>
                                        <Text color={secondaryTextColor}>
                                            ({event.time}')
                                        </Text>
                                    </HStack>
                                    <Text color={secondaryTextColor} fontSize="xs">
                                        {event.team}
                                    </Text>
                                </Flex>
                            ))}
                        {match.events
                            .filter(e => e.type === 'Card')
                            .map((event, idx) => (
                                <Flex key={`card-${idx}`} justify="space-between" align="center" fontSize="xs">
                                    <HStack spacing={1}>
                                        <Text color={event.detail === 'Red Card' ? 'red.400' : 'yellow.400'} fontWeight="medium">
                                            {event.detail === 'Red Card' ? '🟥' : '🟨'} {event.player}
                                        </Text>
                                        <Text color={secondaryTextColor}>
                                            ({event.time}')
                                        </Text>
                                    </HStack>
                                    <Text color={secondaryTextColor} fontSize="xs">
                                        {event.team}
                                    </Text>
                                </Flex>
                            ))}
                        {match.events
                            .filter(e => e.type === 'Substitution')
                            .slice(0, 3) // Show max 3 substitutions
                            .map((event, idx) => (
                                <Flex key={`sub-${idx}`} justify="space-between" align="center" fontSize="xs">
                                    <HStack spacing={1}>
                                        <Text color={textColor} fontWeight="medium">
                                            🔄 {event.player}
                                        </Text>
                                        {event.playerOut && (
                                            <Text color={secondaryTextColor} fontSize="xs">
                                                (for {event.playerOut})
                                            </Text>
                                        )}
                                        <Text color={secondaryTextColor}>
                                            ({event.time}')
                                        </Text>
                                    </HStack>
                                    <Text color={secondaryTextColor} fontSize="xs">
                                        {event.team}
                                    </Text>
                                </Flex>
                            ))}
                    </VStack>
                </Box>
            )}
        </Box>
    )
    
    return (
        <Container maxW="800px" py={6}>
            {/* Header */}
            <Flex align="center" justify="space-between" mb={6}>
                <HStack spacing={3}>
                    <FootballIcon size="40px" />
                    <VStack align="start" spacing={0}>
                        <Heading size="lg">Football Live</Heading>
                        <Text fontSize="sm" color={secondaryTextColor}>
                            Live scores & updates
                        </Text>
                    </VStack>
                </HStack>
            </Flex>
            
            {!user && (
                <Box
                    bg="blue.50"
                    borderRadius="lg"
                    p={4}
                    mb={4}
                    border="1px solid"
                    borderColor="blue.200"
                >
                    <Text color="blue.700" fontSize="sm">
                        💡 Sign in to save preferences and use all features.
                    </Text>
                </Box>
            )}
            
            {loading ? (
                <Flex justify="center" py={10}>
                    <Spinner size="xl" />
                </Flex>
            ) : (
                <Tabs variant="soft-rounded" colorScheme="blue">
                    <TabList mb={4}>
                        <Tab>
                            🔴 Live {liveMatches.length > 0 && `(${liveMatches.length})`}
                        </Tab>
                        <Tab>
                            📅 Upcoming {upcomingMatches.length > 0 && `(${upcomingMatches.length})`}
                        </Tab>
                        <Tab>
                            ✅ Finished {finishedMatches.length > 0 && `(${finishedMatches.length})`}
                        </Tab>
                    </TabList>
                    
                    <TabPanels>
                        {/* Live matches */}
                        <TabPanel px={0}>
                            {liveMatches.length > 0 ? (
                                liveMatches.map(match => (
                                    <MatchCard key={match._id} match={match} showStatus={true} />
                                ))
                            ) : (
                                <Box textAlign="center" py={10}>
                                    <Text fontSize="lg" color={secondaryTextColor}>
                                        ⚽ No live matches at the moment
                                    </Text>
                                </Box>
                            )}
                        </TabPanel>
                        
                        {/* Upcoming matches */}
                        <TabPanel px={0}>
                            {/* Date selector */}
                            <Flex 
                                overflowX="auto" 
                                mb={4} 
                                pb={2}
                                gap={2}
                                css={{
                                    '&::-webkit-scrollbar': { height: '6px' },
                                    '&::-webkit-scrollbar-thumb': { background: '#888', borderRadius: '3px' }
                                }}
                            >
                                {getNext7Days().map(day => (
                                    <Box
                                        key={day.dateString}
                                        onClick={() => setSelectedDate(day.dateString)}
                                        cursor="pointer"
                                        minW="80px"
                                        textAlign="center"
                                        py={3}
                                        px={4}
                                        borderRadius="lg"
                                        bg={selectedDate === day.dateString ? 'blue.500' : bgColor}
                                        color={selectedDate === day.dateString ? 'white' : textColor}
                                        border="1px solid"
                                        borderColor={selectedDate === day.dateString ? 'blue.500' : borderColor}
                                        transition="all 0.2s"
                                        _hover={{
                                            bg: selectedDate === day.dateString ? 'blue.600' : useColorModeValue('gray.50', 'gray.700'),
                                            transform: 'translateY(-2px)',
                                            shadow: 'md'
                                        }}
                                    >
                                        <Text fontSize="xs" fontWeight="medium" mb={1}>
                                            {day.dayName}
                                        </Text>
                                        <Text fontSize="2xl" fontWeight="bold">
                                            {day.dayNumber}
                                        </Text>
                                        <Text fontSize="xs" mt={1}>
                                            {day.monthName}
                                        </Text>
                                        {day.isToday && (
                                            <Badge 
                                                mt={1} 
                                                size="sm" 
                                                colorScheme={selectedDate === day.dateString ? 'whiteAlpha' : 'blue'}
                                                fontSize="9px"
                                            >
                                                Today
                                            </Badge>
                                        )}
                                    </Box>
                                ))}
                            </Flex>
                            
                            {/* Filtered matches */}
                            {(() => {
                                const filteredMatches = filterMatchesByDate(upcomingMatches)
                                return filteredMatches.length > 0 ? (
                                    <>
                                        <Text fontSize="sm" color={secondaryTextColor} mb={3}>
                                            {filteredMatches.length} match{filteredMatches.length !== 1 ? 'es' : ''} on {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                                        </Text>
                                        {filteredMatches.map(match => (
                                            <MatchCard key={match._id} match={match} showStatus={false} />
                                        ))}
                                    </>
                                ) : (
                                    <Box textAlign="center" py={10}>
                                        <Text fontSize="lg" color={secondaryTextColor}>
                                            📭 No upcoming matches on this day
                                        </Text>
                                    </Box>
                                )
                            })()}
                        </TabPanel>
                        
                        {/* Finished matches */}
                        <TabPanel px={0}>
                            {finishedMatches.length > 0 ? (
                                finishedMatches.map(match => (
                                    <MatchCard key={match._id} match={match} showStatus={true} />
                                ))
                            ) : (
                                <Box textAlign="center" py={10}>
                                    <Text fontSize="lg" color={secondaryTextColor}>
                                        🏁 No finished matches today
                                    </Text>
                                </Box>
                            )}
                        </TabPanel>
                    </TabPanels>
                </Tabs>
            )}
        </Container>
    )
}

export default FootballPage

