import React, { useState, useMemo, useCallback, useEffect, useContext, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import { Box, Heading, Text, Flex, VStack, HStack, Avatar, useColorModeValue, Button } from '@chakra-ui/react'
import { useParams, useNavigate } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'

// Import sounds
import moveSound from '../assets/p.mp3'
import captureSound from '../assets/k.mp3'
import checkSound from '../assets/c.mp3'
import gameStartSound from '../assets/start.mp3'

const ChessGamePage = () => {
    const { opponentId } = useParams()
    const navigate = useNavigate()
    const { socket } = useContext(SocketContext)
    const { user } = useContext(UserContext)
    const showToast = useShowToast()

    const [opponent, setOpponent] = useState(null)
    const [roomId, setRoomId] = useState(null)
    const [orientation, setOrientation] = useState('white')
    const [gameLive, setGameLive] = useState(false)
    const [showGameOverBox, setShowGameOverBox] = useState(false)
    const [over, setOver] = useState('')
    const [capturedWhite, setCapturedWhite] = useState([])
    const [capturedBlack, setCapturedBlack] = useState([])

    const bgColor = useColorModeValue('gray.50', '#101010')
    const cardBg = useColorModeValue('white', '#1a1a1a')
    const textColor = useColorModeValue('gray.800', 'white')

    // Create Chess instance
    const chess = useMemo(() => new Chess(), [])
    const [fen, setFen] = useState(chess.fen())

    // Sound effects
    const sounds = useRef({})

    useEffect(() => {
        sounds.current.move = new Audio(moveSound)
        sounds.current.capture = new Audio(captureSound)
        sounds.current.check = new Audio(checkSound)
        sounds.current.gameStart = new Audio(gameStartSound)
        
        sounds.current.move.load()
        sounds.current.capture.load()
        sounds.current.check.load()
        sounds.current.gameStart.load()
    }, [])

    const playSound = (type) => {
        const sound = sounds.current[type]
        if (sound) {
            sound.currentTime = 0
            sound.play().catch((err) => {
                console.error(`Failed to play ${type} sound:`, err)
            })
        }
    }

    // Fetch opponent info
    useEffect(() => {
        const fetchOpponent = async () => {
            try {
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                const res = await fetch(`${baseUrl}/api/user/profile/${opponentId}`, {
                    credentials: 'include'
                })
                const data = await res.json()
                if (res.ok) {
                    setOpponent(data)
                }
            } catch (error) {
                console.error('Error fetching opponent:', error)
            }
        }

        if (opponentId) {
            fetchOpponent()
        }
    }, [opponentId])

    // Socket: Accept chess challenge
    useEffect(() => {
        if (!socket) return

        socket.on('acceptChessChallenge', (data) => {
            setRoomId(data.roomId)
            setOrientation(data.yourColor || 'white')
            setGameLive(true)
            playSound('gameStart')
            showToast('Game Started! ♟️', 'Good luck!', 'success')
        })

        socket.on('opponentMove', (data) => {
            makeAMove(data.move)
        })

        socket.on('opponentResigned', () => {
            showToast('Victory! 🏆', 'Your opponent resigned', 'success')
            setOver('Your opponent resigned. You win!')
            setShowGameOverBox(true)
            setTimeout(handleGameEnd, 5000)
        })

        socket.on('chessGameCanceled', () => {
            showToast('Game Canceled', 'The game has been canceled', 'info')
            navigate('/home')
        })

        return () => {
            socket.off('acceptChessChallenge')
            socket.off('opponentMove')
            socket.off('opponentResigned')
            socket.off('chessGameCanceled')
        }
    }, [socket])

    const makeAMove = useCallback((move) => {
        try {
            const result = chess.move(move)
            if (result) {
                const newFen = chess.fen()
                setFen(newFen)

                // Track captured pieces
                if (result.captured) {
                    if (result.color === 'w') {
                        setCapturedBlack(prev => [...prev, result.captured])
                    } else {
                        setCapturedWhite(prev => [...prev, result.captured])
                    }
                }

                // Play appropriate sound
                if (chess.inCheck()) {
                    playSound('check')
                } else if (result.captured) {
                    playSound('capture')
                } else {
                    playSound('move')
                }

                // Check game over
                if (chess.isGameOver()) {
                    if (chess.isCheckmate()) {
                        const winner = chess.turn() === 'w' ? 'Black' : 'White'
                        setOver(`Checkmate! ${winner} wins!`)
                    } else if (chess.isDraw()) {
                        setOver('Draw!')
                    } else {
                        setOver('Game Over')
                    }
                    setShowGameOverBox(true)
                    setTimeout(handleGameEnd, 10000)
                }
            }
            return result
        } catch (e) {
            return null
        }
    }, [chess])

    function onDrop(sourceSquare, targetSquare) {
        // Only allow moves for current player
        if (chess.turn() !== orientation[0]) return false
        if (!gameLive) return false

        const moveData = {
            from: sourceSquare,
            to: targetSquare,
            color: chess.turn(),
            promotion: 'q'
        }

        const move = makeAMove(moveData)
        if (!move) return false

        // Send move to opponent via socket
        socket.emit('chessMove', {
            roomId,
            move: moveData,
            to: opponentId
        })

        return true
    }

    const handleResign = () => {
        if (!socket) return

        socket.emit('resignChess', {
            roomId,
            to: opponentId
        })

        showToast('Resigned', 'You resigned from the game', 'info')
        handleGameEnd()
    }

    const handleGameEnd = () => {
        chess.reset()
        setFen(chess.fen())
        setOver('')
        setShowGameOverBox(false)
        setCapturedWhite([])
        setCapturedBlack([])
        setGameLive(false)
        navigate('/home')
    }

    const getPieceUnicode = (type, color) => {
        const unicodeMap = {
            p: { white: '♙', black: '♟︎' },
            n: { white: '♘', black: '♞' },
            b: { white: '♗', black: '♝' },
            r: { white: '♖', black: '♜' },
            q: { white: '♕', black: '♛' }
        }
        return unicodeMap[type]?.[color] || ''
    }

    return (
        <Box bg={bgColor} minH="100vh" py={8}>
            <Flex justify="center" align="center" px={4}>
                <Flex gap={4} align="stretch">
                    {/* Chess Board */}
                    <Box
                        bg={cardBg}
                        p={6}
                        borderRadius="xl"
                        boxShadow="dark-lg"
                        border="6px solid"
                        borderColor="#a67c52"
                        position="relative"
                    >
                    <Heading size="lg" mb={4} color="#5a3e2b" textAlign="center">
                        ♟️ Chess Match
                    </Heading>

                    <Chessboard
                        position={fen}
                        onPieceDrop={onDrop}
                        boardOrientation={orientation}
                        boardWidth={500}
                        animationDuration={250}
                        customDarkSquareStyle={{
                            backgroundColor: '#b58863'
                        }}
                        customLightSquareStyle={{
                            backgroundColor: '#f0d9b5'
                        }}
                    />

                    {showGameOverBox && (
                        <Flex
                            position="absolute"
                            top="50%"
                            left="50%"
                            transform="translate(-50%, -50%)"
                            bg="rgba(0,0,0,0.9)"
                            color="white"
                            p={6}
                            borderRadius="md"
                            zIndex="10"
                            flexDirection="column"
                            alignItems="center"
                            justifyContent="center"
                            boxShadow="2xl"
                        >
                            <Heading size="md" mb={2}>Game Over</Heading>
                            <Text fontSize="lg">{over}</Text>
                            <Text fontSize="sm" mt={2}>Returning to home in 10 seconds...</Text>
                        </Flex>
                    )}

                    {gameLive && (
                        <Flex justify="center" mt={4}>
                            <Button
                                colorScheme="red"
                                size="sm"
                                onClick={handleResign}
                            >
                                Resign
                            </Button>
                        </Flex>
                    )}
                </Box>

                {/* Captured Pieces Panel - Right Side */}
                {gameLive && (
                    <Box
                        bg={cardBg}
                        p={4}
                        borderRadius="md"
                        boxShadow="md"
                        w="150px"
                        h="622px"
                        display="flex"
                        flexDirection="column"
                        justifyContent="space-between"
                    >
                        {/* Top: Opponent */}
                        <Box>
                            <Flex justify="center" mb={2}>
                                <Avatar
                                    src={orientation === 'white' ? opponent?.profilePic : user?.profilePic}
                                    name={orientation === 'white' ? opponent?.name : user?.name}
                                    size="sm"
                                />
                            </Flex>
                            <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                {orientation === 'white' ? opponent?.username : user?.username}
                            </Text>
                            <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                {orientation === 'white' ? 'Black ⚫' : 'White ⚪'}
                            </Text>
                            <Flex wrap="wrap" justify="center" gap={1}>
                                {(orientation === 'white' ? capturedBlack : capturedWhite).length > 0 ? (
                                    (orientation === 'white' ? capturedBlack : capturedWhite).map((p, i) => (
                                        <Text key={i} fontSize="2xl">
                                            {getPieceUnicode(p, orientation === 'white' ? 'black' : 'white')}
                                        </Text>
                                    ))
                                ) : (
                                    <Text fontSize="xs" color="gray.500">No pieces</Text>
                                )}
                            </Flex>
                        </Box>

                        {/* Bottom: You */}
                        <Box>
                            <Flex justify="center" mb={2}>
                                <Avatar
                                    src={orientation === 'white' ? user?.profilePic : opponent?.profilePic}
                                    name={orientation === 'white' ? user?.name : opponent?.name}
                                    size="sm"
                                />
                            </Flex>
                            <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                {orientation === 'white' ? user?.username : opponent?.username} (You)
                            </Text>
                            <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                {orientation === 'white' ? 'White ⚪' : 'Black ⚫'}
                            </Text>
                            <Flex wrap="wrap" justify="center" gap={1}>
                                {(orientation === 'white' ? capturedWhite : capturedBlack).length > 0 ? (
                                    (orientation === 'white' ? capturedWhite : capturedBlack).map((p, i) => (
                                        <Text key={i} fontSize="2xl">
                                            {getPieceUnicode(p, orientation === 'white' ? 'white' : 'black')}
                                        </Text>
                                    ))
                                ) : (
                                    <Text fontSize="xs" color="gray.500">No pieces</Text>
                                )}
                            </Flex>
                        </Box>
                    </Box>
                )}
                </Flex>
            </Flex>
        </Box>
    )
}

export default ChessGamePage

