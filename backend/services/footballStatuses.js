/**
 * Shared football match status codes (football-data.org → MongoDB `fixture.status.short`).
 * Keep controller, cron, and socket payloads aligned.
 */

export const LIVE_STATUS_SHORT = [
    '1H',
    '2H',
    'HT',
    'ET',
    'P',
    'BT',
    'LIVE',
    'IN_PLAY',
    'PAUSED',
]

export const FINISHED_STATUS_SHORT = [
    'FT',
    'FINISHED',
    'AET',
    'PEN',
    'CANC',
    'POSTP',
    'SUSP',
    'AWD',
    'WO',
]

/**
 * Still in play — do not treat minute 90+ as full time.
 * 'BT' is the break inside overtime (before ET, or between ET halves).
 * 'HT' after ~95m from kickoff is the extra-time break, not first-half pause.
 */
export const EXTRA_TIME_LIVE_SHORT = ['ET', 'P', 'BT']

/** Kickoff age where a PAUSED/'HT' row is the extra-time break, not half time. */
export const OVERTIME_BREAK_AFTER_KICKOFF_MINUTES = 95

/**
 * Last-resort clock: only force FT after extra time + penalties could have ended.
 * Real full-time comes from the API (`?ids=` verify). 110m was killing knockout extra time.
 */
export const STALE_LIVE_AFTER_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_LIVE_MINUTES)
    return Number.isFinite(raw) && raw >= 150 ? raw : 200
})()

const STALE_ET_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_ET_MINUTES)
    return Number.isFinite(raw) && raw >= 160 ? raw : 200
})()

const STALE_PEN_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_PEN_MINUTES)
    return Number.isFinite(raw) && raw >= 180 ? raw : 225
})()

/** UI: Finished badge for regulation (2H stoppage can run past 108m). */
export const DISPLAY_FINISHED_AFTER_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_DISPLAY_FINISHED_MINUTES)
    return Number.isFinite(raw) && raw >= 115 ? raw : 125
})()

const DISPLAY_ET_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_DISPLAY_ET_FINISHED_MINUTES)
    return Number.isFinite(raw) && raw >= 160 ? raw : 185
})()

const DISPLAY_PEN_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_DISPLAY_PEN_FINISHED_MINUTES)
    return Number.isFinite(raw) && raw >= 180 ? raw : 210
})()

/**
 * Real kickoffs run a couple of minutes past the scheduled time, so `liveStartedAt` is a better
 * anchor — but only partly trustworthy: the free tier flips SCHEDULED → IN_PLAY up to ~5 minutes
 * late, and taking that at face value started the badge at 1' when the match was at 6'. Cap how
 * much delay we credit so the clock can never be more than this many minutes slow.
 */
const MAX_CREDITED_KICKOFF_DELAY_MIN = 3

/**
 * Minutes of actual play, anchored between the two signals we have: the scheduled `date` (a little
 * early) and the observed live flip (late by the API's status lag). Error stays within ~3 minutes
 * either way.
 */
function kickoffAgeMinutes(match) {
    const scheduled = new Date(match.fixture.date).getTime()
    if (!Number.isFinite(scheduled)) return 0

    const observed = match.fixture.liveStartedAt
        ? new Date(match.fixture.liveStartedAt).getTime()
        : NaN
    const delayMin = Number.isFinite(observed) ? (observed - scheduled) / (60 * 1000) : 0
    const creditedDelayMin = Math.min(Math.max(delayMin, 0), MAX_CREDITED_KICKOFF_DELAY_MIN)

    return (Date.now() - scheduled) / (60 * 1000) - creditedDelayMin
}

/**
 * football-data.org has no official minute. Wall-clock from utcDate includes the ~15'
 * half-time break, so a raw "minutes since kickoff" reads 53' at HT and ~15' fast in the 2nd half.
 *
 * v4 `IN_PLAY` is BOTH halves (`LIVE` is only the 1st-half leftover from older payloads).
 */
