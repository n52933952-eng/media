
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { UserContext } from './UserContext'
import {
  filterPostsForFeed,
  loadHiddenFeedPostIds,
  loadHiddenFeedSources,
  saveHiddenFeedPostIds,
  saveHiddenFeedSources,
} from '../utils/feedHiddenStorage'

const apiBase = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

// eslint-disable-next-line react-refresh/only-export-components
export const PostContext = createContext({})

export function PostContextProvider({ children }) {
  const { user } = useContext(UserContext) || {}
  const [followPost, setFollowPost] = useState([])
  const [hiddenFeedPostIds, setHiddenFeedPostIds] = useState(() => new Set())
  const [hiddenFeedSources, setHiddenFeedSources] = useState(() => new Set())
  const hiddenPostIdsRef = useRef(new Set())
  const hiddenSourcesRef = useRef(new Set())

  useEffect(() => {
    const uid = user?._id ? String(user._id) : ''
    if (!uid) {
      setHiddenFeedPostIds(new Set())
      setHiddenFeedSources(new Set())
      hiddenPostIdsRef.current = new Set()
      hiddenSourcesRef.current = new Set()
      setFollowPost([])
      return
    }
    const posts = loadHiddenFeedPostIds(uid)
    const sources = loadHiddenFeedSources(uid)
    setHiddenFeedPostIds(posts)
    setHiddenFeedSources(sources)
    hiddenPostIdsRef.current = posts
    hiddenSourcesRef.current = sources

    ;(async () => {
      try {
        const res = await fetch(`${apiBase()}/api/post/feed/hidden-ids`, { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        const serverIds = new Set((Array.isArray(data?.postIds) ? data.postIds : []).map(String))
        const merged = new Set([...posts, ...serverIds])
        setHiddenFeedPostIds(merged)
        hiddenPostIdsRef.current = merged
        saveHiddenFeedPostIds(uid, merged)
      } catch (_) {}
    })()
  }, [user?._id])

  useEffect(() => {
    setFollowPost((prev) => filterPostsForFeed(prev, hiddenPostIdsRef.current, hiddenSourcesRef.current))
  }, [hiddenFeedPostIds, hiddenFeedSources])

  const hideFeedPostFromFeed = useCallback(async (postId) => {
    const id = String(postId)
    const res = await fetch(`${apiBase()}/api/post/feed/hide/${id}`, {
      method: 'PUT',
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Failed to hide post')
    const hiddenId = String(data?.postId || id)
    setHiddenFeedPostIds((prev) => {
      const next = new Set(prev)
      next.add(hiddenId)
      hiddenPostIdsRef.current = next
      if (user?._id) saveHiddenFeedPostIds(String(user._id), next)
      return next
    })
    setFollowPost((prev) => prev.filter((p) => String(p._id) !== id))
  }, [user?._id])

  const hideFeedSourceFromFeed = useCallback((username) => {
    const uname = String(username || '').trim()
    if (!uname) return
    setHiddenFeedSources((prev) => {
      const next = new Set(prev)
      next.add(uname)
      hiddenSourcesRef.current = next
      if (user?._id) saveHiddenFeedSources(String(user._id), next)
      return next
    })
    setFollowPost((prev) => prev.filter((p) => String(p?.postedBy?.username || '') !== uname))
  }, [user?._id])

  const filterFeedPosts = useCallback((list) => {
    return filterPostsForFeed(list, hiddenPostIdsRef.current, hiddenSourcesRef.current)
  }, [])

  return (
    <PostContext.Provider value={{
      followPost,
      setFollowPost,
      hideFeedPostFromFeed,
      hideFeedSourceFromFeed,
      filterFeedPosts,
    }}>
      {children}
    </PostContext.Provider>
  )
}
