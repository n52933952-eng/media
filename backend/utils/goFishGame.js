/**
 * Go Fish Game Logic
 * Scalable implementation for 1M+ users
 * 
 * Game Rules:
 * - Each player gets 7 cards
 * - Players take turns asking for a rank (e.g., "Do you have any 5s?")
 * - If opponent has the rank, they give all cards of that rank
 * - If not, player "Goes Fish" (draws from deck)
 * - Collect 4 of a kind (a "book") to score
 * - Win by collecting the most books
 */

// Create a standard 52-card deck
export const createDeck = () => {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades']
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] // 1=Ace, 11=Jack, 12=Queen, 13=King
    const deck = []
    
    for (const suit of suits) {
        for (const value of values) {
            deck.push({ suit, value })
        }
    }
    
    return shuffleDeck(deck)
}

// Fisher-Yates shuffle algorithm (O(n) - efficient for scalability)
export const shuffleDeck = (deck) => {
    const shuffled = [...deck] // Create copy to avoid mutation
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

// Deal cards to players (7 cards each for Go Fish)
export const dealCards = (deck, numPlayers = 2, cardsPerPlayer = 7) => {
    const hands = []
    const remainingDeck = [...deck]
    
    // Deal cards to each player
    for (let i = 0; i < numPlayers; i++) {
        const hand = []
        for (let j = 0; j < cardsPerPlayer; j++) {
            if (remainingDeck.length > 0) {
                hand.push(remainingDeck.shift())
            }
        }
        hands.push(hand)
    }
    
    return {
        hands,
        deck: remainingDeck
    }
}

// Check if player has cards of a specific rank
export const hasRank = (hand, rank) => {
    return hand.filter(card => card.value === rank).length > 0
}

// Get all cards of a specific rank from hand
export const getCardsOfRank = (hand, rank) => {
    return hand.filter(card => card.value === rank)
}

// Remove cards of a specific rank from hand
export const removeCardsOfRank = (hand, rank) => {
    return hand.filter(card => card.value !== rank)
}

// Check for books (4 of a kind) in hand
export const findBooks = (hand) => {
    const rankCounts = {}
    const books = []
    
    // Count cards by rank
    hand.forEach(card => {
        rankCounts[card.value] = (rankCounts[card.value] || 0) + 1
    })
    
    // Find ranks with 4 cards (a book)
    Object.keys(rankCounts).forEach(rank => {
        if (rankCounts[rank] === 4) {
            books.push(parseInt(rank))
        }
    })
    
    return books
}

// Remove books from hand and return them
export const removeBooks = (hand) => {
    const books = findBooks(hand)
    const newHand = [...hand]
    const removedBooks = []
    
    books.forEach(rank => {
        const bookCards = newHand.filter(card => card.value === rank)
        removedBooks.push(...bookCards)
        newHand.splice(0, newHand.length, ...newHand.filter(card => card.value !== rank))
    })
    
    return {
        newHand,
        removedBooks,
        books
    }
}

// Initialize Go Fish game state
export const initializeGoFishGame = (player1Id, player2Id) => {
    // Create and shuffle deck
    const fullDeck = createDeck()
    
    // Deal 7 cards to each player
    const { hands, deck } = dealCards(fullDeck, 2, 7)
    
    // Check for initial books (4 of a kind in starting hand)
    let player1Hand = hands[0]
    let player2Hand = hands[1]
    let player1Score = 0
    let player2Score = 0
    
    // Remove initial books from player 1
    const player1Books = removeBooks(player1Hand)
    player1Hand = player1Books.newHand
    player1Score = player1Books.books.length
    
    // Remove initial books from player 2
    const player2Books = removeBooks(player2Hand)
    player2Hand = player2Books.newHand
    player2Score = player2Books.books.length
    
    return {
        players: [
            {
                userId: player1Id,
                hand: player1Hand,
                score: player1Score,
                books: player1Books.books
            },
            {
                userId: player2Id,
                hand: player2Hand,
                score: player2Score,
                books: player2Books.books
            }
        ],
        deck: deck,
        table: [], // Not used in Go Fish, but kept for consistency
        turn: 0, // 0 = player1, 1 = player2
        gameStatus: 'playing',
        winner: null,
        lastMove: null,
        createdAt: Date.now(),
        lastUpdated: Date.now()
    }
}

// Process a "ask" move in Go Fish
export const processAskMove = (gameState, playerIndex, askedRank) => {
    const opponentIndex = (playerIndex + 1) % 2
    const player = gameState.players[playerIndex]
    const opponent = gameState.players[opponentIndex]
    
    // Validate: player must have at least one card of the asked rank
    if (!hasRank(player.hand, askedRank)) {
        throw new Error('Player must have at least one card of the asked rank')
    }
    
    const opponentCards = getCardsOfRank(opponent.hand, askedRank)
    
    if (opponentCards.length > 0) {
        // Opponent has the rank - give all cards
        player.hand.push(...opponentCards)
        opponent.hand = removeCardsOfRank(opponent.hand, askedRank)
        
        // Check for new books in player's hand
        const booksResult = removeBooks(player.hand)
        player.hand = booksResult.newHand
        player.score += booksResult.books.length
        player.books.push(...booksResult.books)
        
        return {
            success: true,
            gotCards: true,
            cardsReceived: opponentCards.length,
            newBooks: booksResult.books.length,
            nextTurn: playerIndex // Player gets another turn
        }
    } else {
        // Opponent doesn't have it - Go Fish
        if (gameState.deck.length === 0) {
            // Deck is empty - game might end
            return {
                success: true,
                gotCards: false,
                goFish: false, // Can't fish, deck empty
                nextTurn: opponentIndex
            }
        }
        
        const drawnCard = gameState.deck.shift()
        player.hand.push(drawnCard)
        
        // Check if drawn card matches asked rank
        if (drawnCard.value === askedRank) {
            // Lucky! Player got what they asked for - check for books
            const booksResult = removeBooks(player.hand)
            player.hand = booksResult.newHand
            player.score += booksResult.books.length
            player.books.push(...booksResult.books)
            
            return {
                success: true,
                gotCards: false,
                goFish: true,
                drewMatchingCard: true,
                newBooks: booksResult.books.length,
                nextTurn: playerIndex // Player gets another turn
            }
        } else {
            // Didn't get matching card - turn passes
            // But check for books anyway (might have made a book with the drawn card)
            const booksResult = removeBooks(player.hand)
            player.hand = booksResult.newHand
            player.score += booksResult.books.length
            player.books.push(...booksResult.books)
            
            return {
                success: true,
                gotCards: false,
                goFish: true,
                drewMatchingCard: false,
                newBooks: booksResult.books.length,
                nextTurn: opponentIndex
            }
        }
    }
}

// Check if game is over
export const checkGameOver = (gameState) => {
    // Game ends when:
    // 1. Both players have no cards left, OR
    // 2. Deck is empty and no more moves possible
    
    const player1 = gameState.players[0]
    const player2 = gameState.players[1]
    
    const bothHandsEmpty = player1.hand.length === 0 && player2.hand.length === 0
    const deckEmpty = gameState.deck.length === 0
    
    if (bothHandsEmpty || (deckEmpty && player1.hand.length === 0 && player2.hand.length === 0)) {
        // Determine winner
        if (player1.score > player2.score) {
            return {
                gameOver: true,
                winner: player1.userId,
                reason: 'score',
                scores: {
                    player1: player1.score,
                    player2: player2.score
                }
            }
        } else if (player2.score > player1.score) {
            return {
                gameOver: true,
                winner: player2.userId,
                reason: 'score',
                scores: {
                    player1: player1.score,
                    player2: player2.score
                }
            }
        } else {
            return {
                gameOver: true,
                winner: null,
                reason: 'tie',
                scores: {
                    player1: player1.score,
                    player2: player2.score
                }
            }
        }
    }
    
    return { gameOver: false }
}
