export function uidOf(v) {
  if (!v) return ''
  if (typeof v === 'string') return v
  return String(v._id || v)
}

export function otherParty(item, meId) {
  return uidOf(item?.sender) === String(meId) ? item?.receiver : item?.sender
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
