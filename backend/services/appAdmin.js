/** App owners who can remove any post. Set admin:true on the user, or ADMIN_USERNAMES=you,other */
export function isAppAdmin(user) {
  if (!user) return false
  if (user.admin === true) return true
  const names = String(process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const username = String(user.username || '').trim().toLowerCase()
  return !!username && names.includes(username)
}
