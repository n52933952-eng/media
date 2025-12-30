import React, { useState, useEffect } from 'react'
import { Box, Flex, Text, Image, VStack, Badge, Spinner, useColorModeValue } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'

const FootballWidget = () => {
    const [upcomingMatches, setUpcomingMatches] = useState([])
    const [loading, setLoading] = useState(true)
    
    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const hoverBg = useColorModeValue('gray.50', 'gray.700')
    
    useEffect(() => {
        const fetchUpcomingMatches = async () => {
            try {
                setLoading(true)
                const today = new Date().toISOString().split('T')[0]
                
                const res = await fetch(
                    `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/football/matches?status=upcoming&date=${today}`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && data.matches) {
                    // Get top 5 matches for today
                    setUpcomingMatches(data.matches.slice(0, 5))
                }
            } catch (error) {
                console.error('Error fetching matches:', error)
            } finally {
                setLoading(false)
            }
        }
        
        fetchUpcomingMatches()
    }, [])
    
    const formatTime = (date) => {
        const matchDate = new Date(date)
        return matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    
    return (
        <Box
            position="sticky"
            top="80px"
            bg={bgColor}
            borderRadius="md"
            border="1px solid"
            borderColor={borderColor}
            overflow="hidden"
        >
            {/* Header - clickable to go to Football page */}
            <RouterLink to="/football">
                <Flex
                    align="center"
                    justify="space-between"
                    p={4}
                    bg={useColorModeValue('blue.50', 'blue.900')}
                    cursor="pointer"
                    _hover={{ bg: useColorModeValue('blue.100', 'blue.800') }}
                    transition="all 0.2s"
                >
                    <Flex align="center" gap={2}>
                        <Image
                            src="https://cdn-icons-png.flaticon.com/512/53/53283.png"
                            boxSize="32px"
                        />
                        <VStack align="start" spacing={0}>
                            <Text fontWeight="bold" fontSize="md" color={textColor}>
                                Football Live
                            </Text>
                            <Text fontSize="xs" color={secondaryTextColor}>
                                Live scores & updates
                            </Text>
                        </VStack>
                    </Flex>
                    <Text fontSize="xl">⚽</Text>
                </Flex>
            </RouterLink>
            
            {/* Matches */}
            <Box p={3}>
                {loading ? (
                    <Flex justify="center" py={6}>
                        <Spinner size="sm" />
                    </Flex>
                ) : upcomingMatches.length > 0 ? (
                    <VStack spacing={2} align="stretch">
                        <Text fontSize="xs" fontWeight="bold" color={secondaryTextColor} mb={1}>
                            TODAY'S MATCHES
                        </Text>
                        {upcomingMatches.map(match => (
                            <RouterLink key={match._id} to="/football">
                                <Box
                                    p={2}
                                    borderRadius="md"
                                    border="1px solid"
                                    borderColor={borderColor}
                                    _hover={{ bg: hoverBg, borderColor: 'blue.400' }}
                                    transition="all 0.2s"
                                    cursor="pointer"
                                >
                                    {/* League */}
                                    <Flex align="center" mb={1}>
                                        <Badge colorScheme="blue" fontSize="8px">
                                            {match.league?.name || 'Football'}
                                        </Badge>
                                    </Flex>
                                    
                                    {/* Teams */}
                                    <VStack spacing={1} align="stretch" fontSize="xs">
                                        <Flex align="center" justify="space-between">
                                            <Flex align="center" gap={1} flex={1}>
                                                {match.teams?.home?.logo && (
                                                    <Image src={match.teams.home.logo} boxSize="16px" />
                                                )}
                                                <Text 
                                                    fontWeight="medium" 
                                                    color={textColor}
                                                    noOfLines={1}
                                                    fontSize="11px"
                                                >
                                                    {match.teams?.home?.name}
                                                </Text>
                                            </Flex>
                                        </Flex>
                                        
                                        <Flex align="center" justify="space-between">
                                            <Flex align="center" gap={1} flex={1}>
                                                {match.teams?.away?.logo && (
                                                    <Image src={match.teams.away.logo} boxSize="16px" />
                                                )}
                                                <Text 
                                                    fontWeight="medium" 
                                                    color={textColor}
                                                    noOfLines={1}
                                                    fontSize="11px"
                                                >
                                                    {match.teams?.away?.name}
                                                </Text>
                                            </Flex>
                                        </Flex>
                                    </VStack>
                                    
                                    {/* Time */}
                                    <Text fontSize="10px" color={secondaryTextColor} mt={1} textAlign="right">
                                        ⏰ {formatTime(match.fixture?.date)}
                                    </Text>
                                </Box>
                            </RouterLink>
                        ))}
                        
                        {/* View all link */}
                        <RouterLink to="/football">
                            <Text
                                fontSize="xs"
                                color="blue.500"
                                textAlign="center"
                                mt={2}
                                fontWeight="medium"
                                _hover={{ textDecoration: 'underline' }}
                            >
                                View all matches →
                            </Text>
                        </RouterLink>
                    </VStack>
                ) : (
                    <RouterLink to="/football">
                        <Box textAlign="center" py={6}>
                            <Text fontSize="sm" color={secondaryTextColor}>
                                📅 No matches today
                            </Text>
                            <Text fontSize="xs" color="blue.500" mt={2} _hover={{ textDecoration: 'underline' }}>
                                View upcoming →
                            </Text>
                        </Box>
                    </RouterLink>
                )}
            </Box>
        </Box>
    )
}

export default FootballWidget

