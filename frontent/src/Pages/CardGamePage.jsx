import React, { useState, useEffect, useCallback, useRef, useContext } from 'react'
import {
    Box,
    Flex,
    Text,
    Button,
    Grid,
    VStack,
    HStack,
    Badge,
    Spinner,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    useDisclosure,
    Avatar,
    useColorModeValue,
    useToast,
    Wrap,
    WrapItem,
    Image,
} from '@chakra-ui/react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import { PostContext } from '../context/PostContext'
import API_BASE_URL from '../config/api'

// ─── Rank helpers ──────────────────────────────────────────────────────────────
const RANK_LABELS = {
    1: 'Ace', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
    8: '8', 9: '9', 10: '10', 11: 'Jack', 12: 'Queen', 13: 'King',
}

// Maps server rank (1-13) to image filename prefix
const RANK_FILE = {
    1: 'ace', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
    8: '8', 9: '9', 10: '10', 11: 'jack', 12: 'queen', 13: 'king',
}

// Build the image path for a card (served from /public/cards/)
const cardImagePath = (suit, value) =>
    `/cards/${RANK_FILE[value]}_of_${suit}.png`

// ─── Real playing card using PNG images ────────────────────────────────────────
const PlayingCard = ({ suit, value, onClick, highlighted, disabled }) => {
    const imgSrc = cardImagePath(suit, value)

    return (
        <Box
            as={onClick ? 'button' : 'div'}
            onClick={!disabled ? onClick : undefined}
            w={{ base: '72px', md: '84px' }}
            h={{ base: '100px', md: '118px' }}
            borderRadius="8px"
            overflow="hidden"
            border="3px solid"
            borderColor={highlighted ? '#9333ea' : 'transparent'}
            cursor={onClick && !disabled ? 'pointer' : 'default'}
            opacity={disabled ? 0.4 : 1}
            boxShadow={highlighted
                ? '0 0 0 2px #9333ea, 0 4px 14px rgba(147,51,234,0.5)'
                : '0 2px 6px rgba(0,0,0,0.35)'}
            transition="all 0.15s"
            _hover={onClick && !disabled
                ? { transform: 'translateY(-6px)', boxShadow: '0 0 0 2px #9333ea, 0 10px 24px rgba(147,51,234,0.55)' }
                : {}}
            userSelect="none"
            flexShrink={0}
            display="block"
            p={0}
            bg="transparent"
        >
            <Image
                src={imgSrc}
                alt={`${RANK_LABELS[value]} of ${suit}`}
                w="100%"
                h="100%"
                objectFit="fill"
                borderRadius="5px"
                draggable={false}
                pointerEvents="none"
            />
        </Box>
    )
}

