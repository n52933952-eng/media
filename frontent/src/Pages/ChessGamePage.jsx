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
    // Initialize captured pieces from localStorage (like madechess)
    const [capturedWhite, setCapturedWhite] = useState(() => {
        const saved = localStorage.getItem("capturedWhite")
        return saved ? JSON.parse(saved) : []
    })
    const [capturedBlack, setCapturedBlack] = useState(() => {
        const saved = localStorage.getItem("capturedBlack")
        return saved ? JSON.parse(saved) : []
    })

    // Refs to avoid circular dependencies
    const handleGameEndRef = useRef(null)

    const bgColor = useColorModeValue('gray.50', '#101010')
    const cardBg = useColorModeValue('white', '#1a1a1a')
    const textColor = useColorModeValue('gray.800', 'white')

    // Create Chess instance
    const chess = useMemo(() => new Chess(), [])
    // Initialize FEN from localStorage if available (like madechess)
    const [fen, setFen] = useState(() => {
        const savedFen = localStorage.getItem("chessFEN")
        if (savedFen && chess.load(savedFen)) {
            return savedFen
        }
        return chess.fen()
    })

    // Initialize orientation, gameLive, and roomId from localStorage on mount
    useEffect(() => {
        console.log('🎯 [ChessGamePage] Initialization useEffect - Mounting')
        const savedOrientation = localStorage.getItem("chessOrientation")
        const savedGameLive = localStorage.getItem("gameLive") === "true"
        const savedRoomId = localStorage.getItem("chessRoomId")
        
        console.log('🎯 [ChessGamePage] Initialization - localStorage values:', {
            savedOrientation,
            savedGameLive,
            savedRoomId,
            currentOrientationState: orientation,
            currentGameLiveState: gameLive,
            currentRoomIdState: roomId
        })
        
        if (savedOrientation && (savedOrientation === 'white' || savedOrientation === 'black')) {
            console.log('🎯 [ChessGamePage] Setting orientation from localStorage:', savedOrientation)
            setOrientation(savedOrientation)
        } else {
            console.log('⚠️ [ChessGamePage] No valid orientation in localStorage:', savedOrientation)
        }
        
        if (savedGameLive) {
            console.log('🎯 [ChessGamePage] Setting gameLive from localStorage:', savedGameLive)
            setGameLive(true)
        } else {
            console.log('⚠️ [ChessGamePage] gameLive not set in localStorage')
        }
        
        // Set roomId from localStorage if available (for challenger who navigated)
        if (savedRoomId && !roomId) {
            console.log('🎯 [ChessGamePage] Setting roomId from localStorage:', savedRoomId)
            setRoomId(savedRoomId)
        }
    }, [])
    
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
                // Save FEN to localStorage after every move (like madechess)
                localStorage.setItem("chessFEN", newFen)

                // Track captured pieces and save to localStorage (like madechess)
                if (result.captured) {
                    if (result.color === 'w') {
                        setCapturedBlack(prev => {
                            const updated = [...prev, result.captured]
                            localStorage.setItem("capturedBlack", JSON.stringify(updated))
                            return updated
                        })
                    } else {
                        setCapturedWhite(prev => {
                            const updated = [...prev, result.captured]
                            localStorage.setItem("capturedWhite", JSON.stringify(updated))
                            return updated
                        })
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
            console.log('🎯 [ChessGamePage] handleAcceptChallenge socket event received:', data)
            console.log('🎯 [ChessGamePage] handleAcceptChallenge - Current user ID:', user._id)
            console.log('🎯 [ChessGamePage] handleAcceptChallenge - Current orientation state:', orientation)
            
            // Read orientation from localStorage (already set before navigation)
            const currentLocalStorageOrientation = localStorage.getItem("chessOrientation")
            console.log('🎯 [ChessGamePage] handleAcceptChallenge - localStorage chessOrientation BEFORE check:', currentLocalStorageOrientation)
            console.log('🎯 [ChessGamePage] handleAcceptChallenge - socket data.yourColor:', data.yourColor)
            console.log('🎯 [ChessGamePage] handleAcceptChallenge - Expected: accepter should be BLACK, challenger should be WHITE')
            
            // CRITICAL: Don't overwrite localStorage - it was set correctly before navigation
            // If localStorage has a value, use it (it's correct)
            // Only use socket data as backup if localStorage is empty
            if (currentLocalStorageOrientation) {
                console.log('✅ [ChessGamePage] localStorage has orientation, using it (NOT overwriting):', currentLocalStorageOrientation)
                console.log('✅ [ChessGamePage] Socket data.yourColor will be IGNORED:', data.yourColor)
                setOrientation(currentLocalStorageOrientation)
            } else {
                // Backup only if localStorage is empty (shouldn't happen for accepter)
                console.log('⚠️ [ChessGamePage] localStorage is EMPTY! Using socket data as backup')
                const yourColor = data.yourColor || 'white'
                console.log('🎯 [ChessGamePage] Setting orientation from socket (backup):', yourColor)
                setOrientation(yourColor)
                localStorage.setItem('chessOrientation', yourColor)
            }
            
            // Reset chess board for new game (clear old game state)
            chess.reset()
            const newFen = chess.fen()
            setFen(newFen)
            // Clear old game state from localStorage and reset state (starting fresh game)
            localStorage.removeItem("chessFEN")
            localStorage.removeItem("capturedWhite")
            localStorage.removeItem("capturedBlack")
            setCapturedWhite([])
            setCapturedBlack([])
            
            // Set roomId - required for making moves
            console.log('🎯 [ChessGamePage] Setting roomId:', data.roomId)
            setRoomId(data.roomId)
            // Store in localStorage for consistency
            if (data.roomId) {
                localStorage.setItem('chessRoomId', data.roomId)
                console.log('🎯 [ChessGamePage] Stored roomId in localStorage:', data.roomId)
            }
            
            // Start game
            setGameLive(true)
            localStorage.setItem('gameLive', 'true')
            playSound('gameStart')
            
            const finalOrientation = currentLocalStorageOrientation || data.yourColor || 'white'
            console.log('✅ [ChessGamePage] Game started! Final orientation:', finalOrientation)
            console.log('✅ [ChessGamePage] After handleAcceptChallenge - localStorage chessOrientation:', localStorage.getItem("chessOrientation"))
            showToast('Game Started! ♟️', `You are playing as ${finalOrientation === 'white' ? 'White ⚪' : 'Black ⚫'}`, 'success')
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
            localStorage.removeItem('chessRoomId')
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
            console.log('🎯 [ChessGamePage] Received chessGameCleanup event - clearing chess state')
            console.log('🎯 [ChessGamePage] Before cleanup - localStorage chessOrientation:', localStorage.getItem("chessOrientation"))
            
            // Clear localStorage for both users
            localStorage.removeItem('chessOrientation')
            localStorage.removeItem('gameLive')
            localStorage.removeItem('chessRoomId')
            localStorage.removeItem('chessFEN')
            localStorage.removeItem('capturedWhite')
            localStorage.removeItem('capturedBlack')
            
            // Verify cleanup
            const afterCleanup = localStorage.getItem("chessOrientation")
            console.log('🎯 [ChessGamePage] After cleanup - localStorage chessOrientation:', afterCleanup)
            if (afterCleanup) {
                console.error('❌ [ChessGamePage] ERROR: localStorage still has chessOrientation after cleanup!')
            } else {
                console.log('✅ [ChessGamePage] localStorage successfully cleared')
            }
            
            // Reset state
            setOrientation(null)
            setGameLive(false)
        })

        // Listen for when opponent leaves the game
        socket.on('opponentLeftGame', () => {
            showToast('Opponent Left', 'Your opponent left the game', 'info')
            setOver('Your opponent left the game.')
            setShowGameOverBox(true)
            
            // Navigate to home after a short delay
            setTimeout(() => {
                handleGameEnd()
            }, 3000)
        })

        return () => {
            socket.off('connect')
            socket.off('disconnect')
            socket.off('acceptChessChallenge', handleAcceptChallenge)
            socket.off('opponentMove')
            socket.off('opponentResigned')
            socket.off('chessGameCanceled')
            socket.off('chessGameCleanup')
            socket.off('opponentLeftGame')
        }
    }, [socket, navigate, showToast, makeAMove, user._id, chess])

    function onDrop(sourceSquare, targetSquare) {
        // Input validation
        if (!sourceSquare || !targetSquare || typeof sourceSquare !== 'string' || typeof targetSquare !== 'string') {
            console.error('❌ Invalid square coordinates:', { sourceSquare, targetSquare })
            return false
        }
        
        // Use safeOrientation pattern from madechess: orientation || localStorage || "white"
        const safeOrientation = orientation || localStorage.getItem("chessOrientation") || "white"
        const currentTurn = chess.turn() // 'w' for white, 'b' for black
        
        // Comprehensive logging
        console.log('🎮 onDrop called - Move attempt:', {
            sourceSquare,
            targetSquare,
            chessTurn: currentTurn,
            orientation: orientation,
            localStorageOrientation: localStorage.getItem("chessOrientation"),
            safeOrientation: safeOrientation,
            safeOrientationFirstChar: safeOrientation[0],
            canMove: currentTurn === safeOrientation[0],
            gameLive: gameLive,
            localStorageGameLive: localStorage.getItem("gameLive"),
            socket: !!socket,
            roomId: roomId,
            opponentId: opponentId
        })
        
        // Only allow moves for current player (check if chess turn matches orientation)
        if (currentTurn !== safeOrientation[0]) {
            console.log('❌ Not your turn!', {
                chessTurn: currentTurn,
                yourColor: safeOrientation[0],
                message: `Chess turn is ${currentTurn === 'w' ? 'WHITE' : 'BLACK'}, but you are ${safeOrientation[0] === 'w' ? 'WHITE' : 'BLACK'}`
            })
            return false
        }
        
        if (!gameLive) {
            console.log('❌ Game not live!', {
                gameLive: gameLive,
                localStorageGameLive: localStorage.getItem("gameLive")
            })
            return false
        }
        
        if (!socket) {
            console.log('❌ Socket not connected!')
            return false
        }
        
        if (!roomId || !opponentId) {
            console.log('❌ Missing roomId or opponentId!', {
                roomId: roomId,
                opponentId: opponentId
            })
            return false
        }

        const moveData = {
            from: sourceSquare,
            to: targetSquare,
            color: chess.turn(),
            promotion: 'q'
        }

        console.log('✅ All checks passed, attempting move:', moveData)

        // Make the move locally first
        const move = makeAMove(moveData)
        if (!move) {
            console.log('❌ Illegal move! Move was rejected by chess.js')
            return false
        }

        console.log('✅ Move made successfully!', {
            move: move,
            newFen: chess.fen(),
            nextTurn: chess.turn()
        })

        // Send the FULL move object (result from makeAMove) - like madechess does
        try {
            const movePayload = {
                roomId,
                move: move,
                to: opponentId
            }
            console.log('📤 Sending move to opponent:', movePayload)
            socket.emit('chessMove', movePayload)
            console.log('✅ Move sent successfully!')
        } catch (error) {
            console.error('❌ Error sending move:', error)
            showToast('Error', 'Failed to send move', 'error')
            return false
        }

        return true
    }

    // Unified function to leave/end game - used for resign, navigate away, etc.
    const leaveGame = useCallback((reason = 'left') => {
        // Only notify backend if game is actually live
        if (gameLive && socket && roomId && opponentId && user?._id) {
            if (reason === 'resign') {
                // Use resign event for resign (shows different message to opponent)
                socket.emit('resignChess', {
                    roomId,
                    to: opponentId
                })
            } else {
                // Use chessGameEnd for leaving/navigating away
                socket.emit('chessGameEnd', {
                    roomId,
                    player1: user._id,
                    player2: opponentId
                })
            }
        }
        
        // Clean up localStorage
        localStorage.removeItem('chessOrientation')
        localStorage.removeItem('gameLive')
        localStorage.removeItem('chessRoomId')
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
        
        // Navigate to home
        navigate('/home')
    }, [chess, navigate, socket, roomId, opponentId, user?._id, gameLive])

    const handleResign = () => {
        if (!socket) return
        showToast('Resigned', 'You resigned from the game', 'info')
        leaveGame('resign')
    }

    const handleGameEnd = useCallback(() => {
        leaveGame('end')
    }, [leaveGame])

    // Store handleGameEnd in ref
    useEffect(() => {
        handleGameEndRef.current = handleGameEnd
    }, [handleGameEnd])

    // Cleanup when user navigates away (home, messages, profile, etc.)
    // This works like resign - clears storage and notifies other user
    useEffect(() => {
        return () => {
            console.log('🎯 [ChessGamePage] Cleanup useEffect running - component unmounting')
            
            // Check if game was live (either from state or localStorage)
            const localGameLive = localStorage.getItem('gameLive') === 'true'
            const shouldCleanup = gameLive || localGameLive
            
            console.log('🎯 [ChessGamePage] Cleanup check:', {
                gameLiveState: gameLive,
                localStorageGameLive: localGameLive,
                shouldCleanup: shouldCleanup,
                roomId: roomId,
                opponentId: opponentId
            })
            
            // Always clear localStorage if game was live (even if roomId not set yet)
            if (shouldCleanup) {
                console.log('🎯 [ChessGamePage] Clearing localStorage (game was live)')
                
                // Notify backend only if we have roomId and opponentId
                if (socket && roomId && opponentId && user?._id) {
                    socket.emit('chessGameEnd', {
                        roomId,
                        player1: user._id,
                        player2: opponentId
                    })
                    console.log('🎯 [ChessGamePage] Emitted chessGameEnd to backend')
                } else {
                    console.log('⚠️ [ChessGamePage] Skipped backend notification (missing roomId or opponentId)')
                }
                
                // Always clear localStorage
                localStorage.removeItem('chessOrientation')
                localStorage.removeItem('gameLive')
                localStorage.removeItem('chessRoomId')
                localStorage.removeItem('chessFEN')
                localStorage.removeItem('capturedWhite')
                localStorage.removeItem('capturedBlack')
                
                // Verify cleanup
                const verifyOrientation = localStorage.getItem('chessOrientation')
                const verifyGameLive = localStorage.getItem('gameLive')
                console.log('✅ [ChessGamePage] Cleanup complete - chessOrientation:', verifyOrientation, 'gameLive:', verifyGameLive)
            } else {
                console.log('⚠️ [ChessGamePage] Cleanup skipped - game was not live')
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

