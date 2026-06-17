const postKey = (userId) => `feedHiddenPosts:${userId}`
const sourceKey = (userId) => `feedHiddenSources:${userId}`

export function loadHiddenFeedPostIds(userId) {
  if (!userId) return new Set()
  try {
    const raw = localStorage.getItem(postKey(userId))
    const arr = raw ? JSON.parse(raw) : []
    return new Set((Array.isArray(arr) ? arr : []).map(String))
  } catch {
    return new Set()
  }
}

export function saveHiddenFeedPostIds(userId, ids) {
  if (!userId) return
  try {
    localStorage.setItem(postKey(userId), JSON.stringify([...ids]))
  } catch (_) {}
}

export function loadHiddenFeedSources(userId) {
  if (!userId) return new Set()
  try {
    const raw = localStorage.getItem(sourceKey(userId))
    const arr = raw ? JSON.parse(raw) : []
    return new Set((Array.isArray(arr) ? arr : []).map(String))
  } catch {
    return new Set()
  }
}

export function saveHiddenFeedSources(userId, sources) {
  if (!userId) return
  try {
    localStorage.setItem(sourceKey(userId), JSON.stringify([...sources]))
  } catch (_) {}
}

export function filterPostsForFeed(list, hiddenIds, hiddenSources) {
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set()
  const sources = hiddenSources instanceof Set ? hiddenSources : new Set()
  return (Array.isArray(list) ? list : []).filter((p) => {
    const idOk = p?._id && !hidden.has(String(p._id))
    if (!idOk) return false
    const uname = p?.postedBy?.username ? String(p.postedBy.username) : ''
    if (uname && sources.has(uname)) return false
    return true
  })
}
