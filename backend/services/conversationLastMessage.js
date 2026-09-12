/** Chat list preview label for an attachment-only message. */
export function mediaPreviewLabel(img) {
  const url = String(img || '').trim()
  if (!url) return ''
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url) || url.includes('/video/upload/')
    ? '🎥 Video'
    : '📷 Image'
}

/** Build denormalized conversation.lastMessage from a Message doc (or lean row). */
export function buildConversationLastMessageFromMessage(msg) {
  if (!msg) {
    return {
      text: '',
      sender: null,
      seen: false,
      delivered: false,
      createdAt: null,
      messageId: null,
    }
  }
  const text = (msg.text && String(msg.text).trim()) || mediaPreviewLabel(msg.img)
  return {
    text,
    sender: msg.sender ?? null,
    seen: msg.seen === true,
    delivered: msg.delivered === true,
    createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
    messageId: msg._id ?? null,
  }
}

/** True when list API can trust Conversation.lastMessage without a messages $lookup. */
export function isConversationLastMessageDenormComplete(lastMessage) {
  if (!lastMessage || lastMessage.sender == null) return false
  if (!lastMessage.createdAt) return false
  return true
}
