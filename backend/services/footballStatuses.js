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

/** Still in play — do not treat minute 90+ as full time. */
export const EXTRA_TIME_LIVE_SHORT = ['ET', 'P']

/** Minutes after kickoff before Mongo row is forced to FT (cron). */
export const STALE_LIVE_AFTER_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_LIVE_MINUTES)
    return Number.isFinite(raw) && raw >= 105 ? raw : 110
})()

const STALE_ET_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_ET_MINUTES)
    return Number.isFinite(raw) && raw >= 120 ? raw : 150
})()

const STALE_PEN_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_PEN_MINUTES)
    return Number.isFinite(raw) && raw >= 140 ? raw : 175
})()

/** UI: Finished badge (normal regulation, no ET). */
export const DISPLAY_FINISHED_AFTER_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_DISPLAY_FINISHED_MINUTES)
    return Number.isFinite(raw) && raw >= 95 ? raw : 108
})()

const DISPLAY_ET_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_DISPLAY_ET_FINISHED_MINUTES)
    return Number.isFinite(raw) && raw >= 120 ? raw : 138
})()

const DISPLAY_PEN_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_DISPLAY_PEN_FINISHED_MINUTES)
    return Number.isFinite(raw) && raw >= 150 ? raw : 168
})()

function kickoffAgeMinutes(match) {
    const kickoff = new Date(match.fixture.date).getTime()
    if (!Number.isFinite(kickoff)) return 0
    return (Date.now() - kickoff) / (60 * 1000)
}

function staleKickoffThresholdMinutes(short) {
    if (short === 'P') return STALE_PEN_KICKOFF_MINUTES
    if (short === 'ET') return STALE_ET_KICKOFF_MINUTES
    return STALE_LIVE_AFTER_KICKOFF_MINUTES
}

function displayFinishedKickoffThresholdMinutes(short) {
    if (short === 'P') return DISPLAY_PEN_KICKOFF_MINUTES
    if (short === 'ET') return DISPLAY_ET_KICKOFF_MINUTES
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
    if (ageMin >= staleKickoffThresholdMinutes(short)) return true

    // Regulation only: 90'+ with kickoff past ~105m (injury time), never while ET/P
    if (!EXTRA_TIME_LIVE_SHORT.includes(short)) {
        const elapsed = match.fixture?.status?.elapsed
        if (typeof elapsed === 'number' && elapsed >= 90 && ageMin >= 105) {
            return true
        }
    }

    return false
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
    if (ageMin >= displayFinishedKickoffThresholdMinutes(short)) return true

    // Normal match: 90'+ only after regulation window (~105m from kickoff), not at HT→ET break
    if (!EXTRA_TIME_LIVE_SHORT.includes(short)) {
        const elapsed = match.fixture?.status?.elapsed
        if (typeof elapsed === 'number' && elapsed >= 90 && ageMin >= 105) {
            return true
        }
    }

    return isStaleLiveMatchRow(match)
}

/**
 * @returns {{ kind: 'live'|'halftime'|'extratime'|'penalties'|'finished'|'scheduled'|'other', label: string, elapsed?: number|null }}
 */
export function getMatchDisplayStatus(match) {
    const short = String(match?.fixture?.status?.short || '').trim()
    const elapsed =
        typeof match?.fixture?.status?.elapsed === 'number'
            ? match.fixture.status.elapsed
            : null

    if (FINISHED_STATUS_SHORT.includes(short)) {
        return { kind: 'finished', label: 'FINISHED', elapsed: elapsed ?? 90 }
    }
    if (short === 'NS' || short === 'SCHEDULED') {
        return { kind: 'scheduled', label: short, elapsed: null }
    }
    if (isEffectivelyFinishedForDisplay(match)) {
        return { kind: 'finished', label: 'FINISHED', elapsed: elapsed ?? 90 }
    }
    if (short === 'HT') {
        return { kind: 'halftime', label: 'HALF TIME', elapsed: elapsed ?? 45 }
    }
    if (short === 'ET') {
        return {
            kind: 'extratime',
            label: elapsed != null && elapsed > 90 ? `ET ${elapsed}'` : 'ET',
            elapsed,
        }
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
    const plain = typeof match.toObject === 'function' ? match.toObject() : { ...match }
    const display = getMatchDisplayStatus(plain)
    return {
        ...plain,
        displayStatus: display,
    }
}

/**
 * Mark matches that are still `LIVE` in Mongo but should be finished (no extra API calls).
 * Runs on every live cron tick — O(batch) indexed query, safe at scale.
 */
export async function reconcileStaleLiveMatches(Match) {
    const oldestCutoff = new Date(Date.now() - STALE_LIVE_AFTER_KICKOFF_MINUTES * 60 * 1000)

    const candidates = await Match.find({
        'fixture.status.short': { $in: LIVE_STATUS_SHORT },
        'fixture.date': { $exists: true, $lt: oldestCutoff },
    })
        .select('fixtureId teams fixture goals')
        .limit(80)
        .lean()

    if (candidates.length === 0) return 0

    let updated = 0
    for (const row of candidates) {
        if (!isStaleLiveMatchRow(row)) continue

        const fid = row.fixtureId
        await Match.updateOne(
            { fixtureId: fid },
            {
                $set: {
                    'fixture.status.short': 'FT',
                    'fixture.status.long': 'Full Time',
                    'fixture.status.elapsed': 90,
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