const FIRST_HALF_STOPPAGE_CAP = 48
/** 1H/IN_PLAY still set after this → treat as HT (API lags PAUSED). */
const HT_INFER_AFTER_MIN = 51
/** 45' play + ~15' break — 2nd-half clock origin. */
const SECOND_HALF_WALL_MIN = 60
/** PAUSED/HT still set after this → treat as 2H (API lags IN_PLAY). */
const HT_STUCK_TO_2H_MIN = 62

/**
 * @param {string} short stored / API short code
 * @param {number} ageMin minutes since kickoff
 */
export function inferLiveShort(short, ageMin) {
    const s = String(short || '').toUpperCase()
    if (EXTRA_TIME_LIVE_SHORT.includes(s)) return s
    if (FINISHED_STATUS_SHORT.includes(s)) return s
    if (s === 'NS' || s === 'SCHEDULED') return s

    if (s === 'HT' || s === 'PAUSED') {
        if (ageMin >= HT_STUCK_TO_2H_MIN) return '2H'
        return 'HT'
    }

    if (s === '1H' || s === 'LIVE') {
        if (ageMin >= HT_STUCK_TO_2H_MIN) return '2H'
        if (ageMin >= HT_INFER_AFTER_MIN) return 'HT'
        return '1H'
    }

    // IN_PLAY is both halves on football-data.org v4 (STATUS_MAP used to force 2H).
    // Never promote to ET from the clock alone: league matches have no extra time, and a fake
    // ET label pushes the finished/stale thresholds out to 185m+ so the row is stuck in Live.
    if (s === '2H' || s === 'IN_PLAY') {
        if (ageMin < HT_INFER_AFTER_MIN) return '1H'
        if (ageMin < HT_STUCK_TO_2H_MIN) return 'HT'
        return '2H'
    }

    return s
}

/**
 * Approximate match minute for the LIVE badge.
 * @returns {number|null}
 */
export function estimateLiveElapsed(short, ageMin) {
    const inferred = inferLiveShort(short, ageMin)
    const wall = Math.max(0, Math.floor(ageMin))

    if (inferred === 'P') return 120
    if (inferred === 'HT') return 45
    if (inferred === '1H') return Math.min(wall, FIRST_HALF_STOPPAGE_CAP)
    if (inferred === '2H') {
        const approx = 45 + Math.max(0, wall - SECOND_HALF_WALL_MIN)
        return Math.min(Math.max(approx, 45), 95)
    }
    if (inferred === 'ET' || inferred === 'BT') {
        const approx = 90 + Math.max(0, wall - 105)
        return Math.min(Math.max(approx, 90), 120)
    }
    return null
}

/** Recompute elapsed (+ inferred short) for a live row. Safe to run on every request/socket emit. */
export function applyLiveClock(match) {
    if (!match || typeof match !== 'object') return match
    const plain = typeof match.toObject === 'function' ? match.toObject() : match
    const short = String(plain?.fixture?.status?.short || '').trim()
    if (!short || !LIVE_STATUS_SHORT.includes(short) || !plain?.fixture?.date) return plain

    const ageMin = kickoffAgeMinutes(plain)
    const inferred = inferLiveShort(short, ageMin)
    const elapsed = estimateLiveElapsed(short, ageMin)
    return {
        ...plain,
        fixture: {
            ...plain.fixture,
            status: {
                ...plain.fixture.status,
                short: inferred,
                elapsed,
            },
        },
    }
}

/**
 * True only when the API itself put this row in extra time / penalties (ET, BT, P — set from
 * `status` + `score.duration`). Guessing overtime from the clock kept regulation matches live
 * for 3+ hours, so age alone never counts.
 */
export function isOvertimePhase(short) {
    return EXTRA_TIME_LIVE_SHORT.includes(short)
}

/** football-data.org id + name for competitions whose knockout ties can run past 90'. */
const EXTRA_TIME_CAPABLE_LEAGUE_IDS = [2001]
const EXTRA_TIME_CAPABLE_NAME_HINTS = ['champions league', 'cup', 'copa', 'coppa', 'pokal']

