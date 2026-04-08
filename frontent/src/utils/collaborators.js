/** Usernames excluded from collaborator pick / search (channels & system accounts). — aligned with mobile */
export const SYSTEM_COLLABORATOR_USERNAMES = new Set([
  'Weather',
  'Football',
  'AlJazeera',
  'NBCNews',
  'BeinSportsNews',
  'SkyNews',
  'Cartoonito',
  'NatGeoKids',
  'SciShowKids',
  'JJAnimalTime',
  'KidsArabic',
  'NatGeoAnimals',
  'MBCDrama',
  'Fox11',
])

/**
 * @param {string|undefined} creatorId
 * @param {{ _id: string }[]} extra
 * @returns {string[]}
 */
export function buildInitialContributorIds(creatorId, extra = []) {
  if (!creatorId) return []
  const ids = new Set()
  ids.add(String(creatorId))
  extra.forEach((u) => {
    const id = u && u._id != null ? String(u._id) : ''
    if (id && id !== String(creatorId)) ids.add(id)
  })
  return Array.from(ids)
}
