import React, { useState, useEffect } from 'react'
import { Box, Container, Heading, Text, Flex, Image, Spinner, useColorModeValue, SimpleGrid, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, useDisclosure } from '@chakra-ui/react'

const KidsPage = () => {
    const [cartoons, setCartoons] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedCartoon, setSelectedCartoon] = useState(null)
    const { isOpen, onOpen, onClose } = useDisclosure()

    const bgColor = useColorModeValue('gray.50', 'gray.900')
    const cardBg = useColorModeValue('white', 'gray.800')
    const borderColor = useColorModeValue('gray.200', 'gray.700')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    useEffect(() => {
        fetchCartoons()
    }, [])

    const fetchCartoons = async () => {
        try {
            setLoading(true)
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const res = await fetch(`${baseUrl}/api/kids/cartoons`)
            const data = await res.json()

            if (res.ok) {
                setCartoons(data.cartoons || [])
            } else {
                console.error('Failed to fetch cartoons:', data.error)
            }
        } catch (error) {
            console.error('Error fetching cartoons:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleCartoonClick = (cartoon) => {
        setSelectedCartoon(cartoon)
        onOpen()
    }

    return (
        <Box bg={bgColor} minH="100vh" py={8}>
            <Container maxW="1200px">
                <Flex align="center" mb={8} justifyContent="center">
                    <Image
                        src="https://img.icons8.com/fluency/96/000000/kids.png"
                        boxSize="60px"
                        mr={3}
                    />
                    <Heading size="xl" color={textColor}>Kids Movies 🎬</Heading>
                </Flex>

                <Text fontSize="lg" color={secondaryTextColor} textAlign="center" mb={8}>
                    Click on any cartoon to watch! Enjoy! 🍿
                </Text>

                {loading ? (
                    <Flex justifyContent="center" py={10}>
                        <Spinner size="xl" />
                    </Flex>
                ) : cartoons.length === 0 ? (
                    <Text textAlign="center" color={secondaryTextColor} py={10}>
                        No cartoons available right now. Check back soon!
                    </Text>
                ) : (
                    <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={6}>
                        {cartoons.map((cartoon, index) => (
                            <Box
                                key={index}
                                bg={cardBg}
                                borderRadius="lg"
                                border="1px solid"
                                borderColor={borderColor}
                                overflow="hidden"
                                cursor="pointer"
                                onClick={() => handleCartoonClick(cartoon)}
                                _hover={{ shadow: 'lg', transform: 'translateY(-4px)' }}
                                transition="all 0.3s"
                            >
                                <Image
                                    src={cartoon.thumbnail}
                                    alt={cartoon.title}
                                    objectFit="cover"
                                    height="200px"
                                    width="100%"
                                />
                                <Box p={4}>
                                    <Text fontSize="md" fontWeight="bold" color={textColor} noOfLines={2}>
                                        {cartoon.title}
                                    </Text>
                                    <Text fontSize="sm" color={secondaryTextColor} mt={2}>
                                        Click to watch 🎬
                                    </Text>
                                </Box>
                            </Box>
                        ))}
                    </SimpleGrid>
                )}

                {/* Video Player Modal */}
                <Modal isOpen={isOpen} onClose={onClose} size="6xl" isCentered>
                    <ModalOverlay />
                    <ModalContent bg={cardBg}>
                        <ModalHeader color={textColor}>{selectedCartoon?.title}</ModalHeader>
                        <ModalCloseButton />
                        <ModalBody pb={6}>
                            {selectedCartoon && (
                                <Box position="relative" paddingBottom="56.25%" height="0" overflow="hidden">
                                    <iframe
                                        src={`https://www.youtube.com/embed/${selectedCartoon.id}?autoplay=1`}
                                        title={selectedCartoon.title}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                            border: 'none'
                                        }}
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                        allowFullScreen
                                    />
                                </Box>
                            )}
                        </ModalBody>
                    </ModalContent>
                </Modal>
            </Container>
        </Box>
    )
}

export default KidsPage