/**
 * True when this competition can play extra time / penalties.
 *
 * Needed because a tie only reports ET after the API updates: if that update is late or a verify
 * call is rate-limited, the row still reads '2H' and the regulation cut-off would mark a knockout
 * FINISHED while extra time is being played. Leagues keep the tight cut-off.
 */
function canPlayExtraTime(match) {
    const league = match?.league || {}
    if (EXTRA_TIME_CAPABLE_LEAGUE_IDS.includes(Number(league.id))) return true
    if (String(league.id || '').toUpperCase() === 'CL') return true

    const name = String(league.name || '').toLowerCase()
    return EXTRA_TIME_CAPABLE_NAME_HINTS.some((hint) => name.includes(hint))
}

function staleKickoffThresholdMinutes(short, match) {
    if (short === 'P') return STALE_PEN_KICKOFF_MINUTES
    if (isOvertimePhase(short) || canPlayExtraTime(match)) return STALE_ET_KICKOFF_MINUTES
    return STALE_LIVE_AFTER_KICKOFF_MINUTES
}

function displayFinishedKickoffThresholdMinutes(short, match) {
    if (short === 'P') return DISPLAY_PEN_KICKOFF_MINUTES
    if (isOvertimePhase(short) || canPlayExtraTime(match)) return DISPLAY_ET_KICKOFF_MINUTES
    return DISPLAY_FINISHED_AFTER_KICKOFF_MINUTES
}

/**
 * True when a row is still marked live but kickoff was long enough ago that the match should be over.
 * Cheap guard for API + socket responses (max ~50 rows per request).
 */
export function isStaleLiveMatchRow(match) {
    if (!match?.fixture?.date) return false
    const short = match.fixture?.status?.short
    if (!short || !LIVE_STATUS_SHORT.includes(short)) return false

    const kickoff = new Date(match.fixture.date).getTime()
    if (!Number.isFinite(kickoff)) return false

    const ageMin = kickoffAgeMinutes(match)
    return ageMin >= staleKickoffThresholdMinutes(short, match)
}

/**
 * How long a row may still read NS/SCHEDULED after kickoff before we stop assuming it has started.
 * The free tier can take ~5 minutes to flip the status, which left a running match out of the Live
 * tab. A genuinely delayed game gets its own status (POSTPONED / CANCELLED) from the API.
 */
const ASSUME_STARTED_WITHIN_MIN = 20

/** True when kickoff has passed but the API has not flipped the status to live yet. */
export function isStartedButNotYetLive(match) {
    const short = String(match?.fixture?.status?.short || '').trim()
    if (short !== 'NS' && short !== 'SCHEDULED' && short !== 'TIMED') return false
    if (!match?.fixture?.date) return false

    const ageMin = kickoffAgeMinutes(match)
    return ageMin >= 0 && ageMin <= ASSUME_STARTED_WITHIN_MIN
}

/**
 * Client badge: game is over but row may still be in the Live tab until cron writes FT.
 * Uses elapsed minute + kickoff age — no API call.
 */
export function isEffectivelyFinishedForDisplay(match) {
    if (!match?.fixture) return false
    const short = match.fixture?.status?.short
    if (short && FINISHED_STATUS_SHORT.includes(short)) return true
    if (!short || !LIVE_STATUS_SHORT.includes(short)) return false

    const ageMin = kickoffAgeMinutes(match)
    return ageMin >= displayFinishedKickoffThresholdMinutes(short, match)
}

/**
 * @returns {{ kind: 'live'|'halftime'|'extratime'|'penalties'|'finished'|'scheduled'|'other', label: string, elapsed?: number|null }}
 */
