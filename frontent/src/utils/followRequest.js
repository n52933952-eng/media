/** Headers for POST /api/user/follow/:id — tells backend to use web follow email rules. */
export const followPostHeaders = {
  'Content-Type': 'application/json',
  'X-Client-Type': 'web',
}
