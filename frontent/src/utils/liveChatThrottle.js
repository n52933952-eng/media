export const LIVE_CHAT_SEND_COOLDOWN_MS = 3000
export const LIVE_CHAT_BATCH_FLUSH_MS = 300
export const LIVE_CHAT_MAX_MESSAGES = 100

export function canSendLiveChat(lastSentAt, now = Date.now()) {
  if (!lastSentAt) return true
  return now - lastSentAt >= LIVE_CHAT_SEND_COOLDOWN_MS
}

export function createLiveChatBatchSink(onFlush, flushMs = LIVE_CHAT_BATCH_FLUSH_MS) {
  let queue = []
  let timer = null

  const flush = () => {
    timer = null
    if (!queue.length) return
    const batch = queue
    queue = []
    onFlush(batch)
  }

  return {
    push(sender, text) {
      const trimmed = String(text || '').trim()
      const name = String(sender || '').trim()
      if (!trimmed || !name) return
      queue.push({ sender: name, text: trimmed })
      if (!timer) timer = setTimeout(flush, flushMs)
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      flush()
    },
    clear() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      queue = []
    },
  }
}
