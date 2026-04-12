import { createContext, useEffect, useMemo, useRef, useState } from 'react'
import API_BASE_URL from '../config/api'


// eslint-disable-next-line react-refresh/only-export-components
export const UserContext = createContext({})


const getInilizeState =() => {
  const current = localStorage.getItem("userInfo")
  return current ? JSON.parse(current) : null
}


export function UserContextProvider({ children }) {
  const [user, setUser] = useState(getInilizeState)
  const [orientation, setOrientation] = useState(() => localStorage.getItem('chessOrientation') || null)
  const refetchTimerRef = useRef(null)
  const userIdRef = useRef(null)
  userIdRef.current = user?._id

  // When user returns to this tab (e.g. unfollowed Football on mobile), refresh session so Follow/Unfollow matches server
  useEffect(() => {
    if (!user?._id) return undefined

    const baseUrl = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

    const refetchMe = () => {
      if (document.visibilityState !== 'visible') return
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
      }
      refetchTimerRef.current = window.setTimeout(async () => {
        refetchTimerRef.current = null
        const uid = userIdRef.current
        if (!uid) return
        try {
          const res = await fetch(`${baseUrl}/api/user/me`, { credentials: 'include' })
          if (!res.ok) return
          const data = await res.json()
          if (data.error || !data._id) return
          if (String(data._id) !== String(uid)) return
          const userData = { ...data, _id: data._id || data.id }
          setUser((prev) => ({ ...(prev || {}), ...userData }))
          try {
            let prev = {}
            try {
              prev = JSON.parse(localStorage.getItem('userInfo') || '{}')
            } catch {
              prev = {}
            }
            localStorage.setItem('userInfo', JSON.stringify({ ...prev, ...userData }))
          } catch {
            /* ignore quota */
          }
        } catch {
          /* ignore network */
        }
      }, 350)
    }

    document.addEventListener('visibilitychange', refetchMe)
    window.addEventListener('focus', refetchMe)
    window.addEventListener('pageshow', refetchMe)
    // First paint often still has stale userInfo from localStorage (e.g. unfollowed on mobile earlier)
    queueMicrotask(refetchMe)

    return () => {
      document.removeEventListener('visibilitychange', refetchMe)
      window.removeEventListener('focus', refetchMe)
      window.removeEventListener('pageshow', refetchMe)
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
        refetchTimerRef.current = null
      }
    }
  }, [user?._id])

  const value = useMemo(
    () => ({ user, setUser, orientation, setOrientation }),
    [user, orientation]
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

