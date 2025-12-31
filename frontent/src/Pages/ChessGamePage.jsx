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
    // Initialize orientation from localStorage if available
    const [orientation, setOrientation] = useState(() => {
        const saved = localStorage.getItem('chessOrientation')
        console.log('♟️ Initializing orientation from localStorage:', saved)
        return saved || 'white'
    })
    // Force remount counter - increments when orientation changes
    const [boardKey, setBoardKey] = useState(0)
    
    // Sync orientation from localStorage on mount (in case it was set before navigation)
    // This is critical - when accepter navigates, localStorage should already have 'black'
    useEffect(() => {
        const saved = localStorage.getItem('chessOrientation')
        console.log('♟️ Component mounted - checking localStorage:', saved)
        if (saved) {
            console.log('♟️ Setting orientation from localStorage on mount:', saved)
            setOrientation(saved)
        }
    }, [])
    const [gameLive, setGameLive] = useState(false)
    const [showGameOverBox, setShowGameOverBox] = useState(false)
    const [over, setOver] = useState('')
    const [capturedWhite, setCapturedWhite] = useState([])
    const [capturedBlack, setCapturedBlack] = useState([])

    // Refs to avoid circular dependencies
    const handleGameEndRef = useRef(null)

    const bgColor = useColorModeValue('gray.50', '#101010')
    const cardBg = useColorModeValue('white', '#1a1a1a')
    const textColor = useColorModeValue('gray.800', 'white')

    // Create Chess instance
    const chess = useMemo(() => new Chess(), [])
    const [fen, setFen] = useState(chess.fen())

    // Debug: Log orientation changes
    useEffect(() => {
        console.log('🎨 Orientation state:', orientation)
        console.log('🎨 Stored orientation (from localStorage):', storedOrientation)
        console.log('🎨 Chess turn:', chess.turn())
        console.log('🎨 Can move?', chess.turn() === storedOrientation[0])
        console.log('🎨 Board orientation should be:', storedOrientation === 'white' ? 'White at bottom' : 'Black at bottom')
    }, [orientation, storedOrientation, chess])
    
    // Force board re-render when storedOrientation changes
    useEffect(() => {
        console.log('🔄 Stored orientation changed, forcing board re-render')
        console.log('🔄 Current storedOrientation:', storedOrientation)
        console.log('🔄 Board should show:', storedOrientation === 'white' ? 'White pieces at bottom' : 'Black pieces at bottom')
        // Increment boardKey to force complete remount of Chessboard component
        setBoardKey(prev => prev + 1)
    }, [storedOrientation])

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
                const res = await fetch(`${baseUrl}/api/user/getUserPro/${opponentId}`, {
                    credentials: 'include'
                })
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`)
                }
                const data = await res.json()
                setOpponent(data)
            } catch (error) {
                console.error('Error fetching opponent:', error)
            }
        }

        if (opponentId) {
            fetchOpponent()
        }
    }, [opponentId])

    // Define makeAMove BEFORE socket useEffect to avoid initialization error
    const makeAMove = useCallback((move) => {
        try {
            // chess.move() can accept:
            // 1. String: "e2e4"
            // 2. Object: { from: "e2", to: "e4", promotion: "q" }
            // 3. Full move object with from/to properties
            let moveToApply = move
            
            // If it's a full move object, extract just from/to/promotion
            if (move && typeof move === 'object' && move.from && move.to) {
                moveToApply = {
                    from: move.from,
                    to: move.to,
                    promotion: move.promotion || 'q'
                }
            }
            
            const result = chess.move(moveToApply)
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
                    setTimeout(() => {
                        if (handleGameEndRef.current) {
                            handleGameEndRef.current()
                        }
                    }, 10000)
                }
            }
            return result
        } catch (e) {
            return null
        }
    }, [chess])

    // Socket: Accept chess challenge
    useEffect(() => {
        if (!socket) return

        // Connection status
        socket.on('connect', () => {
            console.log('✅ Chess socket connected')
            showToast('Connected', 'Chess connection restored', 'success')
        })

        socket.on('disconnect', () => {
            console.log('⚠️ Chess socket disconnected')
            showToast('Connection Lost', 'Reconnecting...', 'warning')
        })

        socket.on('acceptChessChallenge', (data) => {
            console.log('♟️ Challenge accepted, starting game:', data)
            console.log('♟️ Received data.yourColor:', data.yourColor)
            console.log('♟️ Opponent ID:', data.opponentId)
            console.log('♟️ Current user ID:', user._id)
            console.log('♟️ Current orientation state:', orientation)
            console.log('♟️ Current localStorage:', localStorage.getItem('chessOrientation'))
            
            // Use yourColor from backend (this is the source of truth)
            // Backend assigns: challenger = white, accepter = black
            // But also check localStorage as fallback (for accepter who set it before navigating)
            const savedOrientation = localStorage.getItem('chessOrientation')
            const yourColor = data.yourColor || savedOrientation || 'white'
            
            console.log('♟️ Final orientation to set:', yourColor)
            console.log('♟️ Orientation first char:', yourColor[0])
            console.log('♟️ Expected: challenger=white, accepter=black')
            
            // CRITICAL: Set orientation FIRST, then wait a tick before starting game
            // This ensures the board re-renders with correct orientation before gameLive is set
            setOrientation(yourColor)
            localStorage.setItem('chessOrientation', yourColor)
            
            // Reset chess board to starting position
            chess.reset()
            setFen(chess.fen())
            
            setRoomId(data.roomId)
            
            // Use setTimeout to ensure orientation state update is processed before gameLive
            setTimeout(() => {
                setGameLive(true)
                playSound('gameStart')
                showToast('Game Started! ♟️', `You are playing as ${yourColor === 'white' ? 'White ⚪' : 'Black ⚫'}`, 'success')
                
                // Log for debugging after state updates
                setTimeout(() => {
                    const currentOrientation = localStorage.getItem('chessOrientation') || yourColor
                    console.log('♟️ After 1 second - localStorage:', currentOrientation)
                    console.log('♟️ After 1 second - Chess turn:', chess.turn())
                    console.log('♟️ After 1 second - Can move?', chess.turn() === currentOrientation[0])
                    console.log('♟️ Board should show:', currentOrientation === 'white' ? 'White at bottom' : 'Black at bottom')
                }, 1000)
            }, 50) // Small delay to ensure orientation state is updated
        })

        socket.on('opponentMove', (data) => {
            console.log('♟️ Opponent move received:', data)
            // The move object from madechess has from, to, color, piece, etc.
            // chess.move() can accept this full move object
            if (data && data.move) {
                try {
                    const moveResult = makeAMove(data.move)
                    if (!moveResult) {
                        console.error('❌ Failed to apply opponent move:', data.move)
                        showToast('Error', 'Failed to apply opponent move', 'error')
                    } else {
                        console.log('✅ Opponent move applied successfully:', moveResult)
                    }
                } catch (error) {
                    console.error('❌ Error applying opponent move:', error)
                    showToast('Error', 'Error applying move', 'error')
                }
            } else {
                console.error('❌ Invalid move data received:', data)
            }
        })

        socket.on('opponentResigned', () => {
            showToast('Victory! 🏆', 'Your opponent resigned', 'success')
            setOver('Your opponent resigned. You win!')
            setShowGameOverBox(true)
            setTimeout(() => {
                if (handleGameEndRef.current) {
                    handleGameEndRef.current()
                }
            }, 5000)
        })

        socket.on('chessGameCanceled', () => {
            showToast('Game Canceled', 'The game has been canceled', 'info')
            navigate('/home')
        })

        return () => {
            socket.off('connect')
            socket.off('disconnect')
            socket.off('acceptChessChallenge')
            socket.off('opponentMove')
            socket.off('opponentResigned')
            socket.off('chessGameCanceled')
        }
    }, [socket, navigate, showToast, makeAMove])

    function onDrop(sourceSquare, targetSquare) {
        // Use storedOrientation (always reads from localStorage, like madechess)
        const currentOrientation = storedOrientation
        
        console.log('🎮 onDrop called:', {
            sourceSquare,
            targetSquare,
            chessTurn: chess.turn(),
            orientation: currentOrientation,
            orientationFirstChar: currentOrientation[0],
            canMove: chess.turn() === currentOrientation[0],
            gameLive
        })
        
        // Only allow moves for current player (check if chess turn matches orientation)
        if (chess.turn() !== currentOrientation[0]) {
            console.log('❌ Not your turn!', { 
                turn: chess.turn(), 
                orientation: currentOrientation,
                orientationFirstChar: currentOrientation[0],
                expected: currentOrientation[0] === 'w' ? 'white' : 'black'
            })
            showToast('Not Your Turn', `It's ${chess.turn() === 'w' ? 'White' : 'Black'}'s turn!`, 'warning')
            return false
        }
        if (!gameLive) {
            console.log('❌ Game not live yet!')
            return false
        }
        if (!socket) {
            console.log('❌ Socket not connected!')
            return false
        }

        const moveData = {
            from: sourceSquare,
            to: targetSquare,
            color: chess.turn(),
            promotion: 'q'
        }

        // Make the move locally first
        const move = makeAMove(moveData)
        if (!move) {
            console.log('❌ Illegal move!')
            return false
        }

        console.log('✅ Move made! Sending to opponent...', move)

        // Send the FULL move object (result from makeAMove) - like madechess does
        socket.emit('chessMove', {
            roomId,
            move: move, // Send full move object with from, to, color, piece, etc.
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

    const handleGameEnd = useCallback(() => {
        chess.reset()
        setFen(chess.fen())
        setOver('')
        setShowGameOverBox(false)
        setCapturedWhite([])
        setCapturedBlack([])
        setGameLive(false)
        navigate('/home')
    }, [chess, navigate])

    // Store handleGameEnd in ref
    useEffect(() => {
        handleGameEndRef.current = handleGameEnd
    }, [handleGameEnd])

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
            <Flex justify="center" align="start" px={4} flexWrap="wrap" gap={4}>
                {/* Chess Board - Center */}
                <Box
                    bg={cardBg}
                    p={6}
                    borderRadius="xl"
                    boxShadow="dark-lg"
                    border="6px solid"
                    borderColor="#a67c52"
                    position="relative"
                    w="fit-content"
                >
                    <Heading size="lg" mb={2} color="#5a3e2b" textAlign="center">
                        ♟️ Chess Match
                    </Heading>
                    {gameLive && (
                        <Text fontSize="sm" textAlign="center" mb={4} color="#5a3e2b" fontWeight="bold">
                            You are playing as: {storedOrientation === 'white' ? '⚪ White' : '⚫ Black'}
                            {chess.turn() === storedOrientation[0] ? ' (Your turn!)' : ' (Waiting...)'}
                        </Text>
                    )}

                    <Box w="400px" h="400px">
                        <Chessboard
                            key={`chessboard-${storedOrientation}-${boardKey}-${gameLive}`}
                            position={fen}
                            onPieceDrop={onDrop}
                            boardOrientation={storedOrientation}
                            boardWidth={400}
                            animationDuration={250}
                            customDarkSquareStyle={{
                                backgroundColor: '#b58863'
                            }}
                            customLightSquareStyle={{
                                backgroundColor: '#f0d9b5'
                            }}
                        />
                    </Box>

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
                        h="400px"
                        display="flex"
                        flexDirection="column"
                        justifyContent="space-between"
                    >
                        {/* Top: Opponent */}
                        <Box>
                            <Flex justify="center" mb={2}>
                                <Avatar
                                    src={storedOrientation === 'white' ? opponent?.profilePic : user?.profilePic}
                                    name={storedOrientation === 'white' ? opponent?.name : user?.name}
                                    size="sm"
                                />
                            </Flex>
                            <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                {storedOrientation === 'white' ? opponent?.username : user?.username}
                            </Text>
                            <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                {storedOrientation === 'white' ? 'Black ⚫' : 'White ⚪'}
                            </Text>
                            <Flex wrap="wrap" justify="center" gap={1}>
                                {(storedOrientation === 'white' ? capturedBlack : capturedWhite).length > 0 ? (
                                    (storedOrientation === 'white' ? capturedBlack : capturedWhite).map((p, i) => (
                                        <Text key={i} fontSize="2xl">
                                            {getPieceUnicode(p, storedOrientation === 'white' ? 'black' : 'white')}
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
                                    src={storedOrientation === 'white' ? user?.profilePic : opponent?.profilePic}
                                    name={storedOrientation === 'white' ? user?.name : opponent?.name}
                                    size="sm"
                                />
                            </Flex>
                            <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                {storedOrientation === 'white' ? user?.username : opponent?.username} (You)
                            </Text>
                            <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                {storedOrientation === 'white' ? 'White ⚪' : 'Black ⚫'}
                            </Text>
                            <Flex wrap="wrap" justify="center" gap={1}>
                                {(storedOrientation === 'white' ? capturedWhite : capturedBlack).length > 0 ? (
                                    (storedOrientation === 'white' ? capturedWhite : capturedBlack).map((p, i) => (
                                        <Text key={i} fontSize="2xl">
                                            {getPieceUnicode(p, storedOrientation === 'white' ? 'white' : 'black')}
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
        </Box>
    )
}

export default ChessGamePage

