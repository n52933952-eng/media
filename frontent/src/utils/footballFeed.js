/** DB Match doc → same shape as `footballData` JSON entries (feed rendering). */
export function normalizeDbMatchForFootballFeed(m) {
  if (!m || typeof m !== 'object') return null
  if (m.homeTeam?.name && (m.score !== undefined || m.status?.short)) return m
  return {
    _id: m._id,
    fixtureId: m.fixtureId,
    homeTeam: { name: m.teams?.home?.name, logo: m.teams?.home?.logo },
    awayTeam: { name: m.teams?.away?.name, logo: m.teams?.away?.logo },
    score: { home: m.goals?.home ?? null, away: m.goals?.away ?? null },
    status: {
      short: m.fixture?.status?.short,
      long: m.fixture?.status?.long,
      elapsed: m.fixture?.status?.elapsed,
    },
    league: m.league,
    events: Array.isArray(m.events) ? m.events : [],
    time: m.fixture?.date
      ? new Date(m.fixture.date).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      : undefined,
    fixture: m.fixture,
  }
}

export function isFootballMatchLive(m) {
  if (!m) return false
  const u = String(m.status?.short || m.fixture?.status?.short || '').trim().toUpperCase()
  if (!u && m.fixture?.status?.elapsed != null) return true
  if (['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'].includes(u)) return false
  if (['LIVE', 'IN_PLAY', 'PAUSED', '1H', '2H', 'HT', 'ET', 'BT', 'P'].includes(u)) return true
  const elapsed = m.fixture?.status?.elapsed ?? m.status?.elapsed
  if (elapsed != null && Number(elapsed) >= 0 && u !== 'NS' && u !== 'TBD') return true
  return false
}

export function footballMatchKey(match, index) {
  if (match?.fixtureId != null) return String(match.fixtureId)
  if (match?._id != null) return String(match._id)
  if (match?.fixture?.id != null) return String(match.fixture.id)
  return `idx-${index}`
}
