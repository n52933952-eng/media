import React, { useState, useEffect } from 'react'
import {
    Box,
    Container,
    Heading,
    Text,
    Flex,
    Image,
    Spinner,
    VStack,
    Link as ChakraLink,
    useColorModeValue,
    Grid,
    GridItem
} from '@chakra-ui/react'
import { formatDistanceToNow } from 'date-fns'

const NewsPage = () => {
    const [articles, setArticles] = useState([])
    const [loading, setLoading] = useState(true)
    
    const bgColor = useColorModeValue('white', 'gray.800')
    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('gray.200', 'gray.700')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    
    // Fetch news articles
    useEffect(() => {
        const fetchNews = async () => {
            try {
                setLoading(true)
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                const res = await fetch(
                    `${baseUrl}/api/news/articles?limit=20`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && data.articles) {
                    setArticles(data.articles)
                } else {
                    console.error('Failed to fetch news:', data)
                }
            } catch (error) {
                console.error('Error fetching news:', error)
            } finally {
                setLoading(false)
            }
        }
        
        fetchNews()
        
        // Refresh every 10 minutes
        const interval = setInterval(fetchNews, 600000)
        return () => clearInterval(interval)
    }, [])
    
    return (
        <Container maxW="1200px" py={6}>
            {/* Header */}
            <Flex align="center" justify="space-between" mb={6}>
                <Flex align="center" gap={3}>
                    <Image
                        src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png"
                        h="32px"
                        alt="Al Jazeera"
                    />
                    <VStack align="start" spacing={0}>
                        <Heading size="lg">Al Jazeera English</Heading>
                        <Text fontSize="sm" color={secondaryTextColor}>
                            🔴 Live stream & latest news
                        </Text>
                    </VStack>
                </Flex>
            </Flex>
            
            {/* Live Stream Embed */}
            <Box 
                mb={8} 
                borderRadius="lg" 
                overflow="hidden" 
                border="1px solid"
                borderColor={borderColor}
                bg={cardBg}
            >
                <Box position="relative" paddingBottom="56.25%" height="0">
                    <iframe
                        src="https://www.youtube.com/embed/gCNeDWCI0vo?autoplay=1&mute=0"
                        title="Al Jazeera English Live"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none'
                        }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                </Box>
                <Box p={3} borderTop="1px solid" borderColor={borderColor}>
                    <Text fontSize="sm" fontWeight="bold" color={textColor}>
                        🔴 Al Jazeera English - Live Stream
                    </Text>
                    <Text fontSize="xs" color={secondaryTextColor}>
                        24/7 news coverage from around the world
                    </Text>
                </Box>
            </Box>
            
            {/* Latest Articles Heading */}
            <Heading size="md" mb={4}>Latest Articles</Heading>
            
            {/* Loading */}
            {loading ? (
                <Flex justify="center" align="center" minH="400px">
                    <Spinner size="xl" />
                </Flex>
            ) : articles.length > 0 ? (
                <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }} gap={6}>
                    {articles.map((article, index) => (
                        <ChakraLink
                            key={index}
                            href={article.url}
                            isExternal
                            _hover={{ textDecoration: 'none' }}
                        >
                            <GridItem>
                                <Box
                                    bg={cardBg}
                                    borderRadius="lg"
                                    border="1px solid"
                                    borderColor={borderColor}
                                    overflow="hidden"
                                    _hover={{ shadow: 'md', transform: 'translateY(-2px)' }}
                                    transition="all 0.2s"
                                    cursor="pointer"
                                    h="full"
                                >
                                    {/* Article Image */}
                                    {article.urlToImage ? (
                                        <Image
                                            src={article.urlToImage}
                                            w="full"
                                            h="200px"
                                            objectFit="cover"
                                            fallbackSrc="https://via.placeholder.com/400x200?text=Al+Jazeera+News"
                                        />
                                    ) : (
                                        <Box
                                            w="full"
                                            h="200px"
                                            bg="gray.700"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                        >
                                            <Image
                                                src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png"
                                                h="40px"
                                                opacity={0.5}
                                            />
                                        </Box>
                                    )}
                                    
                                    {/* Article Content */}
                                    <Box p={4}>
                                        {/* Title */}
                                        <Text 
                                            fontSize="md" 
                                            fontWeight="bold" 
                                            color={textColor}
                                            noOfLines={2}
                                            mb={2}
                                            minH="48px"
                                        >
                                            {article.title}
                                        </Text>
                                        
                                        {/* Description */}
                                        {article.description && (
                                            <Text 
                                                fontSize="sm" 
                                                color={secondaryTextColor}
                                                noOfLines={3}
                                                mb={2}
                                            >
                                                {article.description}
                                            </Text>
                                        )}
                                        
                                        {/* Meta Info */}
                                        <Flex justify="space-between" align="center" mt={3} pt={3} borderTop="1px solid" borderColor={borderColor}>
                                            <Text fontSize="xs" color={secondaryTextColor}>
                                                {article.author || 'Al Jazeera'}
                                            </Text>
                                            <Text fontSize="xs" color={secondaryTextColor}>
                                                {article.publishedAt && 
                                                    formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
                                                }
                                            </Text>
                                        </Flex>
                                    </Box>
                                </Box>
                            </GridItem>
                        </ChakraLink>
                    ))}
                </Grid>
            ) : (
                <Box textAlign="center" py={12}>
                    <Text fontSize="xl" color={secondaryTextColor}>
                        No articles available yet
                    </Text>
                    <Text fontSize="sm" color={secondaryTextColor} mt={2}>
                        News will appear here once fetched
                    </Text>
                </Box>
            )}
        </Container>
    )
}

export default NewsPage

