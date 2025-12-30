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
            {/* Header */}
            <Flex align="center" mb={3} gap={2}>
                <Image 
                    src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png"
                    h="20px"
                    alt="Al Jazeera"
                />
                <Text fontSize="sm" fontWeight="bold" color={textColor}>
                    Latest News
                </Text>
            </Flex>
            
            {/* Loading */}
            {loading ? (
                <Flex justify="center" py={6}>
                    <Spinner size="sm" />
                </Flex>
            ) : articles.length > 0 ? (
                <VStack spacing={3} align="stretch">
                    {articles.map((article, index) => (
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
                                {/* Article Image */}
                                {article.urlToImage && (
                                    <Image
                                        src={article.urlToImage}
                                        w="full"
                                        h="100px"
                                        objectFit="cover"
                                        borderRadius="md"
                                        mb={2}
                                        fallbackSrc="https://via.placeholder.com/280x100?text=Al+Jazeera"
                                    />
                                )}
                                
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
                </VStack>
            ) : (
                <Text fontSize="sm" color={secondaryTextColor} textAlign="center">
                    No news available
                </Text>
            )}
            
            {/* Footer */}
            <Text fontSize="xs" color={secondaryTextColor} textAlign="center" mt={3}>
                Powered by Al Jazeera English
            </Text>
        </Box>
    )
}

export default AlJazeeraNews

