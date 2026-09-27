/** App owners who can remove any post. Set admin:true on the user, or ADMIN_USERNAMES=you,other */
export function isAppAdmin(user) {
  if (!user) return false
  if (user.admin === true) return true
  const names = String(process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (!names.length) return false
  const username = String(user.username || '').trim().toLowerCase()
  const email = String(user.email || '').trim().toLowerCase()
  return names.includes(username) || (!!email && names.includes(email))
}
