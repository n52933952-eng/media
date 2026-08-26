/**
 * Match badge display (aligned with backend `footballStatuses.js`).
 * Recompute live/HT from kickoff age — do not freeze a stale `displayStatus`.
 */

const LIVE_STATUS_SHORT = [
  '1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED',
]

const FINISHED_STATUS_SHORT = [
  'FT', 'FINISHED', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP', 'AWD', 'WO',
]

const EXTRA_TIME_LIVE_SHORT = ['ET', 'P', 'BT']
const OVERTIME_BREAK_AFTER_KICKOFF_MIN = 95

const DISPLAY_FINISHED_KICKOFF_MIN = 125
const DISPLAY_ET_FINISHED_KICKOFF_MIN = 185
const DISPLAY_PEN_FINISHED_KICKOFF_MIN = 210

const FIRST_HALF_STOPPAGE_CAP = 48
const HT_INFER_AFTER_MIN = 51
const SECOND_HALF_WALL_MIN = 60
const HT_STUCK_TO_2H_MIN = 62

function kickoffAgeMinutes(match) {
  const kickoff = match?.fixture?.date ? new Date(match.fixture.date).getTime() : NaN
  if (!Number.isFinite(kickoff)) return 0
  return (Date.now() - kickoff) / (60 * 1000)
}

function inferLiveShort(short, ageMin) {
  const s = String(short || '').toUpperCase()
  if (EXTRA_TIME_LIVE_SHORT.includes(s)) return s
  if (FINISHED_STATUS_SHORT.includes(s)) return s
  if (s === 'NS' || s === 'SCHEDULED') return s

  if (s === 'HT' || s === 'PAUSED') {
    if (ageMin >= OVERTIME_BREAK_AFTER_KICKOFF_MIN) return 'BT'
    if (ageMin >= HT_STUCK_TO_2H_MIN) return '2H'
    return 'HT'
  }

  if (s === '1H' || s === 'LIVE') {
    if (ageMin >= HT_STUCK_TO_2H_MIN) return '2H'
    if (ageMin >= HT_INFER_AFTER_MIN) return 'HT'
    return '1H'
  }

  if (s === '2H' || s === 'IN_PLAY') {
    if (ageMin < HT_INFER_AFTER_MIN) return '1H'
    if (ageMin < HT_STUCK_TO_2H_MIN) return 'HT'
    if (ageMin >= 115) return 'ET'
    return '2H'
  }

  return s
}

function estimateLiveElapsed(short, ageMin) {
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

function isOvertimePhase(short, ageMin) {
  if (EXTRA_TIME_LIVE_SHORT.includes(short)) return true
  if ((short === 'HT' || short === 'PAUSED') && ageMin >= OVERTIME_BREAK_AFTER_KICKOFF_MIN) {
    return true
  }
  if ((short === '2H' || short === 'IN_PLAY' || short === 'LIVE') && ageMin >= 115) {
    return true
  }
  return false
}

function displayFinishedKickoffMin(short, ageMin) {
  if (short === 'P') return DISPLAY_PEN_FINISHED_KICKOFF_MIN
  if (isOvertimePhase(short, ageMin)) return DISPLAY_ET_FINISHED_KICKOFF_MIN
  return DISPLAY_FINISHED_KICKOFF_MIN
}

function isEffectivelyFinishedForDisplay(match) {
  const short = String(match?.fixture?.status?.short || '').trim()
  if (FINISHED_STATUS_SHORT.includes(short)) return true
  if (!LIVE_STATUS_SHORT.includes(short)) return false

  const ageMin = kickoffAgeMinutes(match)
  return ageMin >= displayFinishedKickoffMin(short, ageMin)
}

export function getMatchDisplayStatus(match) {
  const rawShort = String(match?.fixture?.status?.short || '').trim()

  if (FINISHED_STATUS_SHORT.includes(rawShort) && match?.displayStatus?.kind === 'finished') {
    return match.displayStatus
  }
  if (rawShort === 'NS' || rawShort === 'SCHEDULED') {
    return match?.displayStatus?.kind === 'scheduled'
      ? match.displayStatus
      : { kind: 'scheduled', label: rawShort, elapsed: null }
  }

  if (isEffectivelyFinishedForDisplay(match)) {
    return { kind: 'finished', label: 'FINISHED', elapsed: 90 }
  }

  const ageMin = kickoffAgeMinutes(match)
  const short = inferLiveShort(rawShort, ageMin)
  const elapsed = estimateLiveElapsed(rawShort, ageMin)

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
  if (short === '2H' && ageMin >= 115) {
    return {
      kind: 'extratime',
      label: elapsed != null && elapsed > 90 ? `ET ${elapsed}'` : 'ET',
      elapsed,
    }
  }
  if (short === 'P') {
    return { kind: 'penalties', label: 'PENALTIES', elapsed }
  }
  if (LIVE_STATUS_SHORT.includes(short) || LIVE_STATUS_SHORT.includes(rawShort)) {
    return { kind: 'live', label: 'LIVE', elapsed }
  }
  return { kind: 'other', label: short || '—', elapsed }
}
