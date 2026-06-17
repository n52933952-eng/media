export const idStr = (id) => {
  if (id == null || id === '') return ''
  if (typeof id === 'object' && id != null && typeof id.toString === 'function') return String(id.toString()).trim()
  return String(id).trim()
}

export const isUserInOnlineList = (onlineList, userId) => {
  if (!userId || !Array.isArray(onlineList)) return false
  const target = idStr(userId)
  return onlineList.some((ou) => idStr(ou?.userId || ou?._id) === target)
}