// ─── CardGamePage ──────────────────────────────────────────────────────────────
const CardGamePage = () => {
    const { opponentId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const toast = useToast()
    const { user } = useContext(UserContext)
    const { socket, endCardGameOnNavigate } = useContext(SocketContext)
    const { followPost, setFollowPost } = useContext(PostContext)

    const roomId = localStorage.getItem('cardRoomId')

    const bgPage = useColorModeValue('#f7f7fb', '#0d0d14')
    const bgCard = useColorModeValue('white', '#1a1a2e')
    const borderCol = useColorModeValue('gray.200', 'gray.700')
    const textCol = useColorModeValue('gray.800', 'white')
    const mutedCol = useColorModeValue('gray.500', 'gray.400')

    const { isOpen: isRankOpen, onOpen: openRankModal, onClose: closeRankModal } = useDisclosure()
    const { isOpen: isHelpOpen, onOpen: openHelp, onClose: closeHelp } = useDisclosure()

    // Game state
    const [gameLive, setGameLive] = useState(false)
    const [gameOver, setGameOver] = useState(false)
    const [gameResult, setGameResult] = useState('')
    const [myHand, setMyHand] = useState([])
    const [myScore, setMyScore] = useState(0)
    const [myBooks, setMyBooks] = useState([])
    const [opponentHandCount, setOpponentHandCount] = useState(0)
    const [opponentScore, setOpponentScore] = useState(0)
    const [opponentBooks, setOpponentBooks] = useState([])
    const [deckCount, setDeckCount] = useState(0)
    const [isMyTurn, setIsMyTurn] = useState(false)
    const [lastMoveMsg, setLastMoveMsg] = useState('')
    const [opponent, setOpponent] = useState(null)

    const handInitRef = useRef(false)
    const currentRoomRef = useRef(roomId)
    const prevScoreRef = useRef(0)
    const prevBooksRef = useRef(0)
    const previousPathRef = useRef(null)
    const cardExitHandledRef = useRef(false)
    const pageUnloadingRef = useRef(false)

    const endCardGameOnce = useCallback(() => {
        const activeRoom = localStorage.getItem('cardRoomId')
        if (!activeRoom || !endCardGameOnNavigate || cardExitHandledRef.current) return
        cardExitHandledRef.current = true
        endCardGameOnNavigate()
    }, [endCardGameOnNavigate])

    // Browser back button guard
    useEffect(() => {
        if (previousPathRef.current === null) {
            previousPathRef.current = location.pathname
        }

        const handlePopState = () => endCardGameOnce()

        // Hard refresh / tab close: do NOT end game (Chess-like behavior).
        // Backend reconnect grace will keep the game alive.
        const handleBeforeUnload = () => {
            pageUnloadingRef.current = true
        }

        window.addEventListener('popstate', handlePopState)
        window.addEventListener('beforeunload', handleBeforeUnload)

        // React Router navigation away from card page
        const currentPath = location.pathname
        const previousPath = previousPathRef.current
        const isCardPage = currentPath.startsWith('/card/')
        const wasOnCardPage = previousPath && previousPath.startsWith('/card/')

        if (wasOnCardPage && !isCardPage && previousPath !== currentPath) {
            endCardGameOnce()
        }

        previousPathRef.current = currentPath

        return () => {
            window.removeEventListener('popstate', handlePopState)
            window.removeEventListener('beforeunload', handleBeforeUnload)
        }
    }, [location.pathname, endCardGameOnce])

    // Unmount cleanup: end game only for app navigation/logout, not hard refresh.
    useEffect(() => {
        return () => {
            if (pageUnloadingRef.current) return
            endCardGameOnce()
        }
    }, [endCardGameOnce])

    // Fetch opponent profile
    useEffect(() => {
        if (!opponentId) return
        const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
        fetch(`${baseUrl}/api/user/getUserPro/${opponentId}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?._id) setOpponent(data) })
            .catch(() => {})
    }, [opponentId])

    // Socket events
    useEffect(() => {
        if (!socket || !roomId) return

        currentRoomRef.current = roomId
        handInitRef.current = false

        // Reset state
        setGameLive(false); setGameOver(false); setGameResult('')
        setMyHand([]); setMyScore(0); setMyBooks([])
        setOpponentHandCount(0); setOpponentScore(0); setOpponentBooks([])
        setDeckCount(0); setIsMyTurn(false); setLastMoveMsg('')
        prevScoreRef.current = 0; prevBooksRef.current = 0

        const handleGameState = (data) => {
            if (data.roomId && data.roomId !== currentRoomRef.current) return

            if (data.players) {
                const myId = user?._id?.toString()
                const me = data.players.find(p => p.userId?.toString() === myId)
                const opp = data.players.find(p => p.userId?.toString() !== myId)

                if (me) {
                    if (me.hand !== undefined && Array.isArray(me.hand)) {
                        if (!handInitRef.current || me.hand.length > 0) {
                            setMyHand(me.hand)
                            handInitRef.current = true
                        }
                    }
                    const newScore = me.score || 0
                    const newBooks = (me.books || []).length
                    if (newScore > prevScoreRef.current || newBooks > prevBooksRef.current) {
                        toast({ title: '📚 New Book!', description: `You collected a book of ${RANK_LABELS[(me.books || []).at(-1)]}s!`, status: 'success', duration: 2500, position: 'top' })
                    }
                    prevScoreRef.current = newScore
                    prevBooksRef.current = newBooks
                    setMyScore(newScore)
                    setMyBooks(me.books || [])
                }
                if (opp) {
                    setOpponentHandCount(opp.handCount ?? opp.hand?.length ?? 0)
                    setOpponentScore(opp.score || 0)
                    setOpponentBooks(opp.books || [])
                }

                const myIdx = data.players.findIndex(p => p.userId?.toString() === user?._id?.toString())
                setIsMyTurn(data.turn === myIdx)
            }

            setDeckCount(data.deckCount || 0)

            if (data.lastMove) {
                const m = data.lastMove
                if (m.action === 'ask') {
                    const rName = RANK_LABELS[m.rank] || m.rank
                    if (m.gotCards) {
                        setLastMoveMsg(`Got ${m.cardsReceived} ${rName}${m.cardsReceived > 1 ? 's' : ''}!${m.newBooks > 0 ? ` 📚 Made ${m.newBooks} book${m.newBooks > 1 ? 's' : ''}!` : ''}`)
                    } else {
                        setLastMoveMsg(`Go Fish! ${m.drewMatchingCard ? '🎣 Got it!' : ''}`)
                    }
                }
            }

            if (data.gameStatus === 'playing') setGameLive(true)
            else if (data.gameStatus === 'finished') { setGameLive(false); setGameOver(true) }
        }

        const handleOpponentMove = (data) => {
            if (data.roomId && data.roomId !== currentRoomRef.current) return
            socket.emit('requestCardGameState', { roomId })
        }

        const handleGameEnded = (data) => {
            if (data?.roomId && data.roomId !== currentRoomRef.current) return
            setGameOver(true)
            setGameResult(data.message || 'Game Over')
            toast({ title: 'Game Over 🃏', description: data.message, status: 'info', duration: 4000, position: 'top' })
            removeOwnCardPost()
        }

        const handleCleanup = () => {
            setGameOver(true); setGameLive(false)
            removeOwnCardPost()
            toast({ title: 'Game Ended', description: 'The game was canceled', status: 'warning', duration: 3000, position: 'top' })
            setTimeout(() => navigate('/home'), 1200)
        }

        socket.on('cardGameState', handleGameState)
        socket.on('opponentMove', handleOpponentMove)
        socket.on('cardGameEnded', handleGameEnded)
        socket.on('cardGameCleanup', handleCleanup)

        socket.emit('joinCardRoom', { roomId, userId: user?._id })
        // Fallback state request if joinCardRoom doesn't reply quickly
        const fallback = setTimeout(() => { if (!gameLive) socket.emit('requestCardGameState', { roomId }) }, 1500)

        return () => {
            clearTimeout(fallback)
            socket.off('cardGameState', handleGameState)
            socket.off('opponentMove', handleOpponentMove)
            socket.off('cardGameEnded', handleGameEnded)
            socket.off('cardGameCleanup', handleCleanup)
        }
    }, [socket, roomId])

    const removeOwnCardPost = () => {
        if (!roomId) return
        setFollowPost(prev => prev.filter(post => {
            if (!post.cardGameData) return true
            try {
                const cd = typeof post.cardGameData === 'string' ? JSON.parse(post.cardGameData) : post.cardGameData
                return cd?.roomId !== roomId
            } catch (_) { return true }
        }))
    }

    const availableRanks = [...new Set(myHand.map(c => c.value))].sort((a, b) => a - b)

    const handleAsk = useCallback((rank) => {
        if (!socket || !roomId || !opponentId || !isMyTurn || gameOver) return
        if (!myHand.some(c => c.value === rank)) {
            toast({ title: 'Invalid move', description: 'You must hold at least one card of that rank', status: 'error', duration: 2500, position: 'top' })
            return
        }
        closeRankModal()
        setIsMyTurn(false)
        socket.emit('cardMove', { roomId, move: { action: 'ask', rank }, to: opponentId })
    }, [socket, roomId, opponentId, isMyTurn, gameOver, myHand])

    const handleResign = () => {
        if (socket && roomId && opponentId) socket.emit('resignCard', { roomId, to: opponentId })
        endCardGameOnce()
        removeOwnCardPost()
        navigate('/home')
    }

    const handleLeave = () => {
        if (!gameOver) {
            if (!window.confirm('Leave the game? This counts as a resign.')) return
            handleResign()
        } else {
            endCardGameOnce()
            navigate('/home')
        }
    }

    // ── Loading screen ──────────────────────────────────────────────────────────
    if (!gameLive) {
        return (
            <Box minH="100vh" bg={bgPage} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
                <Text fontSize="4xl" mb={4}>🃏</Text>
                <Spinner size="xl" color="purple.500" mb={4} />
                <Text fontSize="lg" color={mutedCol}>Waiting for the game to start…</Text>
                <Button mt={6} size="sm" variant="outline" onClick={() => navigate('/home')}>Cancel</Button>
            </Box>
        )
    }

    // ── Main game UI ────────────────────────────────────────────────────────────
    return (
        <Box minH="100vh" bg={bgPage} pb={8}>
            {/* Header */}
            <Flex
                bg={bgCard}
                borderBottom="1px solid"
                borderColor={borderCol}
                px={4} py={3}
                align="center"
                justify="space-between"
                position="sticky" top={0} zIndex={10}
            >
                <Button size="sm" variant="ghost" onClick={handleLeave} color={mutedCol}>← Back</Button>
                <HStack spacing={2}>
                    <Text fontSize="xl">🃏</Text>
                    <Text fontWeight="bold" color={textCol}>Go Fish</Text>
                </HStack>
                <HStack spacing={2}>
                    <Button size="sm" variant="ghost" onClick={openHelp}>?</Button>
                    {!gameOver && (
                        <Button size="sm" colorScheme="red" variant="outline" onClick={handleResign}>Resign</Button>
                    )}
                </HStack>
            </Flex>

            <Box maxW="640px" mx="auto" px={4} pt={4}>
                {/* Score bar */}
                <Grid templateColumns="1fr 1fr" gap={3} mb={4}>
                    {[
                        { label: 'You', score: myScore, books: myBooks },
                        { label: opponent?.name || 'Opponent', score: opponentScore, books: opponentBooks },
                    ].map(({ label, score, books }) => (
                        <Box key={label} bg={bgCard} borderRadius="lg" border="1px solid" borderColor={borderCol} p={3} textAlign="center">
                            <Text fontSize="xs" color={mutedCol} mb={1}>{label}</Text>
                            <Text fontSize="2xl" fontWeight="bold" color="purple.500">{score}</Text>
                            <Text fontSize="xs" color={mutedCol}>{books.length} book{books.length !== 1 ? 's' : ''}</Text>
                        </Box>
                    ))}
                </Grid>

                {/* Opponent info + turn indicator */}
                <Flex align="center" justify="space-between" mb={3} px={1}>
                    <HStack spacing={2}>
                        <Avatar size="sm" name={opponent?.name} src={opponent?.profilePic} />
                        <VStack align="start" spacing={0}>
                            <Text fontSize="sm" fontWeight="semibold" color={textCol}>
                                {opponent?.name || 'Opponent'}
                            </Text>
                            <Text fontSize="xs" color={mutedCol}>{opponentHandCount} card{opponentHandCount !== 1 ? 's' : ''} in hand</Text>
                        </VStack>
                    </HStack>
                    {!isMyTurn && !gameOver && (
                        <Badge colorScheme="orange" variant="subtle" px={3} py={1}>Their Turn</Badge>
                    )}
                </Flex>

                {/* Last move + deck info */}
                <Flex gap={2} mb={4}>
                    <Box flex={1} bg={bgCard} borderRadius="md" border="1px solid" borderColor={borderCol} px={3} py={2} minH="36px" display="flex" alignItems="center">
                        {lastMoveMsg ? (
                            <Text fontSize="sm" color="purple.400" fontWeight="medium">{lastMoveMsg}</Text>
                        ) : (
                            <Text fontSize="sm" color={mutedCol} fontStyle="italic">Game in progress…</Text>
                        )}
                    </Box>
                    <Box bg={bgCard} borderRadius="md" border="1px solid" borderColor={borderCol} px={3} py={2} display="flex" alignItems="center">
                        <Text fontSize="sm" color={mutedCol}>🂠 {deckCount}</Text>
                    </Box>
                </Flex>

                {/* My hand */}
                <Box bg={bgCard} borderRadius="xl" border="1px solid" borderColor={borderCol} p={4} mb={4}>
                    <Flex justify="space-between" align="center" mb={3}>
                        <Text fontWeight="bold" color={textCol}>Your Hand ({myHand.length} cards)</Text>
                        {isMyTurn && !gameOver && availableRanks.length > 0 && (
                            <Button size="sm" colorScheme="purple" onClick={openRankModal}>Ask for Rank</Button>
                        )}
                    </Flex>

                    {myHand.length === 0 ? (
                        <Text color={mutedCol} fontSize="sm" fontStyle="italic">No cards in hand</Text>
                    ) : (
                        <Flex flexWrap="wrap" gap={3} justify="flex-start">
                            {myHand.map((card, i) => {
                                const clickable = isMyTurn && !gameOver && availableRanks.includes(card.value)
                                return (
                                    <PlayingCard
                                        key={i}
                                        suit={card.suit}
                                        value={card.value}
                                        highlighted={clickable}
                                        disabled={!clickable}
                                        onClick={clickable ? () => handleAsk(card.value) : undefined}
                                    />
                                )
                            })}
                        </Flex>
                    )}

                    <Box mt={3} minH="28px" display="flex" alignItems="center">
                        {isMyTurn && !gameOver && availableRanks.length > 0 && (
                            <Text fontSize="sm" color="purple.400">
                                💡 Your turn — tap a highlighted card (or use Ask for Rank)
                            </Text>
                        )}
                        {!isMyTurn && !gameOver && (
                            <Text fontSize="sm" color={mutedCol} fontStyle="italic">
                                Waiting for {opponent?.name || 'opponent'}…
                            </Text>
                        )}
                    </Box>
                </Box>

                {/* My books */}
                {myBooks.length > 0 && (
                    <Box bg={bgCard} borderRadius="xl" border="1px solid" borderColor={borderCol} p={3} mb={4}>
                        <Text fontSize="sm" fontWeight="bold" color={textCol} mb={2}>📚 Your Books</Text>
                        <Wrap spacing={2}>
                            {myBooks.map((rank, i) => (
                                <WrapItem key={i}>
                                    <Badge colorScheme="green" px={2} py={1} borderRadius="md" fontSize="xs">
                                        {RANK_LABELS[rank]}s
                                    </Badge>
                                </WrapItem>
                            ))}
                        </Wrap>
                    </Box>
                )}

                {/* Opponent books */}
                {opponentBooks.length > 0 && (
                    <Box bg={bgCard} borderRadius="xl" border="1px solid" borderColor={borderCol} p={3} mb={4}>
                        <Text fontSize="sm" fontWeight="bold" color={textCol} mb={2}>
                            📚 {opponent?.name || 'Opponent'}'s Books
                        </Text>
                        <Wrap spacing={2}>
                            {opponentBooks.map((rank, i) => (
                                <WrapItem key={i}>
                                    <Badge colorScheme="orange" px={2} py={1} borderRadius="md" fontSize="xs">
                                        {RANK_LABELS[rank]}s
                                    </Badge>
                                </WrapItem>
                            ))}
                        </Wrap>
                    </Box>
                )}
            </Box>

            {/* Rank selection modal */}
            <Modal isOpen={isRankOpen} onClose={closeRankModal} isCentered>
                <ModalOverlay />
                <ModalContent bg={bgCard} maxH="80vh">
                    <ModalHeader color={textCol}>Ask for a Rank</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6} overflowY="auto">
                        <Text fontSize="sm" color={mutedCol} mb={4}>
                            Select a rank you hold in your hand:
                        </Text>
                        <VStack spacing={2} align="stretch">
                            {availableRanks.map(rank => {
                                const count = myHand.filter(c => c.value === rank).length
                                return (
                                    <Button
                                        key={rank}
                                        variant="outline"
                                        colorScheme="purple"
                                        justifyContent="space-between"
                                        onClick={() => handleAsk(rank)}
                                        rightIcon={<Badge colorScheme="purple">{count}×</Badge>}
                                    >
                                        {RANK_LABELS[rank]}
                                    </Button>
                                )
                            })}
                        </VStack>
                    </ModalBody>
                </ModalContent>
            </Modal>

            {/* Help modal */}
            <Modal isOpen={isHelpOpen} onClose={closeHelp} isCentered scrollBehavior="inside">
                <ModalOverlay />
                <ModalContent bg={bgCard}>
                    <ModalHeader color={textCol}>🃏 How to Play Go Fish</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6}>
                        <VStack align="start" spacing={4} fontSize="sm" color={textCol}>
                            <Box>
                                <Text fontWeight="bold" color="purple.400" mb={1}>📖 Objective</Text>
                                <Text>Collect "books" (4 cards of the same rank). Most books wins!</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold" color="purple.400" mb={1}>🎮 How to Play</Text>
                                <Text>1. On your turn tap a highlighted card or click "Ask for Rank"</Text>
                                <Text>2. You can only ask for a rank you already hold</Text>
                                <Text>3. If your opponent has it → they give you ALL cards of that rank → you get another turn</Text>
                                <Text>4. If they don't → "Go Fish!" — you draw from the deck</Text>
                                <Text>5. Getting 4 of a kind scores a book automatically</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold" color="purple.400" mb={1}>🏆 Winning</Text>
                                <Text>Game ends when the deck is empty and no one has cards left. Most books wins; equal books is a tie.</Text>
                            </Box>
                        </VStack>
                    </ModalBody>
                </ModalContent>
            </Modal>

            {/* Game over overlay */}
            {gameOver && (
                <Box
                    position="fixed" inset={0}
                    bg="rgba(0,0,0,0.75)"
                    display="flex" alignItems="center" justifyContent="center"
                    zIndex={100}
                >
                    <Box bg={bgCard} borderRadius="2xl" p={8} textAlign="center" minW="280px" boxShadow="2xl">
                        <Text fontSize="3xl" mb={2}>🃏</Text>
                        <Text fontSize="2xl" fontWeight="bold" color={textCol} mb={3}>Game Over</Text>
                        <Text color={mutedCol} mb={6}>{gameResult}</Text>
                        <Button colorScheme="purple" onClick={() => { endCardGameOnce(); navigate('/home') }}>
                            Back to Home
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    )
}

export default CardGamePage
