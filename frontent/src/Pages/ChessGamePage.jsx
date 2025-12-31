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
    const { user, orientation, setOrientation } = useContext(UserContext)
    const showToast = useShowToast()

    const [opponent, setOpponent] = useState(null)
    const [roomId, setRoomId] = useState(null)
    
    // Read orientation same way ChessTable does in madechess: localStorage first, then state
    // Line 201 in madechess: const storedOrientation = localStorage.getItem("chessOrientation") || orientation;
    // CRITICAL: Always read from localStorage FIRST (like madechess), then fallback to state
    // This ensures we get the correct value that was set before navigation
    // Saif (accepter) should have "black", Neyma (challenger) should have "white"
    const storedOrientation = useMemo(() => {
        const fromStorage = localStorage.getItem("chessOrientation")
        const result = fromStorage || orientation || "white"
        if (import.meta.env.DEV) {
            console.log('🎯 storedOrientation computed:', { 
                fromStorage, 
                orientationState: orientation, 
                result,
                userId: user?._id 
            })
        }
        return result
    }, [orientation, user?._id]) // Only recompute when orientation or user changes
    // Initialize gameLive from localStorage (like madechess)
    const [gameLive, setGameLive] = useState(() => {
        return localStorage.getItem("gameLive") === "true"
    })
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

    // Initialize from localStorage on mount
    useEffect(() => {
        const savedOrientation = localStorage.getItem("chessOrientation")
        const savedGameLive = localStorage.getItem("gameLive") === "true"
        
        if (savedOrientation === 'white' || savedOrientation === 'black') {
            setOrientation(savedOrientation)
        }
        
        if (savedGameLive) {
            setGameLive(true)
        }
    }, []) // Only run once on mount
    
    // Debug: Log orientation changes (only in development)
    useEffect(() => {
        if (import.meta.env.DEV) {
            console.log('🎨 Orientation state:', orientation)
            console.log('🎨 Stored orientation (from localStorage):', storedOrientation)
            console.log('🎨 Chess turn:', chess.turn())
            if (storedOrientation) {
                console.log('🎨 Can move?', chess.turn() === storedOrientation[0])
                console.log('🎨 Board orientation should be:', storedOrientation === 'white' ? 'White at bottom' : 'Black at bottom')
            }
        }
    }, [orientation, storedOrientation, chess])

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
                    
                    // Notify backend that game ended - marks both players as available
                    if (socket && roomId && opponentId && user?._id) {
                        socket.emit('chessGameEnd', {
                            roomId,
                            player1: user._id,
                            player2: opponentId
                        })
                        if (import.meta.env.DEV) {
                            console.log('♟️ Game ended - notifying backend:', { roomId, player1: user._id, player2: opponentId })
                        }
                    }
                    
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

        const handleAcceptChallenge = (data) => {
            if (import.meta.env.DEV) {
                console.log('♟️ Challenge accepted, starting game:', data)
                console.log('♟️ Received data.yourColor:', data.yourColor)
                console.log('♟️ Opponent ID:', data.opponentId)
                console.log('♟️ Current user ID:', user._id)
            }
            
            // Read orientation directly from localStorage (don't use storedOrientation - it might be stale)
            const currentLocalStorageOrientation = localStorage.getItem("chessOrientation")
            if (import.meta.env.DEV) {
                console.log('♟️ Current localStorage orientation:', currentLocalStorageOrientation)
                console.log('♟️ Current orientation state:', orientation)
            }
            
            // CRITICAL: Orientation should already be set locally BEFORE navigation (like madechess)
            // NEVER overwrite localStorage - it was set correctly before navigation
            // Socket data is just confirmation - trust localStorage first
            if (currentLocalStorageOrientation) {
                // localStorage has the correct value - sync state to match it
                // This ensures Saif (accepter) keeps "black" and Neyma (challenger) keeps "white"
                // DO NOT overwrite localStorage - it's already correct!
                setOrientation(currentLocalStorageOrientation)
                if (import.meta.env.DEV) {
                    console.log('♟️ Synced orientation state with localStorage (NOT overwriting):', currentLocalStorageOrientation)
                    console.log('♟️ Socket data.yourColor (ignored):', data.yourColor)
                }
            } else {
                // localStorage doesn't have it (shouldn't happen) - use socket data as backup
                const yourColor = data.yourColor || orientation || 'white'
                setOrientation(yourColor)
                localStorage.setItem('chessOrientation', yourColor)
                if (import.meta.env.DEV) {
                    console.log('♟️ Orientation set from socket (backup - localStorage was empty):', yourColor)
                }
            }
            
            // Reset chess board to starting position
            chess.reset()
            setFen(chess.fen())
            
            setRoomId(data.roomId)
            
            // Start game
            setGameLive(true)
            localStorage.setItem('gameLive', 'true') // Save to localStorage like madechess
            playSound('gameStart')
            // Use the orientation from localStorage (already set correctly before navigation)
            const finalOrientation = currentLocalStorageOrientation || data.yourColor || orientation || 'white'
            showToast('Game Started! ♟️', `You are playing as ${finalOrientation === 'white' ? 'White ⚪' : 'Black ⚫'}`, 'success')
            if (import.meta.env.DEV) {
                console.log('✅ Game started! gameLive set to true, orientation:', finalOrientation)
            }
        }

        socket.on('acceptChessChallenge', handleAcceptChallenge)
        
        socket.on('opponentMove', (data) => {
            if (import.meta.env.DEV) {
                console.log('♟️ Opponent move received:', data)
            }
            // The move object from madechess has from, to, color, piece, etc.
            // chess.move() can accept this full move object
            if (data && data.move) {
                try {
                    // Validate move data structure
                    if (typeof data.move !== 'object' || !data.move.from || !data.move.to) {
                        throw new Error('Invalid move structure')
                    }
                    
                    const moveResult = makeAMove(data.move)
                    if (!moveResult) {
                        console.error('❌ Failed to apply opponent move:', data.move)
                        showToast('Error', 'Failed to apply opponent move', 'error')
                    } else if (import.meta.env.DEV) {
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
            
            // Cleanup is already handled by backend via chessGameCleanup event
            // But we also call handleGameEnd to navigate
            setTimeout(() => {
                if (handleGameEndRef.current) {
                    handleGameEndRef.current()
                }
            }, 5000)
        })

        socket.on('chessGameCanceled', () => {
            // Clean up localStorage
            localStorage.removeItem('chessOrientation')
            localStorage.removeItem('gameLive')
            localStorage.removeItem('chessFEN')
            localStorage.removeItem('capturedWhite')
            localStorage.removeItem('capturedBlack')
            
            // Reset state
            setGameLive(false)
            setOrientation(null)
            chess.reset()
            setFen(chess.fen())
            
            showToast('Game Canceled', 'The game has been canceled', 'info')
            navigate('/home')
        })

        // Listen for cleanup event from backend (when opponent resigns or game ends)
        // This ensures BOTH users clear their localStorage
        socket.on('chessGameCleanup', () => {
            if (import.meta.env.DEV) {
                console.log('♟️ Received cleanup event - clearing chess state')
            }
            // Clear localStorage for both users
            localStorage.removeItem('chessOrientation')
            localStorage.removeItem('gameLive')
            localStorage.removeItem('chessFEN')
            localStorage.removeItem('capturedWhite')
            localStorage.removeItem('capturedBlack')
            // Reset state
            setOrientation(null)
            setGameLive(false)
        })

        return () => {
            socket.off('connect')
            socket.off('disconnect')
            socket.off('acceptChessChallenge', handleAcceptChallenge)
            socket.off('opponentMove')
            socket.off('opponentResigned')
            socket.off('chessGameCanceled')
            socket.off('chessGameCleanup')
        }
    }, [socket, navigate, showToast, makeAMove, user._id, chess])

    function onDrop(sourceSquare, targetSquare) {
        // Input validation
        if (!sourceSquare || !targetSquare || typeof sourceSquare !== 'string' || typeof targetSquare !== 'string') {
            if (import.meta.env.DEV) {
                console.error('❌ Invalid square coordinates:', { sourceSquare, targetSquare })
            }
            return false
        }
        
        // Use safeOrientation pattern from madechess: orientation || localStorage || "white"
        // Line 157 in madechess: const safeOrientation = orientation || localStorage.getItem("chessOrientation") || "white";
        const safeOrientation = orientation || localStorage.getItem("chessOrientation") || "white"
        
        if (import.meta.env.DEV) {
            console.log('🎮 onDrop called:', {
                sourceSquare,
                targetSquare,
                chessTurn: chess.turn(),
                safeOrientation,
                safeOrientationFirstChar: safeOrientation[0],
                canMove: chess.turn() === safeOrientation[0],
                gameLive,
                socket: !!socket
            })
        }
        
        // Only allow moves for current player (check if chess turn matches orientation)
        // Same pattern as madechess line 160
        if (chess.turn() !== safeOrientation[0]) {
            if (import.meta.env.DEV) {
                console.log('❌ Not your turn! Turn:', chess.turn(), 'Your color:', safeOrientation[0])
            }
            return false // only current player moves (like madechess)
        }
        
        if (!gameLive) {
            if (import.meta.env.DEV) {
                console.log('❌ Game not live yet!')
            }
            return false
        }
        
        if (!socket) {
            if (import.meta.env.DEV) {
                console.log('❌ Socket not connected!')
            }
            showToast('Error', 'Connection lost. Please refresh.', 'error')
            return false
        }
        
        if (!roomId || !opponentId) {
            if (import.meta.env.DEV) {
                console.error('❌ Missing roomId or opponentId')
            }
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
            if (import.meta.env.DEV) {
                console.log('❌ Illegal move!')
            }
            return false
        }

        if (import.meta.env.DEV) {
            console.log('✅ Move made! Sending to opponent...', move)
        }

        // Send the FULL move object (result from makeAMove) - like madechess does
        try {
            socket.emit('chessMove', {
                roomId,
                move: move, // Send full move object with from, to, color, piece, etc.
                to: opponentId
            })
        } catch (error) {
            console.error('❌ Error sending move:', error)
            showToast('Error', 'Failed to send move', 'error')
            return false
        }

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
        // Notify backend that game ended - this marks both players as available again
        if (socket && roomId && opponentId && user?._id) {
            socket.emit('chessGameEnd', {
                roomId,
                player1: user._id,
                player2: opponentId
            })
            if (import.meta.env.DEV) {
                console.log('♟️ Game ended - notifying backend:', { roomId, player1: user._id, player2: opponentId })
            }
        }
        
        // Clean up localStorage
        localStorage.removeItem('chessOrientation')
        localStorage.removeItem('gameLive')
        localStorage.removeItem('chessFEN')
        localStorage.removeItem('capturedWhite')
        localStorage.removeItem('capturedBlack')
        
        // Reset state
        chess.reset()
        setFen(chess.fen())
        setOver('')
        setShowGameOverBox(false)
        setCapturedWhite([])
        setCapturedBlack([])
        setGameLive(false)
        setOrientation(null)
        
        navigate('/home')
    }, [chess, navigate, socket, roomId, opponentId, user?._id])

    // Store handleGameEnd in ref
    useEffect(() => {
        handleGameEndRef.current = handleGameEnd
    }, [handleGameEnd])

    // Only notify backend when leaving - don't clear localStorage here
    // localStorage is cleared in handleGameEnd when game actually ends
    useEffect(() => {
        return () => {
            // Only notify backend if game was live
            if (gameLive && socket && roomId && opponentId && user?._id) {
                socket.emit('chessGameEnd', {
                    roomId,
                    player1: user._id,
                    player2: opponentId
                })
            }
        }
    }, [socket, roomId, opponentId, user?._id, gameLive])

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
                    {gameLive && storedOrientation && (
                        <Text fontSize="sm" textAlign="center" mb={4} color="#5a3e2b" fontWeight="bold">
                            You are playing as: {storedOrientation === 'white' ? '⚪ White' : '⚫ Black'}
                            {chess.turn() === storedOrientation[0] ? ' (Your turn!)' : ' (Waiting...)'}
                        </Text>
                    )}

                    <Box w="400px" h="400px">
                        {/* Render board directly like madechess - no conditional rendering */}
                        {/* Madechess line 323-339: Just renders Chessboard with boardOrientation={storedOrientation} */}
                        {/* Key includes orientation to force remount when it changes - CRITICAL for react-chessboard */}
                        <Chessboard
                            key={`chess-board-${storedOrientation}`}
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

