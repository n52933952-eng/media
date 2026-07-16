import { useCallback, useContext, useRef, useState } from 'react'
import { SocketContext } from '../context/SocketContext'
import { UserContext } from '../context/UserContext'
import API_BASE_URL from '../config/api'
import {
  createOpponentPagerState,
  fetchNextOnlineOpponentBatch,
  GAME_OPPONENT_PAGE_SIZE,
} from './fetchOnlineGameOpponents.js'

/**
 * Paginated online opponents for chess/card/race challenge modals (9 at a time).
 */
export function useOnlineGameOpponents() {
  const { user } = useContext(UserContext)
  const { onlineUsers, mergePresenceWatchIds } = useContext(SocketContext) || {}
  const [availableUsers, setAvailableUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [busyUsers, setBusyUsers] = useState([])
  const [hasConnections, setHasConnections] = useState(false)
  const opponentPagerRef = useRef(createOpponentPagerState())
  const opponentShownIdsRef = useRef(new Set())

  const baseUrl =
    API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

  const fetchBusyGameUserIds = useCallback(async () => {
    try {
      const busyRes = await fetch(`${baseUrl}/api/user/busyGameUsers`, {
        credentials: 'include',
      })
      if (busyRes.ok) {
        const { busyUserIds } = await busyRes.json()
        const ids = busyUserIds || []
        setBusyUsers(ids)
        return ids
      }
    } catch {
      /* ignore */
    }
    return []
  }, [baseUrl])

  const idStr = (id) => {
    const raw = id?._id ?? id
    const str = (typeof raw?.toString === 'function' ? raw.toString() : String(raw ?? '')).trim()
    return /^[0-9a-fA-F]{24}$/.test(str) ? str : null
  }

  const isUserOnlineNow = useCallback(
    (userId) => {
      const target = idStr(userId)
      if (!target) return false
      return (Array.isArray(onlineUsers) ? onlineUsers : []).some((o) => {
        const oid =
          typeof o === 'object' && o !== null ? o.userId?.toString() : o?.toString()
        return oid === target
      })
    },
    [onlineUsers],
  )

  const fetchAvailableUsers = useCallback(
    async (mode = 'replace') => {
      if (!user?._id) return
      if (mode === 'append') {
        if (loadingMore || loading || opponentPagerRef.current.done) return
        setLoadingMore(true)
      } else {
        setLoading(true)
        opponentPagerRef.current = createOpponentPagerState()
        opponentShownIdsRef.current = new Set()
        setAvailableUsers([])
        setHasMore(false)
        setHasConnections(false)
      }
      try {
        const busyIdsNow = mode === 'replace' ? await fetchBusyGameUserIds() : busyUsers
        const watched = []
        const { users, pager } = await fetchNextOnlineOpponentBatch({
          baseUrl,
          currentUserId: user._id,
          isOnline: isUserOnlineNow,
          busyUserIds: busyIdsNow,
          pager: opponentPagerRef.current,
          alreadyShownIds: opponentShownIdsRef.current,
          targetCount: GAME_OPPONENT_PAGE_SIZE,
          beforeFilterPage: async (pageUsers) => {
            if (pageUsers.length) setHasConnections(true)
            for (const u of pageUsers) {
              if (!watched.includes(u._id)) watched.push(u._id)
            }
            if (typeof mergePresenceWatchIds === 'function') mergePresenceWatchIds(watched)
            await new Promise((r) => setTimeout(r, 280))
          },
        })
        opponentPagerRef.current = pager
        for (const u of users) opponentShownIdsRef.current.add(u._id)
        setAvailableUsers((prev) => (mode === 'replace' ? users : [...prev, ...users]))
        setHasMore(!pager.done)
      } catch (error) {
        console.error('Error fetching opponents:', error)
        if (mode === 'replace') {
          setAvailableUsers([])
          setHasMore(false)
        }
      } finally {
        if (mode === 'replace') setLoading(false)
        else setLoadingMore(false)
      }
    },
    [
      user?._id,
      loadingMore,
      loading,
      busyUsers,
      baseUrl,
      fetchBusyGameUserIds,
      isUserOnlineNow,
      mergePresenceWatchIds,
    ],
  )

  const handleModalScroll = useCallback(
    (e) => {
      const el = e.currentTarget
      if (!el || loadingMore || loading || !hasMore) return
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
        void fetchAvailableUsers('append')
      }
    },
    [loadingMore, loading, hasMore, fetchAvailableUsers],
  )

  return {
    availableUsers,
    loading,
    loadingMore,
    hasMore,
    hasConnections,
    busyUsers,
    setBusyUsers,
    fetchBusyGameUserIds,
    fetchAvailableUsers,
    handleModalScroll,
  }
}
