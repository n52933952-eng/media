export const MAX_POST_CAROUSEL_IMAGES = 4

export function contributorIdStr(c) {
  if (c == null) return ''
  if (typeof c === 'object' && c._id != null) return String(c._id)
  return String(c)
}

export function isVideoUrl(url) {
  const raw = String(url || '')
  return /\.(mp4|webm|ogg|mov)$/i.test(raw) || raw.includes('/video/upload/')
}

function getOwnerImageUrls(post) {
  const fromArray = Array.isArray(post?.images)
    ? post.images.map(String).filter((u) => u && !isVideoUrl(u))
    : []
  if (fromArray.length) return fromArray.slice(0, MAX_POST_CAROUSEL_IMAGES)
  const legacy = post?.img ? String(post.img) : ''
  if (legacy && !isVideoUrl(legacy)) return [legacy]
  return []
}

export function getPostCarouselSlides(post) {
  const ownerId = contributorIdStr(post?.postedBy)
  const postedByObj = typeof post?.postedBy === 'object' ? post.postedBy : null
  const slides = []

  for (const img of getOwnerImageUrls(post)) {
    slides.push({
      key: `owner-${img}`,
      userId: ownerId,
      img,
      name: postedByObj?.name,
      username: postedByObj?.username,
      profilePic: postedByObj?.profilePic,
    })
  }

  if (post?.isCollaborative) {
    const ownerUrls = new Set(getOwnerImageUrls(post))
    const byUser = new Map()
    for (const row of post.collaboratorImages || []) {
      if (row?.userId && row?.img && !isVideoUrl(String(row.img))) {
        byUser.set(String(row.userId), String(row.img))
      }
    }
    for (const c of post.contributors || []) {
      const cid = contributorIdStr(c)
      if (!cid || cid === ownerId) continue
      const img = byUser.get(cid)
      if (!img || ownerUrls.has(img)) continue
      const cObj = typeof c === 'object' ? c : null
      slides.push({
        key: `contrib-${cid}-${img}`,
        userId: cid,
        img,
        name: cObj?.name,
        username: cObj?.username,
        profilePic: cObj?.profilePic,
      })
    }
  }

  return slides
}

export function getPostCarouselAudio(post) {
  const a = post?.audio
  return a ? String(a) : null
}

export function shouldShowPostCarousel(post) {
  const slides = getPostCarouselSlides(post)
  if (slides.length > 1) return true
  if (slides.length === 1 && Array.isArray(post?.images) && post.images.length > 0) return true
  if (slides.length === 1 && getPostCarouselAudio(post)) return true
  if (post?.isCollaborative && slides.length > 0) return true
  return false
}
