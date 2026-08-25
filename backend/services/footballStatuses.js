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

function kickoffAgeMinutes(match) {
    const kickoff = new Date(match.fixture.date).getTime()
    if (!Number.isFinite(kickoff)) return 0
    return (Date.now() - kickoff) / (60 * 1000)
}

/** True when this live row is (or is about to be) extra time / penalties. */
export function isOvertimePhase(short, ageMin) {
    if (EXTRA_TIME_LIVE_SHORT.includes(short)) return true
    if ((short === 'HT' || short === 'PAUSED') && ageMin >= OVERTIME_BREAK_AFTER_KICKOFF_MINUTES) {
        return true
    }
    // 2H stored past ~115m is almost always extra time the API has not labelled yet.
    if ((short === '2H' || short === 'IN_PLAY' || short === 'LIVE') && ageMin >= 115) {
        return true
    }
    return false
}

function staleKickoffThresholdMinutes(short, ageMin) {
    if (short === 'P') return STALE_PEN_KICKOFF_MINUTES
    if (isOvertimePhase(short, ageMin)) return STALE_ET_KICKOFF_MINUTES
    return STALE_LIVE_AFTER_KICKOFF_MINUTES
}

function displayFinishedKickoffThresholdMinutes(short, ageMin) {
    if (short === 'P') return DISPLAY_PEN_KICKOFF_MINUTES
    if (isOvertimePhase(short, ageMin)) return DISPLAY_ET_KICKOFF_MINUTES
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
    if (isOvertimePhase(short, ageMin)) {
        return ageMin >= staleKickoffThresholdMinutes(short, ageMin)
    }
    if (ageMin >= staleKickoffThresholdMinutes(short, ageMin)) return true

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
    if (ageMin >= displayFinishedKickoffThresholdMinutes(short, ageMin)) return true

    return false
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
    const ageMin = match?.fixture?.date ? kickoffAgeMinutes(match) : 0
    if (short === 'HT' && ageMin >= OVERTIME_BREAK_AFTER_KICKOFF_MINUTES) {
        return { kind: 'extratime', label: 'EXTRA TIME', elapsed }
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
    if (short === 'BT') {
        return { kind: 'extratime', label: 'EXTRA TIME', elapsed }
    }
    if ((short === '2H' || short === 'IN_PLAY' || short === 'LIVE') && ageMin >= 115) {
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
