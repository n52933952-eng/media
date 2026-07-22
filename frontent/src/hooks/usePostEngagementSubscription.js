import { useEffect } from 'react'

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

/** Join a post room while the card is mounted — receives live like/comment counts. */
export function usePostEngagementSubscription(socket, postId) {
  useEffect(() => {
    if (!socket || !postId) return undefined
    const pid = String(postId)
    if (!OBJECT_ID_RE.test(pid)) return undefined

    const subscribe = () => {
      if (socket.connected) socket.emit('postSubscribeAdd', { postId: pid })
    }
    const unsubscribe = () => {
      if (socket.connected) socket.emit('postSubscribeRemove', { postId: pid })
    }

    subscribe()
    const onConnect = () => subscribe()
    socket.on('connect', onConnect)

    return () => {
      socket.off('connect', onConnect)
      unsubscribe()
    }
  }, [socket, postId])
}

/** Apply a postEngagement socket payload onto a post object. */
export function applyPostEngagement(post, data) {
  if (!post || !data) return post
  const postId = post._id?.toString?.()
  const incomingId = data.postId?.toString?.()
  if (!postId || !incomingId || postId !== incomingId) return post

  const next = { ...post }
  if (typeof data.likeCount === 'number') next.likeCount = data.likeCount
  if (data.likePreview !== undefined) next.likePreview = data.likePreview
  if (typeof data.replyCount === 'number') next.replyCount = data.replyCount
  if (data.replyPreview !== undefined) next.replyPreview = data.replyPreview
  return next
}
