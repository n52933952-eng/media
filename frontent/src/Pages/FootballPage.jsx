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
    Button,
    useColorModeValue,
    VStack,
    HStack,
    Divider,
    Grid,
    GridItem
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const FootballPage = () => {
    const { user } = useContext(UserContext)
    const [liveMatches, setLiveMatches] = useState([])
    const [upcomingMatches, setUpcomingMatches] = useState([])
    const [finishedMatches, setFinishedMatches] = useState([])
    const [loading, setLoading] = useState(true)
    const [isFollowing, setIsFollowing] = useState(false)
    const [followLoading, setFollowLoading] = useState(false)
    const [footballAccountId, setFootballAccountId] = useState(null)
    const [fetchingMatches, setFetchingMatches] = useState(false)
    
    const showToast = useShowToast()
    
    const bgColor = useColorModeValue('white', 'gray.800')
    const borderColor = useColorModeValue('gray.200', 'gray.700')
    const liveColor = useColorModeValue('red.500', 'red.400')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    
    // Check if user follows Football account
    useEffect(() => {
        const checkFollowStatus = async () => {
            try {
                const res = await fetch(
                    `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/Football`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && user && data._id) {
                    setFootballAccountId(data._id)
                    setIsFollowing(user.following?.includes(data._id))
                }
            } catch (error) {
                console.error('Error checking follow status:', error)
            }
        }
        
        if (user) {
            checkFollowStatus()
        }
    }, [user])
    
    // Fetch matches
    useEffect(() => {
        const fetchMatches = async () => {
            try {
                console.log('⚽ [FootballPage] Starting to fetch matches...')
                setLoading(true)
                
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                
                // Fetch live matches (today - includes IN_PLAY, PAUSED status)
                console.log('⚽ [FootballPage] Fetching live matches (today)...')
                const today = new Date().toISOString().split('T')[0]
                const liveRes = await fetch(
                    `${baseUrl}/api/football/matches?status=live&date=${today}`,
                    { credentials: 'include' }
                )
                const liveData = await liveRes.json()
                console.log('⚽ [FootballPage] Live matches response:', { status: liveRes.status, ok: liveRes.ok, data: liveData })
                
                // Fetch upcoming matches (next 7 days - no date filter, backend handles it)
                console.log('⚽ [FootballPage] Fetching upcoming matches (next 7 days)')
                const upcomingRes = await fetch(
                    `${baseUrl}/api/football/matches?status=upcoming`,
                    { credentials: 'include' }
                )
                const upcomingData = await upcomingRes.json()
                console.log('⚽ [FootballPage] Upcoming matches response:', { status: upcomingRes.status, ok: upcomingRes.ok, data: upcomingData })
                
                // Fetch finished matches (last 3 days - no date filter, backend handles it)
                console.log('⚽ [FootballPage] Fetching finished matches (last 3 days)')
                const finishedRes = await fetch(
                    `${baseUrl}/api/football/matches?status=finished`,
                    { credentials: 'include' }
                )
                const finishedData = await finishedRes.json()
                console.log('⚽ [FootballPage] Finished matches response:', { status: finishedRes.status, ok: finishedRes.ok, data: finishedData })
                
                if (liveRes.ok) {
                    console.log('⚽ [FootballPage] Setting live matches:', liveData.matches?.length || 0)
                    setLiveMatches(liveData.matches || [])
                } else {
                    console.error('⚽ [FootballPage] Live matches request failed:', liveData)
                }
                
                if (upcomingRes.ok) {
                    console.log('⚽ [FootballPage] Setting upcoming matches:', upcomingData.matches?.length || 0)
                    setUpcomingMatches(upcomingData.matches || [])
                } else {
                    console.error('⚽ [FootballPage] Upcoming matches request failed:', upcomingData)
                }
                
                if (finishedRes.ok) {
                    console.log('⚽ [FootballPage] Setting finished matches:', finishedData.matches?.length || 0)
                    setFinishedMatches(finishedData.matches || [])
                } else {
                    console.error('⚽ [FootballPage] Finished matches request failed:', finishedData)
                }
                
            } catch (error) {
                console.error('⚽ [FootballPage] Error fetching matches:', error)
                showToast('Error', 'Failed to load matches', 'error')
            } finally {
                setLoading(false)
                console.log('⚽ [FootballPage] Finished fetching matches')
            }
        }
        
        fetchMatches()
        
        // Refresh every 2 minutes for live updates
        const interval = setInterval(fetchMatches, 120000)
        return () => clearInterval(interval)
    }, [showToast])
    
    // Follow/Unfollow Football account
    const handleFollowToggle = async () => {
        if (!footballAccountId) {
            showToast('Error', 'Football account not found', 'error')
            return
        }
        
        try {
            setFollowLoading(true)
            
            const res = await fetch(
                `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/follow/${footballAccountId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                }
            )
            
            const data = await res.json()
            
            if (res.ok) {
                setIsFollowing(!isFollowing)
                showToast(
                    'Success',
                    isFollowing ? 'Unfollowed Football channel' : 'Following Football channel! You\'ll now see updates in your feed',
                    'success'
                )
            } else {
                showToast('Error', data.error || 'Failed to update follow status', 'error')
            }
        } catch (error) {
            console.error('Error toggling follow:', error)
            showToast('Error', 'Failed to update follow status', 'error')
        } finally {
            setFollowLoading(false)
        }
    }
    
    // Fetch all matches from all leagues (manual trigger)
    const handleFetchAllMatches = async () => {
        try {
            setFetchingMatches(true)
            showToast('Info', 'Fetching matches from all leagues... This will take ~40 seconds', 'info')
            
            const res = await fetch(
                `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/football/fetch/manual`,
                {
                    method: 'POST',
                    credentials: 'include'
                }
            )
            
            const data = await res.json()
            
            if (res.ok) {
                showToast(
                    'Success',
                    `Fetched ${data.totalFetched} matches from ${data.leaguesFetched} leagues!`,
                    'success'
                )
                // Reload matches
                window.location.reload()
            } else {
                showToast('Error', data.error || 'Failed to fetch matches', 'error')
            }
        } catch (error) {
            console.error('Error fetching matches:', error)
            showToast('Error', 'Failed to fetch matches', 'error')
        } finally {
            setFetchingMatches(false)
        }
    }
    
    // Format time
    const formatTime = (date) => {
        const matchDate = new Date(date)
        return matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
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
                                {match.goals?.home ?? '-'}
                            </Text>
                            <Text fontSize="lg" color={secondaryTextColor}>-</Text>
                            <Text fontSize="2xl" fontWeight="bold" color={textColor}>
                                {match.goals?.away ?? '-'}
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
            
            {/* Match status */}
            {showStatus && match.fixture?.status?.short === 'FT' && (
                <Text mt={2} fontSize="sm" color={secondaryTextColor} textAlign="center">
                    Full Time
                </Text>
            )}
        </Box>
    )
    
    return (
        <Container maxW="800px" py={6}>
            {/* Header */}
            <Flex align="center" justify="space-between" mb={6}>
                <HStack spacing={3}>
                    <Image
                        src="https://cdn-icons-png.flaticon.com/512/53/53283.png"
                        boxSize="40px"
                    />
                    <VStack align="start" spacing={0}>
                        <Heading size="lg">Football Live</Heading>
                        <Text fontSize="sm" color={secondaryTextColor}>
                            Live scores & updates
                        </Text>
                    </VStack>
                </HStack>
                
                <HStack spacing={2}>
                    <Button
                        onClick={handleFetchAllMatches}
                        isLoading={fetchingMatches}
                        colorScheme="green"
                        size="sm"
                    >
                        ⚽ Load All Leagues
                    </Button>
                    {user && (
                        <Button
                            onClick={handleFollowToggle}
                            isLoading={followLoading}
                            colorScheme={isFollowing ? 'gray' : 'blue'}
                            size="sm"
                        >
                            {isFollowing ? 'Following' : 'Follow'}
                        </Button>
                    )}
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
                        💡 Follow the Football channel to get live match updates in your feed!
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
                            {upcomingMatches.length > 0 ? (
                                upcomingMatches.map(match => (
                                    <MatchCard key={match._id} match={match} showStatus={false} />
                                ))
                            ) : (
                                <Box textAlign="center" py={10}>
                                    <Text fontSize="lg" color={secondaryTextColor}>
                                        📭 No upcoming matches today
                                    </Text>
                                </Box>
                            )}
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

