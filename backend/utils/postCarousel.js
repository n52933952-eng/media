export const MAX_POST_CAROUSEL_IMAGES = 4

/** Soft cap for collaborative posts — keeps feed docs and fanout bounded. */
export const MAX_COLLABORATORS = 20

export function contributorIdStr(c) {
    if (c == null) return ''
    if (typeof c === 'object' && c._id != null) return String(c._id)
    return String(c)
}

export function isVideoUrl(url) {
    const raw = String(url || '')
    return /\.(mp4|webm|ogg|mov)$/i.test(raw) || raw.includes('/video/upload/')
}

/** Owner carousel URLs in order (images[] or legacy img). */
export function getOwnerCarouselUrls(post) {
    const fromArray = Array.isArray(post?.images)
        ? post.images.map(String).filter((u) => u && !isVideoUrl(u))
        : []
    if (fromArray.length) return fromArray.slice(0, MAX_POST_CAROUSEL_IMAGES)
    const legacy = post?.img ? String(post.img) : ''
    if (legacy && !isVideoUrl(legacy)) return [legacy]
    return []
}

/** Full feed carousel: owner images first, then collaborative contributor photos. */
export function getPostCarouselUrls(post) {
    const ownerId = contributorIdStr(post?.postedBy)
    const urls = [...getOwnerCarouselUrls(post)]

    if (post?.isCollaborative) {
        const seen = new Set(urls)
        const byUser = new Map()
        for (const row of post.collaboratorImages || []) {
            if (row?.userId && row?.img && !isVideoUrl(String(row.img))) {
                byUser.set(String(row.userId), String(row.img))
            }
        }
        for (const c of post.contributors || []) {
            const cid = contributorIdStr(c)
            if (!cid || cid === ownerId) continue
            const u = byUser.get(cid)
            if (u && !seen.has(u)) {
                urls.push(u)
                seen.add(u)
            }
        }
    }

    return urls
}

export function getPostCarouselAudio(post) {
    const a = post?.audio
    return a ? String(a) : null
}
