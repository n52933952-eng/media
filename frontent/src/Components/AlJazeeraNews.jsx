import React, { useState, useEffect } from 'react'
import { 
    Box, 
    VStack, 
    Text, 
    Image, 
    Flex, 
    Spinner, 
    Link as ChakraLink,
    useColorModeValue 
} from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'

const AlJazeeraNews = () => {
    const [articles, setArticles] = useState([])
    const [loading, setLoading] = useState(true)
    
    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('gray.200', '#2d2d2d')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const hoverBg = useColorModeValue('gray.50', 'gray.700')
    
    // Fetch news articles
    useEffect(() => {
        const fetchNews = async () => {
            try {
                setLoading(true)
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                const res = await fetch(
                    `${baseUrl}/api/news/articles?limit=5`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && data.articles) {
                    setArticles(data.articles)
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
        <Box
            position="sticky"
            top="80px"
            bg={bgColor}
            borderRadius="md"
            p={4}
            border="1px solid"
            borderColor={borderColor}
            maxW="280px"
            mt={4}
        >
            {/* Header - Clickable to go to news page */}
            <RouterLink to="/news">
                <Flex 
                    align="center" 
                    mb={3} 
                    gap={2}
                    cursor="pointer"
                    _hover={{ opacity: 0.8 }}
                    transition="opacity 0.2s"
                >
                    <Image 
                        src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png"
                        h="20px"
                        alt="Al Jazeera"
                    />
                    <Text fontSize="sm" fontWeight="bold" color={textColor}>
                        Latest News
                    </Text>
                </Flex>
            </RouterLink>
            
            {/* Loading */}
            {loading ? (
                <Flex justify="center" py={6}>
                    <Spinner size="sm" />
                </Flex>
            ) : articles.length > 0 ? (
                <VStack spacing={3} align="stretch">
                    {articles.slice(0, 3).map((article, index) => (
                        <ChakraLink
                            key={index}
                            href={article.url}
                            isExternal
                            _hover={{ textDecoration: 'none' }}
                        >
                            <Box
                                p={2}
                                borderRadius="md"
                                border="1px solid"
                                borderColor={borderColor}
                                _hover={{ bg: hoverBg }}
                                transition="all 0.2s"
                                cursor="pointer"
                            >
                                {/* Article Title */}
                                <Text 
                                    fontSize="xs" 
                                    fontWeight="semibold" 
                                    color={textColor}
                                    noOfLines={2}
                                    mb={1}
                                >
                                    {article.title}
                                </Text>
                                
                                {/* Published Time */}
                                <Text fontSize="xs" color={secondaryTextColor}>
                                    {article.publishedAt && 
                                        formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
                                    }
                                </Text>
                            </Box>
                        </ChakraLink>
                    ))}
                    
                    {/* View All Link */}
                    <RouterLink to="/news">
                        <Text 
                            fontSize="xs" 
                            color="blue.500" 
                            textAlign="center"
                            cursor="pointer"
                            _hover={{ textDecoration: 'underline' }}
                        >
                            View all news →
                        </Text>
                    </RouterLink>
                </VStack>
            ) : (
                <RouterLink to="/news">
                    <Box 
                        textAlign="center"
                        cursor="pointer"
                        _hover={{ opacity: 0.8 }}
                    >
                        <Text fontSize="sm" color={secondaryTextColor}>
                            No news available
                        </Text>
                        <Text fontSize="xs" color="blue.500" mt={2}>
                            Click to view news page →
                        </Text>
                    </Box>
                </RouterLink>
            )}
            
            {/* Footer */}
            <Text fontSize="xs" color={secondaryTextColor} textAlign="center" mt={3}>
                Powered by Al Jazeera English
            </Text>
        </Box>
    )
}

export default AlJazeeraNews

