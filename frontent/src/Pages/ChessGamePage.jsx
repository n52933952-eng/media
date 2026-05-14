import React, { useState, useMemo, useCallback, useEffect, useContext, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import { motion, LayoutGroup } from 'framer-motion'
import {
    Box,
    Heading,
    Text,
    Flex,
    HStack,
    Avatar,
    useColorModeValue,
    Button,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    SimpleGrid,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
} from '@chakra-ui/react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'

// Import sounds
import moveSound from '../assets/p.mp3'
import captureSound from '../assets/k.mp3'
import inCheckSound from '../assets/king.mp3'
import checkmateSound from '../assets/c.mp3'
import gameStartSound from '../assets/start.mp3'
import {
    CHESS_BOARD_THEMES,
    DEFAULT_CHESS_BOARD_THEME_ID,
    BOARD_THEME_STORAGE_KEY,
    getBoardThemeById,
} from '../utils/chessThemes'
import {
    CHESS_PIECE_SETS,
    DEFAULT_CHESS_PIECE_SET_ID,
    PIECE_SET_STORAGE_KEY,
    lichessPieceSvgUrl,
} from '../utils/chessPieceSets'

/** Delay before showing the Game Over overlay (matches mobile). */
const GAME_OVER_OVERLAY_DELAY_MS = 4000

/** Piece slide duration in review mode (react-chessboard); live play stays snappier. */
const REVIEW_BOARD_ANIM_MS = 520

const ChessGamePage = () => {
    const { opponentId } = useParams()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const location = useLocation()
    const { socket, endChessGameOnNavigate } = useContext(SocketContext)
    const { user, orientation, setOrientation } = useContext(UserContext)
    const showToast = useShowToast()

    const [opponent, setOpponent] = useState(null)
    const [roomId, setRoomId] = useState(null)
    const [isSpectator, setIsSpectator] = useState(false)
    // For spectator mode: store both players
    const [player1, setPlayer1] = useState(null) // WHITE player (challenger)
    const [player2, setPlayer2] = useState(null) // BLACK player (accepter)
    
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
    /** After delay — same pattern as mobile (`gameOver` + overlay visibility). */
    const [gameOverOverlayVisible, setGameOverOverlayVisible] = useState(false)
    const gameOverOverlayTimeoutRef = useRef(null)
    const [isGameOver, setIsGameOver] = useState(false)
    const [over, setOver] = useState('')
    const [moveHistory, setMoveHistory] = useState([])
    const [reviewMode, setReviewMode] = useState(false)
    const [reviewIndex, setReviewIndex] = useState(0)
    const [boardThemeId, setBoardThemeId] = useState(() => {
        try {
            const s = localStorage.getItem(BOARD_THEME_STORAGE_KEY)
            if (s && CHESS_BOARD_THEMES.some((t) => t.id === s)) return s
        } catch {
            void 0
        }
        return DEFAULT_CHESS_BOARD_THEME_ID
    })
    const [themePickerOpen, setThemePickerOpen] = useState(false)
    /** Modal tabs: 0 = square colors, 1 = piece style (for scroll-into-view on open). */
    const [themeModalTabIndex, setThemeModalTabIndex] = useState(0)
    const selectedPieceSetItemRef = useRef(null)
    const selectedBoardThemeItemRef = useRef(null)
    const userPickedBoardThemeRef = useRef(false)
    const [pieceSetId, setPieceSetId] = useState(() => {
        try {
            const s = localStorage.getItem(PIECE_SET_STORAGE_KEY)
            if (s && CHESS_PIECE_SETS.some((p) => p.id === s)) return s
        } catch {
            void 0
        }
        return DEFAULT_CHESS_PIECE_SET_ID
    })
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
    const socketRef = useRef(socket)
    const userRef = useRef(user)
    const previousPathRef = useRef(null)
    
    // Update refs when values change
    useEffect(() => {
        socketRef.current = socket
        userRef.current = user
    }, [socket, user])

    const bgColor = useColorModeValue('gray.50', '#101010')
    const cardBg = useColorModeValue('white', '#1a1a1a')
    const textColor = useColorModeValue('gray.800', 'white')
    const boardTheme = getBoardThemeById(boardThemeId)

    const customPieces = useMemo(() => {
        const safe = CHESS_PIECE_SETS.some((s) => s.id === pieceSetId)
            ? pieceSetId
            : DEFAULT_CHESS_PIECE_SET_ID
        const codes = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK']
        const out = {}
        for (const code of codes) {
            const src = lichessPieceSvgUrl(safe, code)
            out[code] = ({ squareWidth }) => (
                <img
                    src={src}
                    width={squareWidth}
                    height={squareWidth}
                    alt=""
                    draggable={false}
                    style={{
                        display: 'block',
                        userSelect: 'none',
                        pointerEvents: 'none',
                        objectFit: 'contain',
                    }}
                />
            )
        }
        return out
    }, [pieceSetId])

    const clearGameOverOverlayDelay = useCallback(() => {
        if (gameOverOverlayTimeoutRef.current != null) {
            clearTimeout(gameOverOverlayTimeoutRef.current)
            gameOverOverlayTimeoutRef.current = null
        }
    }, [])

    const scheduleGameOverOverlayDelay = useCallback(() => {
        clearGameOverOverlayDelay()
        setGameOverOverlayVisible(false)
        gameOverOverlayTimeoutRef.current = setTimeout(() => {
            gameOverOverlayTimeoutRef.current = null
            setGameOverOverlayVisible(true)
        }, GAME_OVER_OVERLAY_DELAY_MS)
    }, [clearGameOverOverlayDelay])

    const selectBoardTheme = useCallback((id) => {
        userPickedBoardThemeRef.current = true
        setBoardThemeId(id)
        try {
            localStorage.setItem(BOARD_THEME_STORAGE_KEY, id)
        } catch {
            void 0
        }
    }, [])

    const selectPieceSet = useCallback((id) => {
        setPieceSetId(id)
        try {
            localStorage.setItem(PIECE_SET_STORAGE_KEY, id)
        } catch {
            void 0
        }
    }, [])

    /** Keep the selected theme/piece row in view; both tabs use a scroll region (square colors was clipping). */
    useEffect(() => {
        if (!themePickerOpen) return
        const id = window.setTimeout(() => {
            const el =
                themeModalTabIndex === 1
                    ? selectedPieceSetItemRef.current
                    : selectedBoardThemeItemRef.current
            if (!el || typeof el.scrollIntoView !== 'function') return
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
            } catch {
                el.scrollIntoView(true)
            }
        }, 80)
        return () => window.clearTimeout(id)
    }, [themePickerOpen, themeModalTabIndex, pieceSetId, boardThemeId])

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
    // Also check URL params for spectator mode
    useEffect(() => {
        console.log('🎯 [ChessGamePage] Initialization useEffect - Mounting')
        const savedOrientation = localStorage.getItem("chessOrientation")
        const savedGameLive = localStorage.getItem("gameLive") === "true"
        const savedRoomId = localStorage.getItem("chessRoomId")
        
        // Check if user is a spectator (from URL params)
        const urlRoomId = searchParams.get('roomId')
        const isSpectatorMode = searchParams.get('spectator') === 'true'
        
        console.log('🎯 [ChessGamePage] Initialization - localStorage values:', {
            savedOrientation,
            savedGameLive,
            savedRoomId,
            urlRoomId,
            isSpectatorMode,
            currentOrientationState: orientation,
            currentGameLiveState: gameLive,
            currentRoomIdState: roomId
        })
        
        // SPECTATOR MODE: User is viewing someone else's game
        if (isSpectatorMode && urlRoomId) {
            console.log('👁️ [ChessGamePage] SPECTATOR MODE detected!')
            setIsSpectator(true)
            setRoomId(urlRoomId)
            // Set default orientation for viewing (white at bottom)
            setOrientation('white')
            // Enable game viewing
            setGameLive(true)
            
            // Clear any old game state from localStorage for spectators
            // This ensures they start with a fresh board when joining a game
            // BUT we will wait for the backend to send the current game state
            localStorage.removeItem('chessFEN')
            localStorage.removeItem('capturedWhite')
            localStorage.removeItem('capturedBlack')
            // Reset chess board to starting position (will be updated when game state arrives)
            chess.reset()
            setFen(chess.fen())
            setCapturedWhite([])
            setCapturedBlack([])
            setMoveHistory([])
            setReviewMode(false)
            setReviewIndex(0)
            
            console.log('👁️ [ChessGamePage] Spectator mode activated - roomId:', urlRoomId)
            console.log('👁️ [ChessGamePage] Waiting for game state from backend...')
        }
        // PLAYER MODE: User is one of the players
        else {
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
        }
    }, [searchParams])
    
    // Track previous roomId to detect game switches
    const previousRoomIdRef = useRef(null)
    // Store pending game state in case it arrives before component is ready
    const pendingGameStateRef = useRef(null)
    
    // Separate useEffect to join socket room when spectator mode is active OR when player refreshes
    // Also handles switching between multiple games and rejoining
    useEffect(() => {
        // Join room if: (1) spectator mode, OR (2) player with active game (page refresh scenario)
        const shouldJoinRoom = (isSpectator || (gameLive && roomId)) && roomId && socket
        if (shouldJoinRoom) {
            const isSwitchingGames = previousRoomIdRef.current && previousRoomIdRef.current !== roomId
            const isRejoining = previousRoomIdRef.current === roomId
            
            // If switching to a different game, clean up previous game state
            if (isSwitchingGames) {
                console.log('👁️ [ChessGamePage] Spectator switching games:', {
                    from: previousRoomIdRef.current,
                    to: roomId
                })
                
                // Leave the old room (Socket.IO automatically handles this when joining new room)
                // But we should still clean up localStorage and reset board
                localStorage.removeItem('chessFEN')
                localStorage.removeItem('capturedWhite')
                localStorage.removeItem('capturedBlack')
                chess.reset()
                setFen(chess.fen())
                setCapturedWhite([])
                setCapturedBlack([])
                // Clear pending state
                pendingGameStateRef.current = null
            } else if (isRejoining) {
                console.log('👁️ [ChessGamePage] Spectator rejoining same game - requesting fresh game state')
                // Clear old state and request fresh state from backend
                localStorage.removeItem('chessFEN')
                localStorage.removeItem('capturedWhite')
                localStorage.removeItem('capturedBlack')
                chess.reset()
                setFen(chess.fen())
                setCapturedWhite([])
                setCapturedBlack([])
                pendingGameStateRef.current = null
            }
            
            // Update previous roomId
            previousRoomIdRef.current = roomId
            
            // Apply any pending game state if we have one
            if (pendingGameStateRef.current && pendingGameStateRef.current.roomId === roomId) {
                console.log('📥 [ChessGamePage] Applying pending game state:', pendingGameStateRef.current)
                const state = pendingGameStateRef.current
                try {
                    if (state.fen && chess.load(state.fen)) {
                        setFen(state.fen)
                        localStorage.setItem("chessFEN", state.fen)
                    }
                    if (state.capturedWhite) {
                        setCapturedWhite(state.capturedWhite)
                        localStorage.setItem("capturedWhite", JSON.stringify(state.capturedWhite))
                    }
                    if (state.capturedBlack) {
                        setCapturedBlack(state.capturedBlack)
                        localStorage.setItem("capturedBlack", JSON.stringify(state.capturedBlack))
                    }
                    
                    // For spectators: fetch both players' data from pending state
                    if (isSpectator && state.player1Id && state.player2Id) {
                        const fetchPlayer = async (playerId, isPlayer1) => {
                            try {
                                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                                const res = await fetch(`${baseUrl}/api/user/getUserPro/${playerId}`, {
                                    credentials: 'include'
                                })
                                if (res.ok) {
                                    const playerData = await res.json()
                                    if (isPlayer1) {
                                        setPlayer1(playerData)
                                    } else {
                                        setPlayer2(playerData)
                                    }
                                    console.log(`✅ [ChessGamePage] Fetched ${isPlayer1 ? 'player1' : 'player2'} from pending state:`, playerData.username)
                                }
                            } catch (error) {
                                console.error(`❌ [ChessGamePage] Error fetching ${isPlayer1 ? 'player1' : 'player2'}:`, error)
                            }
                        }
                        fetchPlayer(state.player1Id, true)  // WHITE player
                        fetchPlayer(state.player2Id, false) // BLACK player
                    }
                    
                    pendingGameStateRef.current = null
                    console.log('✅ [ChessGamePage] Applied pending game state')
                } catch (error) {
                    console.error('❌ [ChessGamePage] Error applying pending game state:', error)
                    pendingGameStateRef.current = null
                }
            }
            
            // Always emit joinChessRoom to request game state (even if rejoining)
            // Backend will always send current game state from Redis (source of truth)
            if (socket.connected) {
                if (isSpectator) {
                    console.log('👁️ [ChessGamePage] Spectator joining room via useEffect (already connected):', roomId)
                } else {
                    console.log('♟️ [ChessGamePage] Player rejoining room after refresh (already connected):', roomId)
                }
                socket.emit('joinChessRoom', { roomId })
            } else {
                console.log('⏳ [ChessGamePage] Socket not connected yet, waiting...')
                // Wait for connection
                const onConnect = () => {
                    if (isSpectator) {
                        console.log('👁️ [ChessGamePage] Socket connected, spectator joining room:', roomId)
                    } else {
                        console.log('♟️ [ChessGamePage] Socket connected, player rejoining room:', roomId)
                    }
                    socket.emit('joinChessRoom', { roomId })
                    socket.off('connect', onConnect)
                }
                socket.on('connect', onConnect)
                return () => {
                    socket.off('connect', onConnect)
                }
            }
        } else {
            if (import.meta.env.DEV) {
                console.log('⏭️ [ChessGamePage] Room join skipped:', { isSpectator, gameLive, roomId: !!roomId, socket: !!socket })
            }
        }
    }, [isSpectator, gameLive, roomId, socket, chess])
    
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
        sounds.current.inCheck = new Audio(inCheckSound)
        sounds.current.checkmate = new Audio(checkmateSound)
        sounds.current.gameStart = new Audio(gameStartSound)

        sounds.current.move.load()
        sounds.current.capture.load()
        sounds.current.inCheck.load()
        sounds.current.checkmate.load()
        sounds.current.gameStart.load()

        return () => {
            clearGameOverOverlayDelay()
        }
    }, [clearGameOverOverlayDelay])

    const playSound = (type) => {
        const sound = sounds.current[type]
        if (sound) {
            sound.currentTime = 0
            sound.play().catch((err) => {
                console.error(`Failed to play ${type} sound:`, err)
            })
        }
    }

    const enterReview = useCallback(() => {
        setReviewIndex(moveHistory.length)
        setReviewMode(true)
    }, [moveHistory.length])

    const exitReview = useCallback(() => {
        setReviewMode(false)
    }, [])

    const reviewStep = useCallback(
        (delta) => {
            const next = Math.max(0, Math.min(reviewIndex + delta, moveHistory.length))
            if (next === reviewIndex) return
            setReviewIndex(next)
        },
        [reviewIndex, moveHistory.length],
    )

    const reviewJumpToStart = useCallback(() => setReviewIndex(0), [])
    const reviewJumpToEnd = useCallback(() => setReviewIndex(moveHistory.length), [moveHistory.length])

    // Fetch opponent info - only fetch once on mount and when page becomes visible
    // No need to poll API since users can't update profile while in active game
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
            // Fetch immediately on mount
            fetchOpponent()
            
            // Also refresh when page becomes visible (user switches back to tab)
            // This handles the case where user updates profile and comes back to game
            const handleVisibilityChange = () => {
                if (document.visibilityState === 'visible') {
                    fetchOpponent()
                }
            }
            document.addEventListener('visibilitychange', handleVisibilityChange)
            
            return () => {
                document.removeEventListener('visibilitychange', handleVisibilityChange)
            }
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

                // Same as mobile: spectators also append moves so “Review game” works after watching.
                setMoveHistory((prev) => [
                    ...prev,
                    { from: result.from, to: result.to, promotion: result.promotion },
                ])

                // Checkmate uses c.mp3; normal check uses king.mp3 (same as mobile).
                if (chess.isCheckmate()) {
                    playSound('checkmate')
                } else if (chess.inCheck()) {
                    playSound('inCheck')
                } else if (result.captured) {
                    playSound('capture')
                } else {
                    playSound('move')
                }

                // Check game over
                if (chess.isGameOver()) {
                    setIsGameOver(true)
                    if (chess.isCheckmate()) {
                        const winner = chess.turn() === 'w' ? 'Black' : 'White'
                        setOver(`Checkmate! ${winner} wins!`)
                    } else if (chess.isDraw()) {
                        setOver('Draw!')
                    } else {
                        setOver('Game Over')
                    }
                    setShowGameOverBox(true)
                    scheduleGameOverOverlayDelay()

                    // Only players notify backend; spectators must not emit chessGameEnd.
                    if (!isSpectator && socket && roomId && opponentId && user?._id) {
                        const gameEndReason = chess.isCheckmate() ? 'checkmate' : chess.isDraw() ? 'draw' : 'game_over'
                        socket.emit('chessGameEnd', {
                            roomId,
                            player1: user._id,
                            player2: opponentId,
                            reason: gameEndReason
                        })
                        if (import.meta.env.DEV) {
                            console.log('♟️ Game ended - notifying backend:', { roomId, player1: user._id, player2: opponentId, reason: gameEndReason })
                        }
                    }
                }
            }
            return result
        } catch {
            return null
        }
    }, [chess, socket, roomId, opponentId, user?._id, scheduleGameOverOverlayDelay, isSpectator])

    // Socket: Accept chess challenge and handle spectator mode
    useEffect(() => {
        if (!socket) return

        // Connection status
        socket.on('connect', () => {
            console.log('✅ Chess socket connected')
            showToast('Connected', 'Chess connection restored', 'success')
            
            // Check localStorage directly (not state) to handle page refresh scenario
            // State might not be initialized yet when socket reconnects after page refresh
            const localGameLive = localStorage.getItem('gameLive') === 'true'
            const localRoomId = localStorage.getItem('chessRoomId')
            const urlParams = new URLSearchParams(window.location.search)
            const isSpectatorMode = urlParams.get('spectator') === 'true'
            
            // If spectator mode OR player with active game, join the room when socket connects
            const shouldJoin = localRoomId && (isSpectator || isSpectatorMode || localGameLive)
            if (shouldJoin) {
                const roomToJoin = localRoomId || roomId
                if (isSpectator || isSpectatorMode) {
                    console.log('👁️ [ChessGamePage] Spectator joining room on connect:', roomToJoin)
                } else {
                    console.log('♟️ [ChessGamePage] Player rejoining room on connect (page refresh):', roomToJoin)
                }
                socket.emit('joinChessRoom', { roomId: roomToJoin })
            }
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
            setMoveHistory([])
            setReviewMode(false)
            setReviewIndex(0)
            setIsGameOver(false)
            setShowGameOverBox(false)
            clearGameOverOverlayDelay()
            setGameOverOverlayVisible(false)
            
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
            
            // CRITICAL: Only process moves for the current room (prevent interference from other games)
            if (data.roomId && data.roomId !== roomId) {
                if (import.meta.env.DEV) {
                    console.log('⚠️ [ChessGamePage] Ignoring opponentMove - roomId mismatch:', {
                        received: data.roomId,
                        current: roomId
                    })
                }
                return
            }
            
            // The move object from madechess has from, to, color, piece, etc.
            // chess.move() can accept this full move object
            if (data && data.move) {
                try {
                    // Validate move data structure
                    if (typeof data.move !== 'object' || !data.move.from || !data.move.to) {
                        if (import.meta.env.DEV) {
                            console.error('❌ Invalid move structure:', data.move)
                        }
                        return // Silently skip invalid moves
                    }
                    
                    // Check if move is already applied (prevent duplicate application)
                    const currentFen = chess.fen()
                    const moveResult = makeAMove(data.move)
                    
                    if (!moveResult) {
                        // Check if the move was already applied (FEN didn't change means move was already there)
                        const newFen = chess.fen()
                        if (currentFen === newFen) {
                            // Move was already applied, silently ignore
                            if (import.meta.env.DEV) {
                                console.log('⚠️ Move already applied, ignoring duplicate:', data.move)
                            }
                            return
                        }
                        
                        // Only show error if move actually failed and wasn't already applied
                        if (import.meta.env.DEV) {
                            console.error('❌ Failed to apply opponent move:', data.move)
                        }
                        // Don't show error toast - move might have been applied locally already
                        // showToast('Error', 'Failed to apply opponent move', 'error')
                    } else if (import.meta.env.DEV) {
                        console.log('✅ Opponent move applied successfully:', moveResult)
                    }
                } catch (error) {
                    // Only log error, don't show toast to user (might be duplicate or already applied)
                    if (import.meta.env.DEV) {
                        console.error('❌ Error applying opponent move:', error)
                    }
                    // Don't show error toast - move might have been applied locally already
                    // showToast('Error', 'Error applying move', 'error')
                }
            } else {
                if (import.meta.env.DEV) {
                    console.error('❌ Invalid move data received:', data)
                }
            }
        })

        socket.on('opponentResigned', () => {
            if (isSpectator) {
                showToast('Game ended', 'A player resigned', 'info')
                setOver('A player resigned.')
            } else {
                showToast('Victory! 🏆', 'Your opponent resigned', 'success')
                setOver('Your opponent resigned. You win!')
            }
            setIsGameOver(true)
            setShowGameOverBox(true)
            scheduleGameOverOverlayDelay()
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

            // Spectators: same as mobile — show Game Over overlay, do not tear down the board.
            if (isSpectator) {
                setIsGameOver(true)
                setOver('Game ended.')
                setShowGameOverBox(true)
                scheduleGameOverOverlayDelay()
                return
            }
            
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
            if (isSpectator) {
                showToast('Game ended', 'A player left the game', 'info')
                setOver('A player left the game.')
            } else {
                showToast('Opponent Left', 'Your opponent left the game', 'info')
                setOver('Your opponent left the game.')
            }
            setIsGameOver(true)
            setShowGameOverBox(true)
            scheduleGameOverOverlayDelay()
        })

        // Listen for game state (for spectator catch-up when joining/rejoining)
        // Check URL params directly to handle race conditions
        socket.on('chessGameState', (data) => {
            console.log('📨 [ChessGamePage] chessGameState event received:', data)
            
            // Check if we're a spectator by looking at URL params (more reliable than state)
            const urlParams = new URLSearchParams(window.location.search)
            const isSpectatorMode = urlParams.get('spectator') === 'true'
            const urlRoomId = urlParams.get('roomId')
            
            console.log('📨 [ChessGamePage] Checking game state match:', {
                dataRoomId: data?.roomId,
                urlRoomId: urlRoomId,
                stateRoomId: roomId,
                isSpectatorMode: isSpectatorMode,
                isSpectatorState: isSpectator
            })
            
            // Apply state if: roomId matches (from URL or state)
            // Apply for both spectators AND players (players need it after page refresh)
            if (data && data.roomId && (data.roomId === urlRoomId || data.roomId === roomId)) {
                // Apply if we're a spectator OR if we're a player with an active game (page refresh scenario)
                const isPlayerRejoining = gameLive && roomId === data.roomId && !isSpectatorMode && !isSpectator
                if (isSpectatorMode || isSpectator || isPlayerRejoining) {
                    console.log('📥 [ChessGamePage] Received game state for catch-up:', {
                        roomId: data.roomId,
                        fen: data.fen?.substring(0, 50) + '...',
                        capturedWhite: data.capturedWhite?.length || 0,
                        capturedBlack: data.capturedBlack?.length || 0,
                        isSpectatorMode,
                        isSpectatorState: isSpectator,
                        isPlayerRejoining: isPlayerRejoining,
                        currentRoomId: roomId
                    })
                    
                    // If component isn't ready yet (roomId not set), store it for later
                    if (!roomId && urlRoomId === data.roomId) {
                        console.log('⏳ [ChessGamePage] Component not ready, storing game state for later')
                        pendingGameStateRef.current = {
                            roomId: data.roomId,
                            fen: data.fen,
                            capturedWhite: data.capturedWhite || [],
                            capturedBlack: data.capturedBlack || [],
                            player1Id: data.player1Id,
                            player2Id: data.player2Id
                        }
                        return
                    }
                    
                    try {
                        // Load the FEN position
                        if (data.fen) {
                            console.log('🔄 [ChessGamePage] Attempting to load FEN:', data.fen)
                            
                            // Set FEN state directly - Chessboard component will render it
                            // The chess instance will sync when moves arrive via opponentMove
                            setFen(data.fen)
                            localStorage.setItem("chessFEN", data.fen)
                            
                            // Try to sync chess instance, but don't fail if it doesn't work
                            // Moves will sync it when they arrive
                            try {
                                chess.reset()
                                const loadResult = chess.load(data.fen)
                                if (loadResult) {
                                    console.log('✅ [ChessGamePage] Chess instance synced with FEN')
                                } else {
                                    console.warn('⚠️ [ChessGamePage] Chess instance failed to load FEN, but FEN state is set. Moves will sync it.')
                                }
                            } catch (loadError) {
                                console.warn('⚠️ [ChessGamePage] Error loading FEN into chess instance:', loadError)
                                console.log('ℹ️ [ChessGamePage] FEN state is set, chess instance will sync when moves arrive')
                            }
                            
                            console.log('✅ [ChessGamePage] Applied FEN from game state')
                        } else {
                            console.warn('⚠️ [ChessGamePage] No FEN in game state, using starting position')
                            chess.reset()
                            setFen(chess.fen())
                        }
                        
                        // Apply captured pieces
                        if (data.capturedWhite && Array.isArray(data.capturedWhite)) {
                            setCapturedWhite(data.capturedWhite)
                            localStorage.setItem("capturedWhite", JSON.stringify(data.capturedWhite))
                        }
                        if (data.capturedBlack && Array.isArray(data.capturedBlack)) {
                            setCapturedBlack(data.capturedBlack)
                            localStorage.setItem("capturedBlack", JSON.stringify(data.capturedBlack))
                        }
                        
                        // For spectators: fetch both players' data
                        if ((isSpectatorMode || isSpectator) && data.player1Id && data.player2Id) {
                            console.log('👁️ [ChessGamePage] Fetching player data for spectator mode:', {
                                player1Id: data.player1Id,
                                player2Id: data.player2Id
                            })
                            
                            // Fetch player1 (WHITE/challenger) and player2 (BLACK/accepter)
                            const fetchPlayer = async (playerId, isPlayer1) => {
                                try {
                                    const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                                    const res = await fetch(`${baseUrl}/api/user/getUserPro/${playerId}`, {
                                        credentials: 'include'
                                    })
                                    if (res.ok) {
                                        const playerData = await res.json()
                                        if (isPlayer1) {
                                            setPlayer1(playerData)
                                        } else {
                                            setPlayer2(playerData)
                                        }
                                        console.log(`✅ [ChessGamePage] Fetched ${isPlayer1 ? 'player1' : 'player2'} data:`, playerData.username)
                                    }
                                } catch (error) {
                                    console.error(`❌ [ChessGamePage] Error fetching ${isPlayer1 ? 'player1' : 'player2'}:`, error)
                                }
                            }
                            
                            fetchPlayer(data.player1Id, true)  // WHITE player
                            fetchPlayer(data.player2Id, false) // BLACK player
                        }
                        
                        if (isPlayerRejoining) {
                            console.log('✅ [ChessGamePage] Game state applied - player reconnected and caught up!')
                        } else {
                            console.log('✅ [ChessGamePage] Game state applied - spectator caught up!')
                        }
                    } catch (error) {
                        console.error('❌ [ChessGamePage] Error applying game state:', error)
                        // Reset to starting position on error
                        chess.reset()
                        setFen(chess.fen())
                    }
                } else {
                    console.log('⚠️ [ChessGamePage] Received game state but conditions not met, ignoring:', {
                        isSpectatorMode,
                        isSpectator,
                        gameLive,
                        roomIdMatch: roomId === data.roomId
                    })
                }
            }
        })

        // Listen for game ended event (for spectators)
        socket.on('chessGameEnded', (data) => {
            const reason = data?.reason || 'ended'
            let message = 'The game has ended.'
            
            if (reason === 'resigned') {
                message = 'One of the players resigned. The game has ended.'
            } else if (reason === 'player_left') {
                message = 'One of the players left. The game has ended.'
            } else if (reason === 'player_disconnected') {
                message = 'One of the players disconnected. The game has ended.'
            }
            
            // Match mobile: keep final position and moveHistory so spectators can use “Review game”.
            
            showToast('Game Ended', message, 'info')
            setIsGameOver(true)
            setOver(message)
            setShowGameOverBox(true)
            scheduleGameOverOverlayDelay()
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
            socket.off('chessGameState')
            socket.off('chessGameEnded')
        }
    }, [socket, navigate, showToast, makeAMove, user?._id, chess, isSpectator, roomId, gameLive, scheduleGameOverOverlayDelay, clearGameOverOverlayDelay])

    function onDrop(sourceSquare, targetSquare) {
        // SPECTATORS CANNOT MAKE MOVES
        if (isSpectator) {
            if (import.meta.env.DEV) {
                console.log('👁️ [ChessGamePage] Spectator attempted to make a move - blocked')
            }
            showToast('Spectator Mode', 'You are viewing this game. Only players can make moves.', 'info')
            return false
        }
        if (reviewMode) {
            return false
        }
        if (isGameOver) {
            return false
        }
        
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
        // Also include current game state (FEN, captured pieces) for spectator catch-up
        try {
            const movePayload = {
                roomId,
                move: move,
                to: opponentId,
                fen: chess.fen(),
                capturedWhite: capturedWhite,
                capturedBlack: capturedBlack
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
        setGameOverOverlayVisible(false)
        clearGameOverOverlayDelay()
        setIsGameOver(false)
        setMoveHistory([])
        setReviewMode(false)
        setReviewIndex(0)
        setCapturedWhite([])
        setCapturedBlack([])
        setGameLive(false)
        setOrientation(null)
        
        // Same event name as mobile `CHESS_GAME_FEED_UI_ENDED` — your feed flips Live → Ended when you leave (socket may not echo to you).
        if (roomId && !isSpectator) {
            const s = String(roomId).trim()
            if (s) window.dispatchEvent(new CustomEvent('chessGameFeedUiEnded', { detail: { roomId: s } }))
        }

        // Navigate to home
        navigate('/home')
    }, [chess, navigate, socket, roomId, opponentId, user?._id, gameLive, clearGameOverOverlayDelay, isSpectator])

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

    /** When leaving the chess route for any reason, flip your feed card (same as mobile `beforeRemove`). */
    useEffect(() => {
        return () => {
            if (!isSpectator && roomId) {
                const s = String(roomId).trim()
                if (s) window.dispatchEvent(new CustomEvent('chessGameFeedUiEnded', { detail: { roomId: s } }))
            }
        }
    }, [isSpectator, roomId])

    // Handle page unload (browser close/refresh) - DON'T cancel game on refresh
    // Only cleanup if user explicitly navigates away (not page refresh)
    useEffect(() => {
        const handleBeforeUnload = () => {
            // On page refresh/close, DON'T cleanup - let the game continue
            // The backend will handle reconnection when socket reconnects
            if (import.meta.env.DEV) {
                console.log('🔄 [ChessGamePage] Page unloading (refresh/close) - preserving game state')
            }
            // Don't prevent default - allow normal page unload
        }
        
        window.addEventListener('beforeunload', handleBeforeUnload)
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
        }
    }, [])
    
    // Handle browser back button and navigation away - cancel game when leaving chess page
    useEffect(() => {
        // Initialize previous path on mount
        if (previousPathRef.current === null) {
            previousPathRef.current = location.pathname
        }
        
        const handlePopState = () => {
            // Check if game is live
            const gameLive = localStorage.getItem('gameLive') === 'true'
            if (gameLive && endChessGameOnNavigate) {
                console.log('⬅️ [ChessGamePage] Browser back/forward button pressed - ending chess game')
                endChessGameOnNavigate()
            }
        }
        
        // Listen for popstate event (browser back/forward button)
        window.addEventListener('popstate', handlePopState)
        
        // Check on location change (React Router navigation)
        const currentPath = location.pathname
        const previousPath = previousPathRef.current
        const isChessPage = currentPath.startsWith('/chess/')
        const wasOnChessPage = previousPath && previousPath.startsWith('/chess/')
        
        // If we were on chess page and now we're not, cancel the game
        if (wasOnChessPage && !isChessPage && previousPath !== currentPath) {
            const gameLive = localStorage.getItem('gameLive') === 'true'
            if (gameLive && endChessGameOnNavigate) {
                console.log('⬅️ [ChessGamePage] Navigated away from chess page - ending chess game')
                endChessGameOnNavigate()
            }
        }
        
        // Update previous path
        previousPathRef.current = currentPath
        
        return () => {
            window.removeEventListener('popstate', handlePopState)
        }
    }, [location.pathname, endChessGameOnNavigate])
    
    // Additional cleanup on component unmount (for browser back button)
    useEffect(() => {
        return () => {
            // Only cancel if we're actually navigating away (not refreshing)
            // Check if we're still in the app and not on chess page
            const gameLive = localStorage.getItem('gameLive') === 'true'
            if (gameLive && endChessGameOnNavigate) {
                // Use a small delay to check the actual URL after navigation
                setTimeout(() => {
                    const currentUrl = window.location.pathname
                    const stillOnChessPage = currentUrl.startsWith('/chess/')
                    if (!stillOnChessPage) {
                        console.log('⬅️ [ChessGamePage] Component unmounting (navigation detected) - ending chess game')
                        endChessGameOnNavigate()
                    }
                }, 50)
            }
        }
    }, [endChessGameOnNavigate])
    
    // Cleanup when user navigates away to a DIFFERENT route (not page refresh)
    // This only runs when React Router navigates away, not on page refresh
    // IMPORTANT: We removed the unmount cleanup because it was canceling games on refresh
    // Now we only cleanup when explicitly leaving (via leaveGame function)

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

    /** SAN labels for review scrubber (same order as moveHistory). */
    const reviewMoveSans = useMemo(() => {
        const replay = new Chess()
        const out = []
        for (let i = 0; i < moveHistory.length; i++) {
            try {
                const r = replay.move(moveHistory[i])
                if (r) out.push(r.san)
                else break
            } catch {
                break
            }
        }
        return out
    }, [moveHistory])

    const { boardPosition, capW, capB } = useMemo(() => {
        if (!reviewMode) {
            return { boardPosition: fen, capW: capturedWhite, capB: capturedBlack }
        }
        const replay = new Chess()
        const cw = []
        const cb = []
        for (let i = 0; i < reviewIndex && i < moveHistory.length; i++) {
            try {
                const m = replay.move(moveHistory[i])
                if (m && m.captured) {
                    if (m.color === 'w') cb.push(m.captured)
                    else cw.push(m.captured)
                }
            } catch {
                break
            }
        }
        return { boardPosition: replay.fen(), capW: cw, capB: cb }
    }, [reviewMode, reviewIndex, moveHistory, fen, capturedWhite, capturedBlack])

    return (
        <Box bg={bgColor} minH="100vh" py={2}>
            <Flex justify="center" align="start" px={4} direction={{ base: 'column', md: 'row' }} gap={3}>
                {/* Captured Pieces Panel - Left Side */}
                {gameLive && (
                    <Box
                        bg={cardBg}
                        p={4}
                        borderRadius="md"
                        boxShadow="md"
                        w={{ base: '100%', md: '200px' }}
                        minH={{ base: 'auto', md: '400px' }}
                        maxW={{ base: '100%', md: '200px' }}
                        display="flex"
                        flexDirection="column"
                        justifyContent="space-between"
                        order={{ base: 2, md: 1 }}
                        flexShrink={0}
                    >
                        {isSpectator ? (
                            <>
                                {/* Top: Player 1 (WHITE/Challenger) */}
                                <Box>
                                    <Flex justify="center" mb={2}>
                                        <Avatar
                                            src={player1?.profilePic}
                                            name={player1?.name || player1?.username}
                                            size="sm"
                                        />
                                    </Flex>
                                    <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                        {player1?.username || 'Loading...'}
                                    </Text>
                                    <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                        White ⚪
                                    </Text>
                                    <Flex wrap="wrap" justify="center" gap={1} minH="60px">
                                        {capW.length > 0 ? (
                                            capW.map((p, i) => (
                                                <Text key={i} fontSize="2xl">
                                                    {getPieceUnicode(p, 'white')}
                                                </Text>
                                            ))
                                        ) : (
                                            <Text fontSize="xs" color="gray.500">No pieces</Text>
                                        )}
                                    </Flex>
                                </Box>

                                {/* Bottom: Player 2 (BLACK/Accepter) */}
                                <Box>
                                    <Flex justify="center" mb={2}>
                                        <Avatar
                                            src={player2?.profilePic}
                                            name={player2?.name || player2?.username}
                                            size="sm"
                                        />
                                    </Flex>
                                    <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                        {player2?.username || 'Loading...'}
                                    </Text>
                                    <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                        Black ⚫
                                    </Text>
                                    <Flex wrap="wrap" justify="center" gap={1} minH="60px">
                                        {capB.length > 0 ? (
                                            capB.map((p, i) => (
                                                <Text key={i} fontSize="2xl">
                                                    {getPieceUnicode(p, 'black')}
                                                </Text>
                                            ))
                                        ) : (
                                            <Text fontSize="xs" color="gray.500">No pieces</Text>
                                        )}
                                    </Flex>
                                </Box>
                            </>
                        ) : (
                            <>
                                {/* Top: Opponent */}
                                <Box>
                                    <Flex justify="center" mb={2}>
                                        <Avatar
                                            src={opponent?.profilePic}
                                            name={opponent?.name}
                                            size="sm"
                                        />
                                    </Flex>
                                    <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                        {opponent?.username}
                                    </Text>
                                    <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                        {/* Opponent is always the opposite color of user */}
                                        {storedOrientation === 'white' ? 'Black ⚫' : 'White ⚪'}
                                    </Text>
                                    <Flex wrap="wrap" justify="center" gap={1} minH="60px">
                                        {/* If user is white, opponent is black - show pieces black captured (white pieces) = capturedWhite */}
                                        {/* If user is black, opponent is white - show pieces white captured (black pieces) = capturedBlack */}
                                        {(storedOrientation === 'white' ? capW : capB).length > 0 ? (
                                            (storedOrientation === 'white' ? capW : capB).map((p, i) => (
                                                <Text key={i} fontSize="2xl">
                                                    {getPieceUnicode(p, storedOrientation === 'white' ? 'white' : 'black')}
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
                                            src={user?.profilePic}
                                            name={user?.name}
                                            size="sm"
                                        />
                                    </Flex>
                                    <Text fontSize="xs" textAlign="center" color={textColor} mb={2} fontWeight="bold">
                                        {user?.username} (You)
                                    </Text>
                                    <Text fontSize="xs" textAlign="center" color="gray.500" mb={2}>
                                        {/* User's color is always storedOrientation */}
                                        {storedOrientation === 'white' ? 'White ⚪' : 'Black ⚫'}
                                    </Text>
                                    <Flex wrap="wrap" justify="center" gap={1} minH="60px">
                                        {/* If user is white, show pieces white captured (black pieces) = capturedBlack */}
                                        {/* If user is black, show pieces black captured (white pieces) = capturedWhite */}
                                        {(storedOrientation === 'white' ? capB : capW).length > 0 ? (
                                            (storedOrientation === 'white' ? capB : capW).map((p, i) => (
                                                <Text key={i} fontSize="2xl">
                                                    {getPieceUnicode(p, storedOrientation === 'white' ? 'black' : 'white')}
                                                </Text>
                                            ))
                                        ) : (
                                            <Text fontSize="xs" color="gray.500">No pieces</Text>
                                        )}
                                    </Flex>
                                </Box>
                            </>
                        )}
                    </Box>
                )}

                {/* Chess Board - Center */}
                <Box
                    bg={cardBg}
                    p={3}
                    borderRadius="xl"
                    boxShadow="dark-lg"
                    border="6px solid"
                    borderColor="#a67c52"
                    position="relative"
                    w="fit-content"
                    order={{ base: 1, md: 2 }}
                >
                    <Flex justify="space-between" align="center" mb={1} gap={2} flexWrap="wrap">
                        <Heading size="md" color="#5a3e2b" textAlign="left" flex="1" minW="120px">
                            ♟️ Chess Match
                        </Heading>
                        <Button
                            size="xs"
                            variant="outline"
                            colorScheme="yellow"
                            onClick={() => {
                                setThemeModalTabIndex(0)
                                setThemePickerOpen(true)
                            }}
                        >
                            🎨 Board &amp; pieces
                        </Button>
                    </Flex>
                    {reviewMode && (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.22, ease: 'easeOut' }}
                        >
                            <Text fontSize="xs" textAlign="center" mb={1} color="orange.400" fontWeight="bold">
                                Review mode — pieces animate between positions; scrub moves below
                            </Text>
                        </motion.div>
                    )}
                    {isSpectator ? (
                        <Text fontSize="xs" textAlign="center" mb={1.5} color="#5a3e2b" fontWeight="bold">
                            {gameLive && !reviewMode && !isGameOver
                                ? `👁️ Watching — ${chess.turn() === 'w' ? 'White to move' : 'Black to move'}`
                                : '👁️ Spectator mode'}
                        </Text>
                    ) : gameLive && storedOrientation && !reviewMode ? (
                        <Text fontSize="xs" textAlign="center" mb={1.5} color="#5a3e2b" fontWeight="bold">
                            You are playing as: {storedOrientation === 'white' ? '⚪ White' : '⚫ Black'}
                            {chess.turn() === storedOrientation[0] ? ' (Your turn!)' : ' (Waiting...)'}
                        </Text>
                    ) : null}

                    <Box
                        w="400px"
                        h="400px"
                        dir="ltr"
                        sx={{
                            direction: 'ltr',
                            unicodeBidi: 'isolate',
                        }}
                    >
                        {/* LTR: same a→h geometry for all languages (Arabic RTL was mirroring the grid). */}
                        {/* Render board directly like madechess - no conditional rendering */}
                        {/* Madechess line 323-339: Just renders Chessboard with boardOrientation={storedOrientation} */}
                        {/* Key includes orientation to force remount when it changes - CRITICAL for react-chessboard */}
                        <Chessboard
                            key={`chess-board-${storedOrientation}-${reviewMode ? 'review' : 'live'}`}
                            position={boardPosition}
                            onPieceDrop={reviewMode || isGameOver ? () => false : onDrop}
                            boardOrientation={storedOrientation}
                            boardWidth={400}
                            animationDuration={reviewMode ? REVIEW_BOARD_ANIM_MS : 250}
                            arePiecesDraggable={!isSpectator && !reviewMode && !isGameOver}
                            customPieces={customPieces}
                            customDarkSquareStyle={{
                                backgroundColor: boardTheme.dark,
                            }}
                            customLightSquareStyle={{
                                backgroundColor: boardTheme.light,
                            }}
                        />
                    </Box>

                    {reviewMode && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            style={{ width: '100%', maxWidth: '400px' }}
                        >
                            <HStack justify="center" mt={2} spacing={2} flexWrap="wrap">
                                <Button size="xs" onClick={reviewJumpToStart} isDisabled={reviewIndex === 0}>
                                    |◀
                                </Button>
                                <Button size="xs" onClick={() => reviewStep(-1)} isDisabled={reviewIndex === 0}>
                                    ◀
                                </Button>
                                <Text fontSize="xs" minW="72px" textAlign="center" color={textColor}>
                                    {reviewIndex} / {moveHistory.length}
                                </Text>
                                <Button size="xs" onClick={() => reviewStep(1)} isDisabled={reviewIndex >= moveHistory.length}>
                                    ▶
                                </Button>
                                <Button size="xs" onClick={reviewJumpToEnd} isDisabled={reviewIndex >= moveHistory.length}>
                                    ▶|
                                </Button>
                                <Button size="xs" colorScheme="blue" onClick={exitReview}>
                                    Exit review
                                </Button>
                            </HStack>
                            {reviewMoveSans.length > 0 && (
                                <Box mt={3} overflowX="auto" pb={1} sx={{ WebkitOverflowScrolling: 'touch' }}>
                                    <LayoutGroup id="chess-review-moves">
                                        <HStack spacing={1} align="center" minW="min-content" px={0.5}>
                                            <motion.div layout whileTap={{ scale: 0.96 }}>
                                                <Button
                                                    size="xs"
                                                    variant={reviewIndex === 0 ? 'solid' : 'ghost'}
                                                    colorScheme={reviewIndex === 0 ? 'orange' : 'gray'}
                                                    onClick={() => setReviewIndex(0)}
                                                    flexShrink={0}
                                                >
                                                    Start
                                                </Button>
                                            </motion.div>
                                            {reviewMoveSans.map((san, i) => {
                                                const afterPly = i + 1
                                                const active = reviewIndex === afterPly
                                                return (
                                                    <motion.div
                                                        key={`${san}-${i}`}
                                                        layout
                                                        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                                                        whileHover={{ scale: 1.06 }}
                                                        whileTap={{ scale: 0.94 }}
                                                        style={{ position: 'relative', flexShrink: 0 }}
                                                    >
                                                        {active && (
                                                            <motion.span
                                                                layoutId="reviewSanCursor"
                                                                style={{
                                                                    position: 'absolute',
                                                                    inset: '-3px',
                                                                    borderRadius: '8px',
                                                                    border: '2px solid',
                                                                    borderColor: 'var(--chakra-colors-orange-400)',
                                                                    pointerEvents: 'none',
                                                                    zIndex: 0,
                                                                }}
                                                                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                                            />
                                                        )}
                                                        <Button
                                                            size="xs"
                                                            variant={active ? 'solid' : 'ghost'}
                                                            colorScheme={active ? 'orange' : 'gray'}
                                                            onClick={() => setReviewIndex(afterPly)}
                                                            position="relative"
                                                            zIndex={1}
                                                            fontWeight={active ? 'bold' : 'normal'}
                                                        >
                                                            {san}
                                                        </Button>
                                                    </motion.div>
                                                )
                                            })}
                                        </HStack>
                                    </LayoutGroup>
                                </Box>
                            )}
                        </motion.div>
                    )}

                    {showGameOverBox && gameOverOverlayVisible && !reviewMode && (
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
                            minW="260px"
                        >
                            <Heading size="md" mb={2}>
                                {isSpectator ? 'Game ended' : 'Game Over'}
                            </Heading>
                            <Text fontSize="lg" textAlign="center">
                                {over}
                            </Text>
                            <HStack mt={4} spacing={3} flexWrap="wrap" justify="center">
                                {moveHistory.length > 0 && (
                                    <Button colorScheme="blue" size="sm" onClick={enterReview}>
                                        Review game
                                    </Button>
                                )}
                                <Button colorScheme="gray" size="sm" onClick={handleGameEnd}>
                                    Back to home
                                </Button>
                            </HStack>
                        </Flex>
                    )}

                    {gameLive && !isSpectator && !reviewMode && !isGameOver && (
                        <Flex justify="center" mt={2}>
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
            </Flex>

            <Modal
                isOpen={themePickerOpen}
                onClose={() => {
                    setThemeModalTabIndex(0)
                    setThemePickerOpen(false)
                }}
                size="lg"
                isCentered
                motionPreset="none"
            >
                <ModalOverlay />
                <ModalContent bg={cardBg} maxH="90vh" overflow="hidden" display="flex" flexDirection="column">
                    <ModalHeader color={textColor} flexShrink={0}>
                        Board &amp; pieces
                    </ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6} pt={0} overflow="hidden" display="flex" flexDirection="column" flex="1" minH={0}>
                        <Tabs
                            variant="soft-rounded"
                            colorScheme="yellow"
                            isLazy
                            index={themeModalTabIndex}
                            onChange={setThemeModalTabIndex}
                            display="flex"
                            flexDirection="column"
                            flex="1"
                            minH={0}
                        >
                            <TabList mb={3} flexWrap="wrap" gap={1} flexShrink={0}>
                                <Tab>Square colors</Tab>
                                <Tab>Piece style</Tab>
                            </TabList>
                            <TabPanels flex="1" minH={0}>
                                <TabPanel px={0} display="flex" flexDirection="column" minH={0}>
                                    <Box
                                        maxH="min(52vh, 440px)"
                                        overflowY="auto"
                                        overflowX="hidden"
                                        pr={1}
                                        pb={6}
                                        sx={{ WebkitOverflowScrolling: 'touch' }}
                                    >
                                    <SimpleGrid columns={{ base: 2, md: 3 }} spacing={3}>
                                        {CHESS_BOARD_THEMES.map((t) => {
                                            const selected = t.id === boardThemeId
                                            return (
                                                <Button
                                                    key={t.id}
                                                    ref={selected ? selectedBoardThemeItemRef : undefined}
                                                    variant={selected ? 'solid' : 'outline'}
                                                    colorScheme={selected ? 'blue' : 'gray'}
                                                    flexDirection="column"
                                                    h="auto"
                                                    py={3}
                                                    onClick={() => selectBoardTheme(t.id)}
                                                >
                                                    <Flex
                                                        mb={2}
                                                        borderRadius="md"
                                                        overflow="hidden"
                                                        w="72px"
                                                        h="72px"
                                                        borderWidth={selected ? 2 : 1}
                                                        borderColor={selected ? 'blue.400' : 'gray.500'}
                                                        flexDirection="column"
                                                    >
                                                        {[0, 1, 2, 3].map((r) => (
                                                            <Flex key={r} w="100%" flex="1">
                                                                {[0, 1, 2, 3].map((c) => (
                                                                    <Box
                                                                        key={c}
                                                                        flex="1"
                                                                        bg={(r + c) % 2 === 0 ? t.light : t.dark}
                                                                    />
                                                                ))}
                                                            </Flex>
                                                        ))}
                                                    </Flex>
                                                    <Text fontSize="sm">{t.nameEn}</Text>
                                                </Button>
                                            )
                                        })}
                                    </SimpleGrid>
                                    </Box>
                                </TabPanel>
                                <TabPanel px={0} display="flex" flexDirection="column" minH={0}>
                                    <Box
                                        maxH="min(52vh, 440px)"
                                        overflowY="auto"
                                        overflowX="hidden"
                                        pr={1}
                                        pb={6}
                                        sx={{ WebkitOverflowScrolling: 'touch' }}
                                    >
                                        <SimpleGrid columns={{ base: 2, md: 3 }} spacing={3}>
                                        {CHESS_PIECE_SETS.map((p) => {
                                            const selected = p.id === pieceSetId
                                            const preview = lichessPieceSvgUrl(p.id, 'wN')
                                            return (
                                                <Button
                                                    key={p.id}
                                                    ref={selected ? selectedPieceSetItemRef : undefined}
                                                    variant={selected ? 'solid' : 'outline'}
                                                    colorScheme={selected ? 'blue' : 'gray'}
                                                    flexDirection="column"
                                                    h="auto"
                                                    py={3}
                                                    onClick={() => selectPieceSet(p.id)}
                                                >
                                                    <Box
                                                        mb={2}
                                                        borderRadius="md"
                                                        w="72px"
                                                        h="72px"
                                                        borderWidth={selected ? 2 : 1}
                                                        borderColor={selected ? 'blue.400' : 'gray.500'}
                                                        bg="#F0D9B5"
                                                        display="flex"
                                                        alignItems="center"
                                                        justifyContent="center"
                                                        dir="ltr"
                                                        sx={{ direction: 'ltr' }}
                                                    >
                                                        <img
                                                            src={preview}
                                                            alt=""
                                                            width={56}
                                                            height={56}
                                                            draggable={false}
                                                            style={{
                                                                objectFit: 'contain',
                                                                display: 'block',
                                                                pointerEvents: 'none',
                                                            }}
                                                        />
                                                    </Box>
                                                    <Text fontSize="sm" fontWeight="600">
                                                        {p.nameEn}
                                                    </Text>
                                                    <Text fontSize="xs" color="gray.500">
                                                        {p.nameAr}
                                                    </Text>
                                                </Button>
                                            )
                                        })}
                                        </SimpleGrid>
                                    </Box>
                                </TabPanel>
                            </TabPanels>
                        </Tabs>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </Box>
    )
}

export default ChessGamePage

