import React, { useContext } from 'react'
import { Box, Button, Flex, Text, useColorModeValue } from '@chakra-ui/react'
import { SocketContext } from '../context/SocketContext'
import { FaPhoneSlash, FaPhone } from 'react-icons/fa'

const VideoCall = () => {
    const {
        callAccepted,
        myVideo,
        userVideo,
        callEnded,
        stream,
        call,
        answerCall,
        leaveCall
    } = useContext(SocketContext)

    const modalBg = useColorModeValue('white', 'gray.800')
    const modalText = useColorModeValue('black', 'white')

    return (
        <>
            {/* Incoming call notification - responsive */}
            {call.isReceivingCall && !callAccepted && (
                <Box
                    position="fixed"
                    top="50%"
                    left="50%"
                    transform="translate(-50%, -50%)"
                    bg={modalBg}
                    p={{ base: 4, md: 6 }}
                    borderRadius="lg"
                    zIndex={1000}
                    boxShadow="xl"
                    minW={{ base: "280px", md: "300px" }}
                    maxW={{ base: "90vw", md: "400px" }}
                    mx={{ base: 4, md: 0 }}
                >
                    <Text 
                        fontSize={{ base: "md", md: "lg" }} 
                        mb={4} 
                        textAlign="center" 
                        color={modalText}
                    >
                        {call.name} is calling...
                    </Text>
                    <Flex 
                        gap={3} 
                        justifyContent="center"
                        direction={{ base: "column", sm: "row" }}
                    >
                        <Button
                            colorScheme="green"
                            leftIcon={<FaPhone />}
                            onClick={answerCall}
                            size={{ base: "md", md: "lg" }}
                            w={{ base: "full", sm: "auto" }}
                        >
                            Answer
                        </Button>
                        <Button
                            colorScheme="red"
                            leftIcon={<FaPhoneSlash />}
                            onClick={leaveCall}
                            size={{ base: "md", md: "lg" }}
                            w={{ base: "full", sm: "auto" }}
                        >
                            Decline
                        </Button>
                    </Flex>
                </Box>
            )}

            {/* Video call UI */}
            {callAccepted && !callEnded && stream && (
                <Box
                    position="fixed"
                    top="0"
                    left="0"
                    right="0"
                    bottom="0"
                    bg="black"
                    zIndex={999}
                >
                    {/* Remote video (main) */}
                    <Box
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        bottom="0"
                    >
                        <video
                            ref={userVideo}
                            autoPlay
                            playsInline
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                            }}
                        />
                    </Box>

                    {/* Local video (responsive size) */}
                    <Box
                        position="absolute"
                        bottom={{ base: "70px", md: "80px" }}
                        right={{ base: "10px", md: "20px" }}
                        w={{ base: "120px", md: "200px" }}
                        h={{ base: "90px", md: "150px" }}
                        border={{ base: "2px", md: "3px" }}
                        borderColor="white"
                        borderRadius="md"
                        overflow="hidden"
                        bg="gray.800"
                    >
                        <video
                            ref={myVideo}
                            autoPlay
                            muted
                            playsInline
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                            }}
                        />
                    </Box>

                    {/* End call button - responsive */}
                    <Flex
                        position="absolute"
                        bottom={{ base: "10px", md: "20px" }}
                        left="50%"
                        transform="translateX(-50%)"
                        gap={3}
                    >
                        <Button
                            colorScheme="red"
                            size={{ base: "md", md: "lg" }}
                            leftIcon={<FaPhoneSlash />}
                            onClick={leaveCall}
                            borderRadius="full"
                            px={{ base: 6, md: 8 }}
                            fontSize={{ base: "sm", md: "md" }}
                        >
                            End Call
                        </Button>
                    </Flex>
                </Box>
            )}
        </>
    )
}

export default VideoCall
