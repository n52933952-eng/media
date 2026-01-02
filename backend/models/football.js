import mongoose from 'mongoose'

// Match/Fixture Schema
const MatchSchema = mongoose.Schema({
    fixtureId: {
        type: Number,
        required: true,
        unique: true
    },
    
    // League/Competition info
    league: {
        id: Number,
        name: String,
        country: String,
        logo: String,
        flag: String,
        season: Number
    },

    // Teams
    teams: {
        home: {
            id: Number,
            name: String,
            logo: String
        },
        away: {
            id: Number,
            name: String,
            logo: String
        }
    },

    // Match details
    fixture: {
        date: Date,
        venue: String,
        city: String,
        status: {
            long: String,  // "Match Finished", "First Half", etc.
            short: String, // "FT", "1H", "NS" (Not Started)
            elapsed: Number // Minutes played
        }
    },

    // Goals/Score
    goals: {
        home: {
            type: Number,
            default: null
        },
        away: {
            type: Number,
            default: null
        }
    },

    // Match events (goals, cards, substitutions)
    events: [{
        time: Number,
        team: String,
        player: String,
        type: String, // "Goal", "Card", "subst"
        detail: String // "Yellow Card", "Red Card", "Normal Goal"
    }],

    // API data last updated
    lastUpdated: {
        type: Date,
        default: Date.now
    },

    // Auto-posted to feed?
    postedToFeed: {
        type: Boolean,
        default: false
    },

    // Related post ID (if auto-posted)
    postId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post",
        default: null
    }

}, {timestamps: true})

// Indexes for performance
// Note: fixtureId already has index from unique: true, so we don't duplicate it
MatchSchema.index({ 'fixture.date': -1 })
MatchSchema.index({ 'fixture.status.short': 1 })
MatchSchema.index({ 'league.id': 1 })

// League/Competition Schema (for standings, info)
const LeagueSchema = mongoose.Schema({
    leagueId: {
        type: Number,
        required: true,
        unique: true
    },
    
    name: String,
    country: String,
    logo: String,
    flag: String,
    season: Number,

    // Standings
    standings: [{
        rank: Number,
        team: {
            id: Number,
            name: String,
            logo: String
        },
        points: Number,
        played: Number,
        win: Number,
        draw: Number,
        lose: Number,
        goalsFor: Number,
        goalsAgainst: Number,
        goalsDiff: Number
    }],

    lastUpdated: {
        type: Date,
        default: Date.now
    }

}, {timestamps: true})

// Indexes for performance
// Note: leagueId already has index from unique: true, so we don't duplicate it
LeagueSchema.index({ season: -1 })

const Match = mongoose.model("Match", MatchSchema)
const League = mongoose.model("League", LeagueSchema)

export { Match, League }