export function getMatchDisplayStatus(match) {
    const clocked = applyLiveClock(match)
    const short = String(clocked?.fixture?.status?.short || '').trim()
    const elapsed =
        typeof clocked?.fixture?.status?.elapsed === 'number'
            ? clocked.fixture.status.elapsed
            : null

    if (FINISHED_STATUS_SHORT.includes(short)) {
        return { kind: 'finished', label: 'FINISHED', elapsed: elapsed ?? 90 }
    }
    if (short === 'NS' || short === 'SCHEDULED' || short === 'TIMED') {
        if (isStartedButNotYetLive(clocked)) {
            return { kind: 'live', label: 'LIVE', elapsed: null }
        }
        return { kind: 'scheduled', label: short, elapsed: null }
    }
    if (isEffectivelyFinishedForDisplay(clocked)) {
        return { kind: 'finished', label: 'FINISHED', elapsed: elapsed ?? 90 }
    }
    if (short === 'HT') {
        return { kind: 'halftime', label: 'HALF TIME', elapsed: elapsed ?? 45 }
    }
    if (short === 'ET') {
        return { kind: 'extratime', label: 'EXTRA TIME', elapsed }
    }
    if (short === 'BT') {
        return { kind: 'extratime', label: 'EXTRA TIME', elapsed }
    }
    if (short === 'P') {
        return { kind: 'penalties', label: 'PENALTIES', elapsed }
    }
    if (LIVE_STATUS_SHORT.includes(short)) {
        return { kind: 'live', label: 'LIVE', elapsed }
    }
    return { kind: 'other', label: short || '—', elapsed }
}

/** Attach `displayStatus` for web/mobile badges (computed once per API/socket payload). */
export function enrichMatchForClient(match) {
    if (!match || typeof match !== 'object') return match
    const plain = applyLiveClock(match)
    const display = getMatchDisplayStatus(plain)
    return {
        ...plain,
        displayStatus: display,
    }
}

/**
 * Current score from a football-data.org `score` object.
 * Strict priority — `fullTime` is authoritative and running during play. Picking the highest
 * total across pairs inflated scores (halfTime/regularTime can disagree mid-update).
 */
export function pickLiveGoals(score) {
    for (const pair of [score?.fullTime, score?.regularTime, score?.halfTime]) {
        if (!pair) continue
        if (pair.home == null && pair.away == null) continue
        return { home: pair.home ?? 0, away: pair.away ?? 0 }
    }
    return { home: null, away: null }
}

/**
 * Mark matches that are still `LIVE` in Mongo but should be finished (no extra API calls).
 * Runs on every live cron tick — O(batch) indexed query, safe at scale.
 */
export async function reconcileStaleLiveMatches(Match) {
    // Use the display threshold (~125m regulation) as the query cutoff, not the 200m backstop:
    // otherwise a finished match sits in neither tab — filtered out of Live, still not FT in Mongo.
    const earliestThreshold = Math.min(
        DISPLAY_FINISHED_AFTER_KICKOFF_MINUTES,
        STALE_LIVE_AFTER_KICKOFF_MINUTES,
    )
    const oldestCutoff = new Date(Date.now() - earliestThreshold * 60 * 1000)

    const candidates = await Match.find({
        'fixture.status.short': { $in: LIVE_STATUS_SHORT },
        'fixture.date': { $exists: true, $lt: oldestCutoff },
    })
        .select('fixtureId teams fixture goals league')
        .limit(80)
        .lean()

    if (candidates.length === 0) return 0

    let updated = 0
    for (const row of candidates) {
        if (!isStaleLiveMatchRow(row) && !isEffectivelyFinishedForDisplay(row)) continue

        const fid = row.fixtureId
        const wasOvertime = isOvertimePhase(row.fixture?.status?.short)
        await Match.updateOne(
            { fixtureId: fid },
            {
                $set: {
                    'fixture.status.short': wasOvertime ? 'AET' : 'FT',
                    'fixture.status.long': wasOvertime ? 'Finished After Extra Time' : 'Full Time',
                    'fixture.status.elapsed': wasOvertime ? 120 : 90,
                    lastUpdated: new Date(),
                },
            },
        )
        updated++
        if (process.env.NODE_ENV !== 'production') {
            console.log(
                `  🏁 [reconcileStaleLive] ${row.teams?.home?.name} vs ${row.teams?.away?.name} → FT (kickoff ${row.fixture?.date})`,
            )
        }
    }

    if (updated > 0) {
        console.log(`⚽ [reconcileStaleLive] Marked ${updated} stale live match(es) as FT`)
    }
    return updated
}
