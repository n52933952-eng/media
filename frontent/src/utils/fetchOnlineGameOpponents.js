/** How many online opponents to show / load per scroll batch. */
export const GAME_OPPONENT_PAGE_SIZE = 9
/** How many connections to scan per API call (bigger = fewer round-trips). */
export const GAME_OPPONENT_SCAN_PAGE_SIZE = 48

/**
 * @typedef {{ source: 'following' | 'followers', skip: number, done: boolean }} OpponentPagerState
 */

export function createOpponentPagerState() {
  return { source: 'following', skip: 0, done: false }
}

function normalizeFollowListResponse(data) {
  if (data && typeof data === 'object' && Array.isArray(data.users)) {
    return {
      users: data.users,
      hasMore: !!data.hasMore,
      nextSkip: typeof data.nextSkip === 'number' ? data.nextSkip : data.users.length,
    }
  }
  if (Array.isArray(data)) {
    return { users: data, hasMore: false, nextSkip: data.length }
  }
  return { users: [], hasMore: false, nextSkip: 0 }
}

function toOpponent(u) {
  if (!u?._id) return null
  const id = String(u._id)
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null
  return {
    _id: id,
    name: u.name || u.username || 'User',
    username: u.username || '',
    profilePic: u.profilePic,
  }
}

async function fetchConnectionPage(baseUrl, source, skip, pageSize) {
  const path = source === 'following' ? '/api/user/following' : '/api/user/followers'
  const res = await fetch(`${baseUrl}${path}?limit=${pageSize}&skip=${skip}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('follow list failed')
  return normalizeFollowListResponse(await res.json())
}

/**
 * Next batch of online, non-busy opponents (default 9).
 * Pages following then followers until the batch is full or lists end.
 */
export async function fetchNextOnlineOpponentBatch({
  baseUrl,
  currentUserId,
  isOnline,
  busyUserIds = [],
  pager,
  alreadyShownIds,
  targetCount = GAME_OPPONENT_PAGE_SIZE,
  connectionPageSize = GAME_OPPONENT_SCAN_PAGE_SIZE,
  beforeFilterPage,
}) {
  const nextPager = { ...pager }
  const busy = new Set([...busyUserIds].map((id) => String(id)).filter(Boolean))
  const already = alreadyShownIds instanceof Set ? alreadyShownIds : new Set(alreadyShownIds || [])
  const myId = String(currentUserId || '')
  const collected = []
  let fetches = 0
  const maxFetches = 12

  while (collected.length < targetCount && !nextPager.done && fetches < maxFetches) {
    fetches += 1
    let page
    try {
      page = await fetchConnectionPage(baseUrl, nextPager.source, nextPager.skip, connectionPageSize)
    } catch {
      if (nextPager.source === 'following') {
        nextPager.source = 'followers'
        nextPager.skip = 0
        continue
      }
      nextPager.done = true
      break
    }

    const pageUsers = []
    for (const raw of page.users) {
      const u = toOpponent(raw)
      if (u) pageUsers.push(u)
    }
    if (beforeFilterPage && pageUsers.length) {
      await beforeFilterPage(pageUsers)
    }

    for (const u of pageUsers) {
      if (!u._id || u._id === myId) continue
      if (already.has(u._id) || collected.some((c) => c._id === u._id)) continue
      if (typeof isOnline === 'function' && !isOnline(u._id)) continue
      if (busy.has(u._id)) continue
      collected.push(u)
      if (collected.length >= targetCount) break
    }

    if (page.hasMore) {
      nextPager.skip = page.nextSkip
    } else if (nextPager.source === 'following') {
      nextPager.source = 'followers'
      nextPager.skip = 0
    } else {
      nextPager.done = true
    }
  }

  return { users: collected, pager: nextPager }
}
