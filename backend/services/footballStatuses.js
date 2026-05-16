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

/** Minutes after scheduled kickoff — treat DB "live" rows as finished (regular time + ET buffer). */
export const STALE_LIVE_AFTER_KICKOFF_MINUTES = (() => {
    const raw = Number(process.env.FOOTBALL_STALE_LIVE_MINUTES)
    return Number.isFinite(raw) && raw >= 105 ? raw : 135
})()

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

    const ageMs = Date.now() - kickoff
    const staleMs = STALE_LIVE_AFTER_KICKOFF_MINUTES * 60 * 1000
    if (ageMs >= staleMs) return true

    const elapsed = match.fixture?.status?.elapsed
    if (typeof elapsed === 'number' && elapsed >= 90 && ageMs >= 100 * 60 * 1000) {
        return true
    }

    return false
}

/**
 * Mark matches that are still `LIVE` in Mongo but should be finished (no extra API calls).
 * Runs on every live cron tick — O(batch) indexed query, safe at scale.
 */
export async function reconcileStaleLiveMatches(Match) {
    const staleCutoff = new Date(Date.now() - STALE_LIVE_AFTER_KICKOFF_MINUTES * 60 * 1000)

    const candidates = await Match.find({
        'fixture.status.short': { $in: LIVE_STATUS_SHORT },
        'fixture.date': { $exists: true, $lt: staleCutoff },
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
