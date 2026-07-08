import { deleteMediaAsset } from '../services/mediaStorage.js'

export function contributorIdStr(c) {
    if (c == null) return ''
    if (typeof c === 'object' && c._id != null) return String(c._id)
    return String(c)
}

export async function upsertCollaboratorImage(post, userId, imgUrl) {
    if (!Array.isArray(post.collaboratorImages)) post.collaboratorImages = []
    const uid = String(userId)
    const idx = post.collaboratorImages.findIndex((e) => String(e.userId) === uid)
    if (idx >= 0) {
        const old = post.collaboratorImages[idx].img
        if (old && old !== imgUrl) {
            await deleteMediaAsset(old).catch(() => {})
        }
        post.collaboratorImages[idx].img = imgUrl
    } else {
        post.collaboratorImages.push({ userId: uid, img: imgUrl })
    }
    const ownerId = contributorIdStr(post.postedBy)
    if (uid === ownerId) {
        if (post.img && post.img !== imgUrl) {
            await deleteMediaAsset(post.img).catch(() => {})
        }
        post.img = imgUrl
        // Feed carousel reads post.images[] first — keep owner slot in sync.
        if (Array.isArray(post.images) && post.images.length > 0) {
            const oldFirst = post.images[0]
            if (oldFirst && oldFirst !== imgUrl) {
                await deleteMediaAsset(oldFirst).catch(() => {})
            }
            post.images[0] = imgUrl
        } else {
            post.images = [imgUrl]
        }
        post.markModified('images')
    }
    post.markModified('collaboratorImages')
}

export async function removeCollaboratorImageForUser(post, userId) {
    const uid = String(userId)
    const ownerId = contributorIdStr(post.postedBy)
    if (!Array.isArray(post.collaboratorImages)) post.collaboratorImages = []

    let removedUrl = null
    const idx = post.collaboratorImages.findIndex((e) => String(e.userId) === uid)
    if (idx >= 0) {
        removedUrl = post.collaboratorImages[idx].img
        post.collaboratorImages.splice(idx, 1)
        post.markModified('collaboratorImages')
    }

    if (uid === ownerId) {
        if (!removedUrl && post.img) removedUrl = String(post.img)
        post.img = undefined
        if (Array.isArray(post.images)) {
            if (removedUrl) {
                post.images = post.images.filter((u) => String(u) !== String(removedUrl))
            } else {
                post.images = []
            }
            post.markModified('images')
        }
    }

    if (removedUrl) await deleteMediaAsset(removedUrl).catch(() => {})
}

/** Ordered carousel URLs: owner first, then contributors (matches client). */
export function getCollaborativeCarouselUrls(post) {
    if (!post?.isCollaborative) {
        const img = post?.img ? String(post.img) : ''
        return img ? [img] : []
    }
    const ownerId = contributorIdStr(post.postedBy)
    const byUser = new Map()
    for (const row of post.collaboratorImages || []) {
        if (row?.userId && row?.img) byUser.set(String(row.userId), String(row.img))
    }
    const urls = []
    const ownerImg = byUser.get(ownerId) || (post.img ? String(post.img) : '')
    if (ownerImg) urls.push(ownerImg)
    for (const c of post.contributors || []) {
        const cid = contributorIdStr(c)
        if (!cid || cid === ownerId) continue
        const u = byUser.get(cid)
        if (u) urls.push(u)
    }
    return urls
}
