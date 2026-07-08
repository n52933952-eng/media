
import mongoose from 'mongoose'
import User from '../models/user.js'
import Post, { MAX_REPLIES_PER_POST } from '../models/post.js'
import Like from '../models/like.js'
import Follow from '../models/follow.js'
import LiveStream from '../models/liveStream.js'
import { deleteMediaAsset, deleteAllPostMedia } from '../services/mediaStorage.js'
import { assertManagedMediaUrls } from '../services/r2Presign.js'
import { getIO, getUserSocket } from '../socket/socket.js'
import { emitToUserIds, collectSocketIdsForUserIds } from '../services/postSocketEmit.js'
import { dedupeGamePostsForFeed } from '../utils/dedupeGameFeedPosts.js'
import { enrichGoFishPostsForFeed } from '../utils/enrichGoFishFeedPosts.js'
import { normalizeGamePlayers } from '../utils/gameFeedPostUtils.js'
import {
    addHiddenFeedPostForUser,
    getHiddenFeedPostObjectIds,
    getHiddenFeedPostIdStrings,
    hiddenPostQueryFilter,
} from '../services/feedHiddenPosts.js'
import { getCachedFeed, setCachedFeed, invalidateUserFeedCache } from '../services/feedCache.js'
import {
    encodeFeedCursor,
    decodeFeedCursor,
    FEED_FIRST_PAGE_NORMAL_COUNT,
    storeFeedNormalIndex,
} from '../services/feedCursor.js'
import {
    getFeedNormalIndex,
    populateFeedPostsByIds,
    fetchChannelPostsForUser,
    feedSortTime,
} from '../services/feedAssembly.js'
import {
    createComment,
    findCommentById,
    findCommentThreadRoot,
    deleteCommentTree,
    toggleCommentLike,
    attachRepliesToPost,
    attachReplyCountsToPosts,
    getCommentCountForPost,
    getPostCommentsPaginated,
    getUserCommentsPaginated,
    deleteCommentsForPost,
} from '../services/commentService.js'
import { findPostsByGameRoomId } from '../services/gamePostLookup.js'
import {
    upsertCollaboratorImage,
    removeCollaboratorImageForUser,
} from '../utils/collaboratorImages.js'
import { MAX_POST_CAROUSEL_IMAGES, MAX_COLLABORATORS } from '../utils/postCarousel.js'

/** Normalize contributor id list: unique strings, owner first. Returns null if over max. */
function normalizeContributorIds(rawList, ownerId) {
    const owner = ownerId != null ? String(ownerId) : ''
    const seen = new Set()
    const out = []
    if (owner) {
        seen.add(owner)
        out.push(owner)
    }
    for (const item of Array.isArray(rawList) ? rawList : []) {
        const id =
            item != null && typeof item === 'object' && item._id != null
                ? String(item._id)
                : item != null
                  ? String(item)
                  : ''
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push(id)
    }
    if (out.length > MAX_COLLABORATORS) return null
    return out
}

/** Client already uploaded to R2 — accept public URLs only. */
function collectCreatePostMediaUrls(body = {}) {
    const images = []
    if (Array.isArray(body.images)) {
        for (const u of body.images) {
            const s = u != null ? String(u).trim() : ''
            if (s) images.push(s)
        }
    } else if (body.img) {
        images.push(String(body.img).trim())
    }
    const audio = body.audio != null && String(body.audio).trim() ? String(body.audio).trim() : null
    return { images, audio }
}

/**
 * Feed scalability: likes live in the Like collection now. The feed only needs "how many"
 * (`post.likeCount`) and "did I like it" (`likedByMe`, from a batched per-page lookup — see
 * buildLikedPostIdSet). We still fall back to the legacy `likes[]` for any un-backfilled docs.
 * Live pseudo-posts have no likes and pass through untouched.
 */
function shapeFeedPostForViewer(post, viewerIdStr, likedSet, previewMap) {
    if (!post || post.isLive) return post
    const postIdStr = post._id != null ? String(post._id) : ''
    const likeCount =
        typeof post.likeCount === 'number'
            ? post.likeCount
            : (Array.isArray(post.likes) ? post.likes.length : 0)
    let likedByMe = false
    if (viewerIdStr) {
        if (likedSet) likedByMe = likedSet.has(postIdStr)
        else if (Array.isArray(post.likes)) likedByMe = post.likes.some((id) => String(id) === viewerIdStr)
    }
    const likePreview = previewMap ? (previewMap.get(postIdStr) || null) : null
    const { likes: _likes, ...rest } = post
    return { ...rest, likeCount, likedByMe, likePreview }
}

/**
 * One indexed query → Set of postId strings (from `posts`) that `viewerIdStr` has liked.
 * Powers `likedByMe` for an entire feed/profile page without loading any likes arrays.
 */
async function buildLikedPostIdSet(viewerIdStr, posts) {
    if (!viewerIdStr || !Array.isArray(posts) || posts.length === 0) return new Set()
    const ids = posts
        .filter(
            (p) =>
                p && !p.isLive && p._id != null && mongoose.Types.ObjectId.isValid(String(p._id)),
        )
        .map((p) => String(p._id))
    if (ids.length === 0) return new Set()
    const likedRows = await Like.find({ user: viewerIdStr, post: { $in: ids } })
        .select('post')
        .lean()
    return new Set(likedRows.map((r) => String(r.post)))
}

/**
 * One aggregation → Map<postIdStr, {_id, username, name, profilePic}> of the most-recent
 * liker per post, so the feed can render a "liked by [avatar]" preview without an extra
 * request per card. Uses the {post:1, _id:-1} index and one batched User lookup, so it
 * scales to a full page of posts with just two queries total.
 */
async function buildLikePreviewMap(posts) {
    if (!Array.isArray(posts) || posts.length === 0) return new Map()
    const objectIds = posts
        .filter(
            (p) =>
                p && !p.isLive && p._id != null && mongoose.Types.ObjectId.isValid(String(p._id)),
        )
        .map((p) => new mongoose.Types.ObjectId(String(p._id)))
    if (objectIds.length === 0) return new Map()

    const rows = await Like.aggregate([
        { $match: { post: { $in: objectIds } } },
        { $sort: { _id: -1 } },
        { $group: { _id: '$post', user: { $first: '$user' } } },
    ])
    if (!rows.length) return new Map()

    const userIds = [...new Set(rows.map((r) => String(r.user)).filter(Boolean))]
    const users = await User.find({ _id: { $in: userIds } })
        .select('_id username name profilePic')
        .lean()
    const userById = new Map(users.map((u) => [String(u._id), u]))

    const map = new Map()
    for (const r of rows) {
        const u = userById.get(String(r.user))
        if (u) {
            map.set(String(r._id), {
                _id: u._id,
                username: u.username,
                name: u.name,
                profilePic: u.profilePic || null,
            })
        }
    }
    return map
}

/**
 * Strip the legacy `likes[]` and attach `likeCount` + `likedByMe` to profile posts,
 * using a single batched Like lookup for the whole page.
 */
async function shapeProfilePostsForViewer(posts, viewerIdStr) {
    if (!Array.isArray(posts) || posts.length === 0) return []
    const [likedSet, previewMap] = await Promise.all([
        buildLikedPostIdSet(viewerIdStr, posts),
        buildLikePreviewMap(posts),
    ])
    return posts.map((p) => {
        const obj = p?.toObject ? p.toObject() : p
        const { likes: _likes, ...rest } = obj
        const likeCount =
            typeof rest.likeCount === 'number'
                ? rest.likeCount
                : (Array.isArray(obj.likes) ? obj.likes.length : 0)
        const postIdStr = rest._id != null ? String(rest._id) : ''
        return {
            ...rest,
            likeCount,
            likedByMe: viewerIdStr ? likedSet.has(postIdStr) : false,
            likePreview: previewMap.get(postIdStr) || null,
        }
    })
}

async function emitNewPostToAuthorFollowers(io, authorId, post) {
    if (!io || !authorId) return
    const followerDocs = await Follow.find({ followeeId: authorId })
        .select('followerId')
        .limit(10000)
        .lean()
    const followerIds = followerDocs.map((d) => d.followerId).filter(Boolean)
    await emitToUserIds(io, followerIds, 'newPost', post)
}

async function emitPostDeletedToAuthorFollowers(io, authorId, postId) {
    if (!io || !authorId) return
    const followerDocs = await Follow.find({ followeeId: authorId })
        .select('followerId')
        .limit(10000)
        .lean()
    const followerIds = followerDocs.map((d) => d.followerId).filter(Boolean)
    await emitToUserIds(io, followerIds, 'postDeleted', { postId: String(postId) })
}

async function collectPostUpdateRecipientIds(post, postOwnerId) {
    const ids = new Set([String(postOwnerId)])
    if (post.contributors?.length) {
        post.contributors.forEach((contributor) => {
            const contributorId = (contributor._id || contributor).toString()
            if (contributorId) ids.add(contributorId)
        })
    }
    const followerDocs = await Follow.find({ followeeId: postOwnerId })
        .select('followerId')
        .limit(10000)
        .lean()
    followerDocs.forEach((d) => {
        const followerIdStr = d.followerId?.toString?.() ?? String(d.followerId)
        if (followerIdStr) ids.add(followerIdStr)
    })
    return [...ids]
}

async function emitPostUpdatedToRecipients(io, post, postOwnerId) {
    if (!io || !post) return 0
    const recipientIds = await collectPostUpdateRecipientIds(post, postOwnerId)
    const postObj = post.toObject ? post.toObject() : JSON.parse(JSON.stringify(post))
    return emitToUserIds(io, recipientIds, 'postUpdated', {
        postId: post._id.toString(),
        post: postObj,
    })
}

/** Profile posts query for a user's authored + collaborative posts. */
function profilePostsQuery(userId) {
    return {
        $or: [
            { postedBy: userId },
            { isCollaborative: true, contributors: userId },
        ],
    }
}

/** Notify everyone listed as contributor except the poster when a collaborative post is created. */
async function notifyContributorsOnCollaborativeCreate(newPost, posterId) {
    if (!newPost?.isCollaborative || !Array.isArray(newPost.contributors)) return
    const posterStr = String(posterId)
    const others = newPost.contributors.filter((c) => {
        const cid = (c._id || c).toString()
        return cid && cid !== posterStr
    })
    if (others.length === 0) return
    const { createNotification } = await import('./notification.js')
    for (const c of others) {
        const cid = (c._id || c).toString()
        try {
            await createNotification(cid, 'collaboration', posterStr, {
                postId: newPost._id.toString(),
                postText: (newPost.text || '').substring(0, 50) || 'a collaborative post'
            })
        } catch (e) {
            console.error('❌ [notifyContributorsOnCollaborativeCreate]', cid, e)
        }
    }
}

export const createPost = async(req,res) => {

    try{
  
        const{postedBy,text,isCollaborative,contributors}= req.body
        // Clients may send contributors as a JSON string or array.
        let contributorsParsed = contributors
        if (typeof contributors === 'string') {
            try {
                const parsed = JSON.parse(contributors)
                if (Array.isArray(parsed)) contributorsParsed = parsed
            } catch {
                contributorsParsed = undefined
            }
        }
        // Only treat explicit true / "true" as collaborative (string "false" is truthy in JS)
        const wantCollaborative = isCollaborative === true || isCollaborative === 'true'
         
      let img = ''

        const textTrim = text != null ? String(text).trim() : ''

        if(!postedBy){
            return res.status(400).json({error:"postedBy is required"})
        }

        const { images: mediaUrls, audio: audioUrlRaw } = collectCreatePostMediaUrls(req.body)

        if(!textTrim && mediaUrls.length === 0){
            return res.status(400).json({error:"text or media is required"})
        }

      const user = await User.findById(postedBy)

       if(!user){
        return res.status(400).json({error:"now user"})
       } 

       if(user._id.toString() !== req.user._id.toString()){
        return res.status(400).json({error:"unthorized"})
       }

       const MaxLength = 500 

       if(textTrim.length > MaxLength){
        return res.status(500).json({error:"post text must be 500 or less"})
       }

       if (mediaUrls.length > MAX_POST_CAROUSEL_IMAGES) {
         return res.status(400).json({ error: `Maximum ${MAX_POST_CAROUSEL_IMAGES} images allowed` })
       }

       try {
         if (mediaUrls.length) {
           assertManagedMediaUrls(mediaUrls)
         }
         if (audioUrlRaw) {
           assertManagedMediaUrls([audioUrlRaw])
         }
       } catch (e) {
         return res.status(400).json({ error: e.message, code: e.code })
       }

       const isCarouselUpload = mediaUrls.length > 1 || !!audioUrlRaw
       const singleVideo =
         mediaUrls.length === 1 &&
         !isCarouselUpload &&
         (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(mediaUrls[0]) || mediaUrls[0].includes('/video/'))

       if (isCarouselUpload && mediaUrls.length === 0) {
         return res.status(400).json({ error: 'Add at least one photo for a carousel post' })
       }

       if (mediaUrls.length > 0 || audioUrlRaw) {
           const imageUrls = mediaUrls.slice(0, MAX_POST_CAROUSEL_IMAGES)
           const audioUrl = audioUrlRaw || null

           img = imageUrls[0] || ''
           const postData = { postedBy, text: textTrim, img }
           if (!singleVideo && imageUrls.length) postData.images = imageUrls
           if (audioUrl) postData.audio = audioUrl

           if (wantCollaborative) {
             const contribList = normalizeContributorIds(
               contributorsParsed && Array.isArray(contributorsParsed) ? contributorsParsed : [postedBy],
               postedBy,
             )
             if (!contribList) {
               return res.status(400).json({
                 error: `Maximum ${MAX_COLLABORATORS} contributors allowed`,
               })
             }
             postData.isCollaborative = true
             postData.contributors = contribList
             if (imageUrls.length && !singleVideo) {
               postData.collaboratorImages = [{ userId: postedBy, img: imageUrls[0] }]
             }
           }

           const newPost = new Post(postData)
           await newPost.save()

           await newPost.populate('postedBy', 'username profilePic name')
           await notifyContributorsOnCollaborativeCreate(newPost, postedBy)

           const io = getIO()
           if (io) {
             await emitNewPostToAuthorFollowers(io, postedBy, newPost)
           }

           const { createActivity } = await import('./activity.js')
           createActivity(postedBy, 'post', {
             postId: newPost._id,
             metadata: {
               text: (textTrim || '').substring(0, 50),
               hasImage: imageUrls.length > 0,
               imageCount: imageUrls.length,
               hasAudio: !!audioUrl,
             },
           }).catch((err) => {
             console.error('Error creating activity:', err)
           })

           return res.status(200).json({ message: 'post created sufully', post: newPost })
       }

       // No media URLs - text-only post
       const postData = {postedBy,text:textTrim,img}
       if (wantCollaborative) {
         const contribList = normalizeContributorIds(
           contributorsParsed && Array.isArray(contributorsParsed) ? contributorsParsed : [postedBy],
           postedBy,
         )
         if (!contribList) {
           return res.status(400).json({
             error: `Maximum ${MAX_COLLABORATORS} contributors allowed`,
           })
         }
         postData.isCollaborative = true
         postData.contributors = contribList
       }
       const newPost = new Post(postData)
       await newPost.save()
       
       // Populate postedBy for socket emission
       await newPost.populate("postedBy", "username profilePic name")
       
       await notifyContributorsOnCollaborativeCreate(newPost, postedBy)

       const io = getIO()
       if (io) {
         await emitNewPostToAuthorFollowers(io, postedBy, newPost)
       }
       
       res.status(200).json({message:"post created sufully", post: newPost})

    }
    catch(error){
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}






export const getPost = async(req,res) => {

   
    try{

        const post = await Post.findById(req.params.id)
            .select('-likes')
            .populate("postedBy", "username profilePic name")
            .populate("contributors", "username profilePic name")

        if(!post){
            return res.status(500).json({message:"no post"})
        }
  
        const includeReplies =
            req.query.includeReplies !== 'false' && req.query.includeReplies !== '0'

        let withReplies
        if (includeReplies) {
            withReplies = await attachRepliesToPost(post)
        } else {
            withReplies = post.toObject()
            const storedCount = withReplies.replyCount
            withReplies.replyCount =
                typeof storedCount === 'number' && storedCount >= 0
                    ? storedCount
                    : await getCommentCountForPost(post._id)
            withReplies.replies = []
        }
        delete withReplies.likes
        withReplies.likeCount = typeof withReplies.likeCount === 'number' ? withReplies.likeCount : 0
        // likedByMe when we know the viewer (route may be unauthenticated).
        const viewerId = req.user?._id ? String(req.user._id) : null
        withReplies.likedByMe = viewerId
            ? !!(await Like.exists({ post: req.params.id, user: viewerId }))
            : false
        // Most-recent liker preview (for the inline "liked by [avatar]" UI).
        const previewLike = await Like.findOne({ post: req.params.id })
            .sort({ _id: -1 })
            .populate('user', '_id username name profilePic')
            .lean()
        withReplies.likePreview = previewLike?.user
            ? {
                  _id: previewLike.user._id,
                  username: previewLike.user.username,
                  name: previewLike.user.name,
                  profilePic: previewLike.user.profilePic || null,
              }
            : null
        res.status(200).json(withReplies)

    }
    catch(error){
        res.status(500).json({ error: error.message })
    }


}

export const getPostComments = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id).select('_id replyCount').lean()
        if (!post) {
            return res.status(404).json({ message: 'no post' })
        }

        const { limit = 12, skip = 0, footballMatchId = null } = req.query
        const result = await getPostCommentsPaginated(req.params.id, {
            limit,
            skip,
            footballMatchId,
        })
        if (result.total == null && typeof post.replyCount === 'number') {
            result.total = post.replyCount
        }
        res.status(200).json(result)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
}

// Update post (allows owner or contributors for collaborative posts)
export const updatePost = async(req,res) => {
    try{
        const { id } = req.params
        const { text } = req.body
        const userId = req.user._id
        
        // Fetch post without populating postedBy (we need the ObjectId, not the object)
        const post = await Post.findById(id)
            .populate('contributors', '_id')
            .select('+postedBy') // Ensure postedBy is included
        
        if(!post){
            return res.status(400).json({error:"Post not found"})
        }
        
        // Get post owner ID BEFORE populating - use Mongoose's lean or direct access
        // postedBy should be ObjectId, but handle if it's already populated
        let postOwnerId
        try {
            // Try to get the _id if it's populated, otherwise it's already an ObjectId
            if (post.postedBy && post.postedBy._id) {
                // Already populated
                postOwnerId = post.postedBy._id.toString()
            } else if (post.postedBy && post.postedBy.toString) {
                // ObjectId - call toString() directly (not String() which might serialize the object)
                postOwnerId = post.postedBy.toString()
            } else {
                // Fallback
                postOwnerId = String(post.postedBy)
            }
            // Validate it's a proper ObjectId string (24 hex chars)
            if (!/^[0-9a-fA-F]{24}$/.test(postOwnerId)) {
                throw new Error('Invalid ObjectId format')
            }
        } catch (err) {
            console.error('⚠️ Error extracting postOwnerId:', err, 'postedBy:', post.postedBy)
            // If all else fails, get the raw value from the document
            const rawPost = post.toObject ? post.toObject() : post
            postOwnerId = rawPost.postedBy?.toString() || String(rawPost.postedBy)
        }
        
        // Check if user is owner
        const isOwner = postOwnerId === userId.toString()
        
        // Check if user is a contributor (for collaborative posts) — works populated or raw ObjectIds
        const isContributor =
            post.isCollaborative &&
            Array.isArray(post.contributors) &&
            post.contributors.some((c) => {
                const cid = c && c._id != null ? c._id.toString() : String(c)
                return cid === userId.toString()
            })
        
        if(!isOwner && !isContributor){
            return res.status(403).json({error:"You can only edit your own posts or collaborative posts you contribute to"})
        }
        
        // Validate text length
        const MaxLength = 500
        if(text && text.length > MaxLength){
            return res.status(400).json({error:"Post text must be 500 characters or less"})
        }

        const imgRaw = req.body.img != null ? String(req.body.img).trim() : ''
        if (imgRaw) {
            try {
                assertManagedMediaUrls([imgRaw])
            } catch (e) {
                return res.status(400).json({ error: e.message, code: e.code })
            }

            if (post.isCollaborative) {
                const isVideo =
                    /\.(mp4|webm|ogg|mov)(\?|$)/i.test(imgRaw) || imgRaw.includes('/video/')
                if (isVideo) {
                    return res.status(400).json({
                        error: 'Collaborative posts only support one photo per contributor',
                    })
                }
                await upsertCollaboratorImage(post, userId, imgRaw)
            } else {
                if (post.img && post.img !== imgRaw) {
                    await deleteMediaAsset(post.img).catch(() => {})
                }
                post.img = imgRaw
            }
        }
        
        post.text = text !== undefined && text !== null ? text : post.text
        post.editedAt = new Date()
        await post.save()
        
        // Populate for response
        await post.populate("postedBy", "username profilePic name")
        await post.populate("contributors", "username profilePic name")
        
        // Notify post owner if a contributor edited the post
        const isContributorEdit = !isOwner && isContributor
        if (isContributorEdit) {
            try {
                const { createNotification } = await import('./notification.js')
                // Use postOwnerId we got earlier (before populate)
                await createNotification(postOwnerId, 'post_edit', userId.toString(), {
                    postId: post._id.toString(),
                    postText: post.text?.substring(0, 50) || 'your collaborative post'
                })
                console.log(`📬 [updatePost] Created edit notification for post owner ${postOwnerId}`)
            } catch (err) {
                console.error('❌ [updatePost] Error creating edit notification:', err)
            }
        }
        
        // Notify all contributors if the owner edited the post
        const isOwnerEdit = isOwner && post.isCollaborative && post.contributors && post.contributors.length > 0
        if (isOwnerEdit) {
            try {
                const { createNotification } = await import('./notification.js')
                // Notify each contributor
                for (const contributor of post.contributors) {
                    const contributorId = (contributor._id || contributor).toString()
                    if (contributorId !== userId.toString()) { // Don't notify yourself
                        await createNotification(contributorId, 'post_edit', userId.toString(), {
                            postId: post._id.toString(),
                            postText: post.text?.substring(0, 50) || 'your collaborative post'
                        })
                        console.log(`📬 [updatePost] Created edit notification for contributor ${contributorId}`)
                    }
                }
            } catch (err) {
                console.error('❌ [updatePost] Error creating contributor edit notifications:', err)
            }
        }
        
        const io = getIO()
        if (io) {
            const sent = await emitPostUpdatedToRecipients(io, post, postOwnerId)
            if (sent > 0) {
                console.log(`📤 [updatePost] Emitted postUpdated to ${sent} recipient socket(s)`)
            }
        }
        
        res.status(200).json({message:"Post updated successfully", post})
    }
    catch(error){
        console.error('Error updating post:', error)
        res.status(500).json({error: error.message || "Failed to update post"})
    }
}

/** Owner only: replace carousel photos with final R2 URLs (or keep/new slots) and optional caption. */
export const updateCarouselPostImages = async (req, res) => {
    try {
        const { postId } = req.params
        const { text, imageSlots, images } = req.body
        const userId = req.user._id

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ error: 'Post not found' })
        }
        if (post.isCollaborative) {
            return res.status(400).json({ error: 'Use collaborative edit for this post' })
        }
        const existingImages = Array.isArray(post.images)
            ? post.images.map(String).filter(Boolean)
            : []
        if (existingImages.length === 0) {
            return res.status(400).json({ error: 'This post is not a carousel post' })
        }

        const postOwnerId = post.postedBy.toString()
        if (postOwnerId !== userId.toString()) {
            return res.status(403).json({ error: 'Only the post owner can edit carousel photos' })
        }

        const MaxLength = 500
        if (text != null && String(text).length > MaxLength) {
            return res.status(400).json({ error: 'Post text must be 500 characters or less' })
        }

        const oldUrlSet = new Set(existingImages)
        let finalUrls = []

        if (Array.isArray(images) && images.length > 0) {
            finalUrls = images.map((u) => (u != null ? String(u).trim() : '')).filter(Boolean)
        } else {
            let slots
            try {
                slots = typeof imageSlots === 'string' ? JSON.parse(imageSlots) : imageSlots
            } catch {
                return res.status(400).json({ error: 'Invalid imageSlots payload' })
            }

            if (!Array.isArray(slots) || slots.length === 0) {
                return res.status(400).json({ error: `Carousel must have 1–${MAX_POST_CAROUSEL_IMAGES} photos` })
            }

            for (const slot of slots) {
                if (slot?.kind === 'keep' && slot.url) {
                    const url = String(slot.url).trim()
                    if (!oldUrlSet.has(url)) {
                        return res.status(400).json({ error: 'Invalid existing image URL' })
                    }
                    finalUrls.push(url)
                } else if ((slot?.kind === 'new' || slot?.kind === 'url') && slot.url) {
                    finalUrls.push(String(slot.url).trim())
                } else {
                    return res.status(400).json({ error: 'Invalid image slot' })
                }
            }
        }

        if (finalUrls.length === 0 || finalUrls.length > MAX_POST_CAROUSEL_IMAGES) {
            return res.status(400).json({ error: `Carousel must have 1–${MAX_POST_CAROUSEL_IMAGES} photos` })
        }

        try {
            assertManagedMediaUrls(finalUrls)
        } catch (e) {
            return res.status(400).json({ error: e.message, code: e.code })
        }

        for (const url of existingImages) {
            if (!finalUrls.includes(url)) {
                await deleteMediaAsset(url).catch(() => {})
            }
        }

        post.images = finalUrls
        post.img = finalUrls[0] || post.img
        if (text !== undefined && text !== null) {
            post.text = String(text)
        }
        post.editedAt = new Date()
        await post.save()

        await post.populate('postedBy', 'username profilePic name')
        await post.populate('contributors', 'username profilePic name')

        const io = getIO()
        if (io) {
            await emitPostUpdatedToRecipients(io, post, postOwnerId)
        }

        res.status(200).json({ message: 'Carousel updated', post })
    } catch (error) {
        console.error('[updateCarouselPostImages]', error)
        res.status(500).json({ error: error.message || 'Failed to update carousel' })
    }
}

export const deletePost = async(req,res) => {
    try{
      const post = await Post.findById(req.params.id)

      if(!post){
        return res.status(400).json({message:"no post"})
      }

      // Allow deletion if:
      // 1. User is the post author, OR
      // 2. User added this channel post (channelAddedBy matches)
      const isPostAuthor = post.postedBy.toString() === req.user._id.toString()
      const isChannelPostAddedByUser = post.channelAddedBy && post.channelAddedBy === req.user._id.toString()
      
      if(!isPostAuthor && !isChannelPostAddedByUser){
        return res.status(400).json({message:"you cant delete other users post"})
      }

      await deleteAllPostMedia(post)

      // OPTIMIZED: Get followers before deleting post
      const postAuthorId = post.postedBy.toString()
      
      await Post.findByIdAndDelete(req.params.id)
      await deleteCommentsForPost(req.params.id)
      // Remove this post's likes from the Like collection.
      Like.deleteMany({ post: req.params.id }).catch((e) =>
        console.error('Error deleting post likes:', e),
      )

      const io = getIO()
      if (io) {
        await emitPostDeletedToAuthorFollowers(io, postAuthorId, req.params.id)
      }

      res.status(200).json({message:"post has deleted sucsfully"})
    }
    catch(error){
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}




export const LikePost = async(req,res) => {

    try{

     const{id} = req.params 
     const userId = req.user._id 
     const rawMid = req.body?.footballMatchId
     const mid =
         rawMid != null && String(rawMid).trim() !== ''
             ? String(rawMid).trim().slice(0, 128)
             : null
  
     // Exclude the legacy `likes` array — likes now live in the Like collection.
     const post = await Post.findById(id).select('-likes')
     
     if(!post){
        return res.status(400).json({message:"no post found"})
     }

     /** Per–match-card like (Football live list): does not toggle post.likes. */
     if (mid) {
         if (!Array.isArray(post.footballMatchLikes)) post.footballMatchLikes = []
         let entry = post.footballMatchLikes.find((e) => String(e.footballMatchId) === mid)
         if (!entry) {
             post.footballMatchLikes.push({ footballMatchId: mid, likes: [] })
             entry = post.footballMatchLikes[post.footballMatchLikes.length - 1]
         }
         const likesArr = Array.isArray(entry.likes) ? entry.likes : []
         const uidStr = userId.toString()
         const idx = likesArr.findIndex((l) => (l && l.toString ? l.toString() : String(l)) === uidStr)
         let isLikedAfter = false
         if (idx >= 0) {
             entry.likes.splice(idx, 1)
             isLikedAfter = false
         } else {
             entry.likes.push(userId)
             isLikedAfter = true
             if (post.postedBy.toString() !== uidStr) {
                 const { createNotification } = await import('./notification.js')
                 createNotification(post.postedBy, 'like', userId, {
                     postId: post._id,
                     footballMatchId: mid,
                 }).catch((err) => {
                     console.error('Error creating match-like notification:', err)
                 })
             }
             const { createActivity } = await import('./activity.js')
             createActivity(userId, 'like', {
                 postId: post._id,
                 targetUser: post.postedBy,
                 metadata: { postText: (post.text || '').substring(0, 50) || '', footballMatchId: mid },
             }).catch((err) => {
                 console.error('Error creating activity:', err)
             })
         }
         await post.save()
         const likesCount = Array.isArray(entry.likes) ? entry.likes.length : 0
         return res.status(200).json({
             scope: 'footballMatch',
             footballMatchId: mid,
             isLiked: isLikedAfter,
             likesCount,
             footballMatchLikes: post.footballMatchLikes,
         })
     }
    
     // Normal post like toggle — backed by the Like collection + denormalized likeCount.
     // Atomic + O(1): no per-post array is loaded or rewritten, so this scales to
     // millions of likers without hitting the 16MB document limit.
     const removed = await Like.findOneAndDelete({ post: id, user: userId })
     if (removed) {
         const updated = await Post.findByIdAndUpdate(
             id,
             { $inc: { likeCount: -1 } },
             { new: true },
         ).select('likeCount')
         // Guard against the counter drifting below zero (e.g. legacy/backfill edge cases).
         let count = updated?.likeCount ?? 0
         if (count < 0) {
             count = 0
             await Post.updateOne({ _id: id }, { $set: { likeCount: 0 } })
        }
        // Refresh the liker's own feed cache so a reload doesn't show the stale liked state.
        await invalidateUserFeedCache(userId)
        return res.status(200).json({ message: 'post unlike scfully', liked: false, likeCount: count })
    }

    // Newly liked — create the Like doc; ignore the unique-index race on a double tap.
    try {
        await Like.create({ post: id, user: userId })
    } catch (e) {
        if (e?.code === 11000) {
            const cur = await Post.findById(id).select('likeCount')
            await invalidateUserFeedCache(userId)
            return res.status(200).json({
                message: 'post liked scfully',
                liked: true,
                likeCount: Math.max(0, cur?.likeCount ?? 0),
            })
        }
        throw e
    }
     const updated = await Post.findByIdAndUpdate(
         id,
         { $inc: { likeCount: 1 } },
         { new: true },
     ).select('likeCount')

     // Notify the owner + record activity (like only, not unlike) — unchanged behavior.
      if (post.postedBy.toString() !== userId.toString()) {
          const { createNotification } = await import('./notification.js')
          createNotification(post.postedBy, 'like', userId, {
             postId: post._id,
          }).catch(err => {
              console.error('Error creating like notification:', err)
          })
      }
      const { createActivity } = await import('./activity.js')
      createActivity(userId, 'like', {
          postId: post._id,
          targetUser: post.postedBy,
        metadata: { postText: post.text?.substring(0, 50) || '' },
      }).catch(err => {
          console.error('Error creating activity:', err)
      })
      
    // Refresh the liker's own feed cache so a reload reflects the new liked state.
    await invalidateUserFeedCache(userId)
    return res.status(200).json({
        message: 'post liked scfully',
        liked: true,
        likeCount: Math.max(0, updated?.likeCount ?? 0),
    })
  }
    catch(error){
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}

/**
 * Paginated "who liked this post" list (Instagram style), newest-first.
 * Cursor-based over the Like collection (indexed by { post, _id }), so it stays fast
 * regardless of how many likes a post has — nothing is loaded into memory in bulk.
 *
 * GET /api/post/likes-list/:id?limit=20&cursor=<base64url>
 * → { users: [{ _id, username, name, profilePic }], total, hasMore, nextCursor }
 */
export const getPostLikes = async (req, res) => {
    try {
        const { id } = req.params
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'invalid post id' })
        }

        const rawLimit = parseInt(req.query.limit, 10)
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 50)

        // Decode cursor → last seen Like _id (paginate by _id descending = newest first).
        let cursorId = null
        const rawCursor = req.query.cursor
        if (rawCursor) {
            try {
                const decoded = JSON.parse(
                    Buffer.from(String(rawCursor), 'base64url').toString('utf8'),
                )
                if (decoded?.c && mongoose.Types.ObjectId.isValid(decoded.c)) {
                    cursorId = new mongoose.Types.ObjectId(decoded.c)
                }
            } catch (_) {
                cursorId = null
            }
        }

        const query = { post: id }
        if (cursorId) query._id = { $lt: cursorId }

        // Fetch one extra row to know if there's another page.
        const rows = await Like.find(query)
            .sort({ _id: -1 })
            .limit(limit + 1)
            .populate('user', '_id username name profilePic')
            .lean()

        const hasMore = rows.length > limit
        const pageRows = hasMore ? rows.slice(0, limit) : rows

        // Drop likes whose user was deleted; keep newest-first order from the query.
        const users = pageRows.map((r) => r.user).filter(Boolean)

        const lastRow = pageRows[pageRows.length - 1]
        const nextCursor =
            hasMore && lastRow
                ? Buffer.from(JSON.stringify({ c: String(lastRow._id) })).toString('base64url')
                : null

        // Total from the denormalized counter (fast); fall back to a count if it's missing.
        const postDoc = await Post.findById(id).select('likeCount').lean()
        let total = Number(postDoc?.likeCount)
        if (!Number.isFinite(total) || total < 0) {
            total = await Like.countDocuments({ post: id })
        }

        return res.status(200).json({ users, total, hasMore, nextCursor })
    } catch (error) {
        console.log(error)
        return res.status(500).json({ error: error.message })
    }
}






export const ReplyPost = async(req,res) => {

    try{
  
        const { text, footballMatchId: footballMatchIdRaw } = req.body
        const trimmedText = String(text || '').trim()
        if (!trimmedText) {
            return res.status(400).json({ error: 'Comment text is required', message: 'Comment text is required' })
        }
        const username = req.user.username
        const userId = req.user._id 
        const id = req.params.id 
        const userProfilePic = req.user.profilePic 

        const post = await Post.findById(id)

        if(!post){
            return res.status(400).json({message:"no post"})
        }

        let footballMatchId = null
        if (footballMatchIdRaw != null && String(footballMatchIdRaw).trim() !== '') {
            footballMatchId = String(footballMatchIdRaw).trim().slice(0, 128)
        }
     
        let savedReply
        try {
            savedReply = await createComment({
                postId: id,
            userId,
                username,
            userProfilePic,
                text: trimmedText,
                footballMatchId,
            })
        } catch (err) {
            if (err.status === 400) {
                return res.status(400).json({ error: err.message })
            }
            throw err
        }
        
        // Create notifications
        const { createNotification } = await import('./notification.js')
        const User = (await import('../models/user.js')).default
        
        // 1. Notify post owner if commenter is not the post owner
        if (post.postedBy.toString() !== userId.toString()) {
            createNotification(post.postedBy, 'comment', userId, {
                postId: post._id,
                commentText: trimmedText
            }).catch(err => {
                console.error('Error creating comment notification:', err)
            })
        }
        
        // Create activity for activity feed
        const { createActivity } = await import('./activity.js')
        createActivity(userId, 'comment', {
            postId: post._id,
            targetUser: post.postedBy,
            metadata: { commentText: trimmedText.substring(0, 50) }
        }).catch(err => {
            console.error('Error creating activity:', err)
        })
        
        // 2. Check for @mentions in the comment text (e.g., @username)
        const mentionRegex = /@(\w+)/g
        const mentions = trimmedText.match(mentionRegex)
        if (mentions) {
            const mentionedUsernames = [...new Set(mentions.map(m => m.substring(1)))] // Remove @ and get unique usernames
            
            for (const username of mentionedUsernames) {
                try {
                    const mentionedUser = await User.findOne({ username })
                    if (mentionedUser && mentionedUser._id.toString() !== userId.toString() && mentionedUser._id.toString() !== post.postedBy.toString()) {
                        // Don't notify if they're the commenter or post owner (already notified above)
                        createNotification(mentionedUser._id, 'mention', userId, {
                            postId: post._id,
                            commentText: trimmedText
                        }).catch(err => {
                            console.error('Error creating mention notification:', err)
                        })
                    }
                } catch (err) {
                    console.error('Error finding mentioned user:', err)
                }
            }
        }
        
        res.status(200).json(savedReply)

    }
    catch(error){
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}







export const getFeedPost = async(req,res) => {
    try{
        const userId = req.user._id 
        const viewerIdStr = String(userId)
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50)
        const skip = parseInt(req.query.skip, 10) || 0
        const cursorRaw = req.query.cursor != null ? String(req.query.cursor).trim() : ''
        const decodedCursor = decodeFeedCursor(cursorRaw)
        const isFirstPage = !cursorRaw && skip === 0
        const pageKey = cursorRaw || (skip === 0 ? '0' : String(skip))

        const cached = await getCachedFeed(userId, pageKey, limit)
        if (cached) return res.status(200).json(cached)

        const hiddenObjectIds = await getHiddenFeedPostObjectIds(userId)

        const normalIds = await getFeedNormalIndex(userId, hiddenObjectIds)
        await storeFeedNormalIndex(userId, normalIds)
        const totalCount = normalIds.length

        const resolveOffset = () => {
            if (decodedCursor) {
                let offset = decodedCursor.offset
                if (decodedCursor.postId) {
                    const idx = normalIds.indexOf(String(decodedCursor.postId))
                    if (idx >= 0) offset = idx + 1
                }
                return Math.min(Math.max(offset, 0), totalCount)
            }
            if (skip > 0) return Math.min(skip, totalCount)
            return 0
        }

        const buildNextCursor = (nextOffset, lastPost) => {
            if (nextOffset >= totalCount || !lastPost) return null
            return encodeFeedCursor({
                offset: nextOffset,
                postId: lastPost._id,
                updatedAtMs: feedSortTime(lastPost),
            })
        }

        if (isFirstPage) {
            const followingDocs = await Follow.find({ followerId: userId })
                .select('followeeId')
                .limit(5000)
                .lean()
            const following = followingDocs.map((d) => d.followeeId)

            const [channelPosts, firstNormalIds] = await Promise.all([
                fetchChannelPostsForUser(userId),
                Promise.resolve(normalIds.slice(0, FEED_FIRST_PAGE_NORMAL_COUNT)),
            ])
            const topNormalPosts = await populateFeedPostsByIds(firstNormalIds)

            const liveFollowIds = [...following.map(String), String(userId)]
            const activeStreams = await LiveStream.find({
                streamer: { $in: liveFollowIds },
                active: true,
            })
            .populate('streamer', 'name username profilePic')
            .sort({ startedAt: -1 })
            .lean()

            const livePseudoPosts = activeStreams.map((s) => ({
                _id: `live_${s._id}`,
                isLive: true,
                liveStreamId: String(s._id),
                roomName: s.roomName,
                postedBy: s.streamer,
                createdAt: s.startedAt,
                updatedAt: s.startedAt,
            }))

            const channelWithCounts = await attachReplyCountsToPosts([...channelPosts])
            const normalsSorted = [...topNormalPosts].sort((a, b) => feedSortTime(b) - feedSortTime(a))
            // Channels live only on page 1, but are sorted by time among the first posts (not pinned to the very top).
            const mixedNonLive = [...channelWithCounts, ...normalsSorted].sort(
                (a, b) => feedSortTime(b) - feedSortTime(a),
            )
            const [likedSet, previewMap] = await Promise.all([
                buildLikedPostIdSet(viewerIdStr, mixedNonLive),
                buildLikePreviewMap(mixedNonLive),
            ])
            const combinedPosts = [...livePseudoPosts, ...mixedNonLive].map((p) =>
                shapeFeedPostForViewer(p, viewerIdStr, likedSet, previewMap),
            )

            const nextOffset = firstNormalIds.length
            const hasMore = nextOffset < totalCount
            const lastNormal = normalsSorted[normalsSorted.length - 1]
            
            const payload = { 
                posts: combinedPosts,
                hasMore,
                totalCount,
                liveStreams: livePseudoPosts,
                nextCursor: buildNextCursor(nextOffset, lastNormal),
                nextSkip: nextOffset,
            }
            await setCachedFeed(userId, pageKey, limit, payload)
            return res.status(200).json(payload)
        }
        
        const startIndex = resolveOffset()
        const pageIds = normalIds.slice(startIndex, startIndex + limit)
        const paginatedNormal = await populateFeedPostsByIds(pageIds)
        const nextOffset = startIndex + paginatedNormal.length
        const hasMore = nextOffset < totalCount
        const lastPost = paginatedNormal[paginatedNormal.length - 1]
        const [likedSet, previewMap] = await Promise.all([
            buildLikedPostIdSet(viewerIdStr, paginatedNormal),
            buildLikePreviewMap(paginatedNormal),
        ])
        const shapedPaginatedNormal = paginatedNormal.map((p) =>
            shapeFeedPostForViewer(p, viewerIdStr, likedSet, previewMap),
        )

        console.log(
            `📄 [getFeedPost] Cursor page: ${paginatedNormal.length} posts (offset: ${startIndex}, hasMore: ${hasMore})`,
        )
        
        const payload = { 
            posts: shapedPaginatedNormal,
            hasMore,
            totalCount,
            nextCursor: buildNextCursor(nextOffset, lastPost),
            nextSkip: nextOffset,
        }
        await setCachedFeed(userId, pageKey, limit, payload)
        return res.status(200).json(payload)
    }
    catch(error){
        console.error('Error in getFeedPost:', error)
        res.status(500).json({error: error.message || "Failed to fetch feed posts"})
    }
}








// Get posts by user ID (for fetching newly followed user's posts)
export const getUserPostsById = async(req,res)=>{
    try{
        const{userId}= req.params 

        if(!userId){
            return res.status(400).json({error:"userId is required"})
        }

        // Pagination parameters
        const limit = parseInt(req.query.limit) || 3 // Default to 3 posts (for feed)
        const skip = parseInt(req.query.skip) || 0
        
        const posts = await Post.find(profilePostsQuery(userId))
            .select('-likes')
            .populate("postedBy","-password")
            .populate("contributors", "username profilePic name")
            .sort({createdAt:-1})
            .limit(limit)
            .skip(skip)
            .lean()

        const viewerId = req.user?._id ? String(req.user._id) : null
        const shaped = await shapeProfilePostsForViewer(posts, viewerId)
            
        res.status(200).json({ 
            posts: shaped,
            hasMore: false, // Not needed for feed integration
            totalCount: shaped.length
        })
    }
    catch(error){
        res.status(500).json({error: error.message || "Failed to fetch user posts"})
    }
}

export const getUserPosts = async(req,res)=>{

    try{
 
        const{username}= req.params 

        const user = await User.findOne({username})

         if(!user){
            return res.status(400).json({error:"no user"})
         }

         // Pagination parameters
         const limit = parseInt(req.query.limit) || 10 // Default to 10 posts per page
         const skip = parseInt(req.query.skip) || 0 // Skip for pagination
         
         const profileFilter = profilePostsQuery(user._id)

         const postsRaw = await Post.find(profileFilter)
            .select('-likes')
            .populate("postedBy","-password")
            .populate("contributors", "username profilePic name")
            .sort({createdAt:-1})
            .limit(limit)
            .skip(skip)
            .lean()

         const withCounts = await attachReplyCountsToPosts(postsRaw)
         const viewerId = req.user?._id ? String(req.user._id) : null
         const posts = await shapeProfilePostsForViewer(withCounts, viewerId)
            
         // Check if there are more posts
         const totalCount = await Post.countDocuments(profileFilter)
         const hasMore = (skip + limit) < totalCount

         res.status(200).json({ 
             posts,
             hasMore,
             totalCount
         })

    }catch(error){
        console.log(error)
        res.status(500).json({ error: error.message || 'Failed to fetch user posts' })
    }
}













export const ReplyToComment = async(req, res) => {
    try {
        const { text, parentReplyId } = req.body  // parentReplyId is the _id of the comment being replied to
        const trimmedText = String(text || '').trim()
        if (!trimmedText) {
            return res.status(400).json({ error: 'Comment text is required', message: 'Comment text is required' })
        }
        const { id } = req.params  // This is the post ID
        const username = req.user.username
        const userId = req.user._id
        const userProfilePic = req.user.profilePic

        const post = await Post.findById(id)
        
        if(!post) {
            return res.status(400).json({message: "no post"})
        }

        let mentionedUser = null
        let inheritedFootballMatchId = null
        if (parentReplyId) {
            const threadReply = await findCommentById(parentReplyId, id)
            if (threadReply) {
                mentionedUser = {
                    userId: threadReply.userId,
                    username: threadReply.username,
                }
                const root = await findCommentThreadRoot(parentReplyId, id)
                if (root?.footballMatchId) {
                    inheritedFootballMatchId = String(root.footballMatchId).slice(0, 128)
                }
            }
        }

        let newReply
        try {
            newReply = await createComment({
                postId: id,
            userId,
                username,
            userProfilePic,
                text: trimmedText,
                parentReplyId: parentReplyId || null,
                mentionedUser,
                footballMatchId: inheritedFootballMatchId,
            })
        } catch (err) {
            if (err.status === 400) {
                return res.status(400).json({ error: err.message })
            }
            throw err
        }
        
        // Create notifications
        const { createNotification } = await import('./notification.js')
        const User = (await import('../models/user.js')).default
        
        // Track who we've already notified to avoid duplicates
        const notifiedUsers = new Set()
        notifiedUsers.add(userId.toString()) // Don't notify the commenter
        
        // 1. Notify post owner if commenter is not the post owner
        if (post.postedBy.toString() !== userId.toString()) {
            notifiedUsers.add(post.postedBy.toString())
            createNotification(post.postedBy, 'comment', userId, {
                postId: post._id,
                commentText: trimmedText
            }).catch(err => {
                console.error('Error creating comment notification:', err)
            })
        }
        
        // 2. Notify mentioned user (if replying to a comment, the parent comment author is mentioned)
        if (mentionedUser && mentionedUser.userId && mentionedUser.userId.toString() !== userId.toString()) {
            if (!notifiedUsers.has(mentionedUser.userId.toString())) {
                notifiedUsers.add(mentionedUser.userId.toString())
                createNotification(mentionedUser.userId, 'mention', userId, {
                    postId: post._id,
                    commentText: trimmedText
                }).catch(err => {
                    console.error('Error creating mention notification:', err)
                })
            }
        }
        
        // 3. Check for @mentions in the comment text (e.g., @username)
        const mentionRegex = /@(\w+)/g
        const mentions = trimmedText.match(mentionRegex)
        if (mentions) {
            const mentionedUsernames = [...new Set(mentions.map(m => m.substring(1)))] // Remove @ and get unique usernames
            
            for (const username of mentionedUsernames) {
                try {
                    const mentionedUser = await User.findOne({ username })
                    if (mentionedUser && !notifiedUsers.has(mentionedUser._id.toString())) {
                        notifiedUsers.add(mentionedUser._id.toString())
                        createNotification(mentionedUser._id, 'mention', userId, {
                            postId: post._id,
                            commentText: trimmedText
                        }).catch(err => {
                            console.error('Error creating mention notification:', err)
                        })
                    }
                } catch (err) {
                    console.error('Error finding mentioned user:', err)
                }
            }
        }
        
        res.status(200).json(newReply)
    }
    catch(error) {
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}








// Create chess game post when two players start a game
export const createChessGamePost = async (player1Id, player2Id, roomId) => {
    try {
        // Get both players' info
        const player1 = await User.findById(player1Id).select('username name profilePic')
        const player2 = await User.findById(player2Id).select('username name profilePic')
        
        if (!player1 || !player2) {
            console.error('❌ [createChessGamePost] Player not found:', { player1Id, player2Id })
            return null
        }
        
        // Stable player order (sorted ids) so feed avatars never swap between the two posts
        const chessGameData = normalizeGamePlayers({
            player1: {
                _id: player1._id.toString(),
                username: player1.username,
                name: player1.name,
                profilePic: player1.profilePic
            },
            player2: {
                _id: player2._id.toString(),
                username: player2.username,
                name: player2.name,
                profilePic: player2.profilePic
            },
            roomId: roomId,
            gameStatus: 'active', // active, ended, canceled
            createdAt: new Date()
        })
        
        // Create posts for both players (so followers of either see it)
        const posts = []
        
        // Post from player1's perspective
        const post1 = new Post({
            postedBy: player1Id,
            text: `Playing chess with ${player2.name} ♟️`,
            chessGameData: JSON.stringify(chessGameData),
            gameRoomId: roomId,
        })
        await post1.save()
        await post1.populate("postedBy", "username profilePic name")
        posts.push(post1)
        
        // Post from player2's perspective (if different from player1)
        if (player1Id.toString() !== player2Id.toString()) {
            const post2 = new Post({
                postedBy: player2Id,
                text: `Playing chess with ${player1.name} ♟️`,
                chessGameData: JSON.stringify(chessGameData),
                gameRoomId: roomId,
            })
            await post2.save()
            await post2.populate("postedBy", "username profilePic name")
            posts.push(post2)
        }
        
        console.log('✅ [createChessGamePost] Created chess game posts:', posts.map(p => p._id))
        
        // Emit newPost event to online followers of each post's author (not both players)
        // Each post should only go to followers of that specific post's author
        const io = getIO()
        console.log('🔍 [createChessGamePost] Checking IO instance:', !!io)
        
        const p1Str = player1Id?.toString?.() ?? String(player1Id)
        const p2Str = player2Id?.toString?.() ?? String(player2Id)

        if (io) {
            for (const post of posts) {
                let postAuthorId
                if (post.postedBy && typeof post.postedBy === 'object') {
                    postAuthorId = post.postedBy._id ? post.postedBy._id.toString() : post.postedBy.toString()
                } else {
                    postAuthorId = post.postedBy.toString()
                }
                if (!postAuthorId) continue

                const followerDocs = await Follow.find({ followeeId: postAuthorId })
                  .select('followerId')
                  .limit(10000)
                  .lean()
                const recipientIds = [
                  ...followerDocs.map((d) => d.followerId).filter(Boolean),
                  p1Str,
                  p2Str,
                ]
                const postObject = post.toObject ? post.toObject() : post
                const emitted = await emitToUserIds(io, recipientIds, 'newPost', postObject)
                if (emitted === 0 && roomId?.startsWith?.('chess_')) {
                    io.to(roomId).emit('newPost', postObject)
                }
            }
        } else {
            console.error('❌ [createChessGamePost] IO instance is not available!')
        }
        
        return posts // Return posts so we can track them
    } catch (error) {
        console.error('Error creating chess game post:', error)
        throw error
    }
}

// Create card game post when two players start a game
export const createCardGamePost = async (player1Id, player2Id, roomId) => {
    try {
        // Get both players' info
        const player1 = await User.findById(player1Id).select('username name profilePic')
        const player2 = await User.findById(player2Id).select('username name profilePic')
        
        if (!player1 || !player2) {
            console.error('❌ [createCardGamePost] Player not found:', { player1Id, player2Id })
            return null
        }
        
        // Create card game data (player order by id so feed avatars never swap between the two posts)
        const cardGameData = normalizeGamePlayers({
            player1: {
                _id: player1._id.toString(),
                username: player1.username,
                name: player1.name,
                profilePic: player1.profilePic
            },
            player2: {
                _id: player2._id.toString(),
                username: player2.username,
                name: player2.name,
                profilePic: player2.profilePic
            },
            roomId: roomId,
            gameStatus: 'active',
            gameType: 'goFish',
            createdAt: new Date()
        })
        
        // Create posts for both players
        const posts = []
        
        // Post from player1's perspective
        const post1 = new Post({
            postedBy: player1Id,
            text: `Playing Go Fish with ${player2.name} 🃏`,
            cardGameData: JSON.stringify(cardGameData),
            gameRoomId: roomId,
        })
        await post1.save()
        await post1.populate("postedBy", "username profilePic name")
        posts.push(post1)
        
        // Post from player2's perspective
        if (player1Id.toString() !== player2Id.toString()) {
            const post2 = new Post({
                postedBy: player2Id,
                text: `Playing Go Fish with ${player1.name} 🃏`,
                cardGameData: JSON.stringify(cardGameData),
                gameRoomId: roomId,
            })
            await post2.save()
            await post2.populate("postedBy", "username profilePic name")
            posts.push(post2)
        }
        
        console.log('✅ [createCardGamePost] Created card game posts:', posts.map(p => p._id))

        const cardP1 = player1Id?.toString?.() ?? String(player1Id)
        const cardP2 = player2Id?.toString?.() ?? String(player2Id)

        // Emit newPost to online followers + both players (per-user socket lookup, same as chess)
        const io = getIO()
        if (io) {
            for (const post of posts) {
                const postAuthorId = post.postedBy?._id?.toString() || post.postedBy?.toString()
                if (!postAuthorId) continue

                const followerDocs = await Follow.find({ followeeId: postAuthorId })
                    .select('followerId')
                    .limit(10000)
                    .lean()
                const recipientIds = [
                    ...followerDocs.map((d) => d.followerId).filter(Boolean),
                    cardP1,
                    cardP2,
                ]
                const postObject = post.toObject()
                postObject.cardGameData = post.cardGameData
                const wrapped = { postId: post._id, post: postObject }
                const emitted = await emitToUserIds(io, recipientIds, 'newPost', wrapped)
                if (emitted === 0 && roomId?.startsWith?.('card_')) {
                    io.to(roomId).emit('newPost', wrapped)
                }
            }
        }
        
        return posts
    } catch (error) {
        console.error('Error creating card game post:', error)
        throw error
    }
}

// Function to delete card game posts by roomId
export const deleteCardGamePost = async (roomId) => {
    try {
        if (!roomId) {
            console.log('⚠️ No roomId provided for card game post deletion')
            return
        }

        // Extract player IDs from roomId (format: card_player1Id_player2Id_timestamp)
        let player1Id = null
        let player2Id = null
        if (roomId && roomId.startsWith('card_')) {
            const roomIdParts = roomId.split('_')
            if (roomIdParts.length >= 3) {
                player1Id = roomIdParts[1]
                player2Id = roomIdParts[2]
            }
        }

        const posts = await findPostsByGameRoomId(roomId)

        let deletedCount = 0
        for (const post of posts) {
            try {
                    const postAuthorId = post.postedBy?.toString?.() ?? String(post.postedBy)
                    const followerDocs = await Follow.find({ followeeId: postAuthorId })
                      .select('followerId')
                      .limit(10000)
                      .lean()
                    
                    let cardData = null
                    if (post.cardGameData) {
                        try {
                            cardData = JSON.parse(post.cardGameData)
                        } catch (e) {
                            console.error(`Error parsing cardGameData for post ${post._id}:`, e)
                        }
                    }
                    
                    const deletedPostId = post._id.toString()
                    await Post.findByIdAndDelete(post._id)
                    deletedCount++
                    console.log(`🗑️ Deleted card game post: ${deletedPostId} for roomId: ${roomId}`)

                    // Emit post deleted to post author, other player, and all followers
                    const io = getIO()
                    if (io) {
                        try {
                            io.emit('postDeleted', { postId: deletedPostId })
                        } catch (emitErr) {
                            console.warn('⚠️ [deleteCardGamePost] Global postDeleted emit failed:', emitErr?.message)
                        }
                        let otherPlayerId = null
                        if (cardData) {
                            otherPlayerId = cardData.player1?._id === postAuthorId
                                ? cardData.player2?._id
                                : cardData.player1?._id
                        } else if (player1Id && player2Id) {
                            otherPlayerId = postAuthorId === player1Id ? player2Id : player1Id
                        }
                        const recipientUserIds = [postAuthorId]
                        if (otherPlayerId) recipientUserIds.push(otherPlayerId)
                        if (followerDocs?.length) {
                            followerDocs.forEach((d) => {
                                const fid = d.followerId?.toString?.() ?? String(d.followerId)
                                if (fid) recipientUserIds.push(fid)
                            })
                        }
                        const socketIds = await collectSocketIdsForUserIds(recipientUserIds)
                        if (socketIds.size > 0) {
                            for (const socketId of socketIds) {
                                io.to(socketId).emit('postDeleted', { postId: deletedPostId })
                            }
                            console.log(`📤 [deleteCardGamePost] Emitted postDeleted to ${socketIds.size} recipient socket(s)`)
                        } else {
                            console.log(`⚠️ [deleteCardGamePost] No recipients found for post ${deletedPostId}`)
                        }
                    } else {
                        console.log(`⚠️ [deleteCardGamePost] IO instance not available`)
                    }
            } catch (parseError) {
                console.error(`Error parsing cardGameData for post ${post._id}:`, parseError)
            }
        }

        if (deletedCount > 0) {
            console.log(`✅ Deleted ${deletedCount} card game post(s) for roomId: ${roomId}`)
        } else {
            console.log(`⚠️ No card game posts found for roomId: ${roomId}`)
        }
    } catch (error) {
        console.error('Error deleting card game post:', error)
        throw error
    }
}

// Function to delete chess game posts by roomId
export const deleteChessGamePost = async (roomId) => {
    try {
        if (!roomId) {
            console.log('⚠️ No roomId provided for chess post deletion')
            return
        }

        const posts = await findPostsByGameRoomId(roomId)

        let deletedCount = 0
        for (const post of posts) {
            try {
                const chessData = post.chessGameData ? JSON.parse(post.chessGameData) : null
                const postAuthorId = post.postedBy?.toString?.() ?? String(post.postedBy)
                const followerDocs = await Follow.find({ followeeId: postAuthorId })
                  .select('followerId')
                  .limit(10000)
                  .lean()
                
                const deletedPostId = post._id.toString()
                await Post.findByIdAndDelete(post._id)
                deletedCount++
                console.log(`🗑️ Deleted chess game post: ${post._id} for roomId: ${roomId}`)

                        // Emit post deleted to post author, other player, and all followers
                        const io = getIO()
                        if (io) {
                            // Broadcast so every connected client drops the post (fixes stale "Live" on Feed)
                            try {
                                io.emit('postDeleted', { postId: deletedPostId })
                            } catch (emitErr) {
                                console.warn('⚠️ [deleteChessGamePost] Global postDeleted emit failed:', emitErr?.message)
                            }
                            const otherPlayerId = chessData.player1?._id === postAuthorId
                                ? chessData.player2?._id
                                : chessData.player1?._id
                            const recipientUserIds = [postAuthorId]
                            if (otherPlayerId) recipientUserIds.push(otherPlayerId)
                            if (followerDocs?.length) {
                                followerDocs.forEach((d) => {
                                    const fid = d.followerId?.toString?.() ?? String(d.followerId)
                                    if (fid) recipientUserIds.push(fid)
                                })
                            }
                            const socketIds = await collectSocketIdsForUserIds(recipientUserIds)
                            if (socketIds.size > 0) {
                                for (const socketId of socketIds) {
                                    io.to(socketId).emit('postDeleted', { postId: deletedPostId })
                                }
                                console.log(`📤 Emitted postDeleted to ${socketIds.size} recipient socket(s) for post: ${deletedPostId}`)
                            }
                        }
            } catch (parseError) {
                console.error(`Error parsing chessGameData for post ${post._id}:`, parseError)
            }
        }

        if (deletedCount > 0) {
            console.log(`✅ Deleted ${deletedCount} chess game post(s) for roomId: ${roomId}`)
        } else {
            console.log(`⚠️ No chess game posts found for roomId: ${roomId}`)
        }
    } catch (error) {
        console.error('Error deleting chess game post:', error)
        throw error
    }
}

// Add contributor to collaborative post
export const addContributorToPost = async (req, res) => {
    try {
        const { postId } = req.params
        const { contributorId } = req.body
        const userId = req.user._id

        const post = await Post.findById(postId)
        
        if (!post) {
            return res.status(400).json({ message: "Post not found" })
        }

        // Get post owner ID BEFORE any operations
        const postOwnerId = post.postedBy.toString()

        // Check if post is collaborative
        if (!post.isCollaborative) {
            return res.status(400).json({ message: "This post is not collaborative" })
        }

        // Check if user is already a contributor or is the original poster
        const isContributor = post.contributors.some(c => c.toString() === userId.toString())
        const isPoster = post.postedBy.toString() === userId.toString()

        if (!isContributor && !isPoster) {
            return res.status(403).json({ message: "You must be a contributor to add others" })
        }

        // Check if contributor exists
        const contributor = await User.findById(contributorId)
        if (!contributor) {
            return res.status(400).json({ message: "Contributor not found" })
        }

        // Check if already a contributor
        if (post.contributors.some(c => c.toString() === contributorId)) {
            return res.status(400).json({ message: "User is already a contributor" })
        }

        if (post.contributors.length >= MAX_COLLABORATORS) {
            return res.status(400).json({
                message: `Maximum ${MAX_COLLABORATORS} contributors allowed`,
            })
        }

        // Add contributor (bump updatedAt so feeds / sorting show fresh activity for followers)
        post.contributors.push(contributorId)
        post.updatedAt = new Date()
        await post.save()

        await post.populate("contributors", "username profilePic name")
        await post.populate("postedBy", "username profilePic name")
        
        // Log populated data to verify it's correct
        console.log('✅ [addContributorToPost] Post populated. Contributors:', post.contributors?.length)
        console.log('✅ [addContributorToPost] Contributors data:', JSON.stringify(post.contributors.map(c => ({
            id: c._id?.toString()?.substring(0, 8),
            name: c.name,
            username: c.username,
            hasProfilePic: !!c.profilePic
        })), null, 2))

        // Notify the new contributor (with real-time socket notification)
        try {
            const { createNotification } = await import('./notification.js')
            await createNotification(contributorId, 'collaboration', userId, {
                postId: post._id.toString(), // Ensure it's a string
                postText: post.text?.substring(0, 50) || 'a collaborative post'
            })
            console.log(`📬 [addContributorToPost] Created collaboration notification for user ${contributorId}`)
        } catch (err) {
            console.error('❌ [addContributorToPost] Error creating collaboration notification:', err)
        }

        const io = getIO()
        if (io) {
            const postOwnerId = post.postedBy._id?.toString() || post.postedBy.toString()
            const sent = await emitPostUpdatedToRecipients(io, post, postOwnerId)
            if (sent > 0) {
                console.log(`📤 [addContributorToPost] Emitted postUpdated to ${sent} recipient socket(s)`)
            }
        }

        res.status(200).json({
            message: "Contributor added successfully",
            post: post
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}

// Remove contributor from collaborative post
export const removeContributorFromPost = async(req, res) => {
    try {
        const { postId, contributorId } = req.params
        const userId = req.user._id

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ message: "Post not found" })
        }

        // Check if post is collaborative
        if (!post.isCollaborative) {
            return res.status(400).json({ message: "This post is not collaborative" })
        }

        // Permissions:
        // - Post owner can remove any contributor (except themselves)
        // - A contributor can remove themselves (leave the collaborative post)
        const isOwner = post.postedBy.toString() === userId.toString()
        if (!isOwner && contributorId !== userId.toString()) {
            return res.status(403).json({ message: "You can only remove yourself from this post" })
        }

        // Cannot remove the post owner
        if (contributorId === post.postedBy.toString()) {
            return res.status(400).json({ message: "Cannot remove the post owner" })
        }

        // Check if contributor exists in the list
        const contributorIndex = post.contributors.findIndex(
            c => c.toString() === contributorId
        )
        
        if (contributorIndex === -1) {
            return res.status(400).json({ message: "Contributor not found in this post" })
        }

        // Remove contributor
        post.contributors.splice(contributorIndex, 1)
        await removeCollaboratorImageForUser(post, contributorId)
        // Bump updatedAt so followers see recency (and web "Edited" label reflects membership change)
        post.updatedAt = new Date()
        await post.save()

        const isSelfLeave = contributorId === userId.toString()
        if (isSelfLeave) {
            await addHiddenFeedPostForUser(userId, postId)
            await invalidateUserFeedCache(userId)
        }

        await post.populate("contributors", "username profilePic name")
        await post.populate("postedBy", "username profilePic name")

        // Emit real-time post update to post owner, all contributors, and followers
        const io = getIO()
        if (io) {
            const postOwnerId = post.postedBy._id?.toString() || post.postedBy.toString()
            const sent = await emitPostUpdatedToRecipients(io, post, postOwnerId)
            if (sent > 0) {
                console.log(`📤 [removeContributorFromPost] Emitted postUpdated to ${sent} recipient socket(s)`)
            } else {
                console.log(`⚠️ [removeContributorFromPost] No online recipients for post ${post._id}`)
            }
        }

        res.status(200).json({
            message: "Contributor removed successfully",
            post: post,
            hiddenPostId: isSelfLeave ? String(postId) : null,
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}

/** Owner only: add or replace background MP3 on a collaborative / carousel post (R2 URL). */
export const setCollaborativePostAudio = async (req, res) => {
    try {
        const { postId } = req.params
        const userId = req.user._id
        const audioUrl = req.body.audio != null ? String(req.body.audio).trim() : ''

        if (!audioUrl) {
            return res.status(400).json({ error: 'Audio URL is required' })
        }
        try {
            assertManagedMediaUrls([audioUrl])
        } catch (e) {
            return res.status(400).json({ error: e.message, code: e.code })
        }

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ message: 'Post not found' })
        }
        if (!post.isCollaborative) {
            const hasCarouselImages = Array.isArray(post.images) && post.images.length > 0
            if (!hasCarouselImages) {
                return res.status(400).json({ message: 'This post is not collaborative' })
            }
        }

        const postOwnerId = post.postedBy.toString()
        if (postOwnerId !== userId.toString()) {
            return res.status(403).json({ message: 'Only the post owner can add music' })
        }

        if (post.audio && post.audio !== audioUrl) {
            await deleteMediaAsset(post.audio).catch(() => {})
        }
        post.audio = audioUrl
        post.editedAt = new Date()
        await post.save()

        await post.populate('postedBy', 'username profilePic name')
        await post.populate('contributors', 'username profilePic name')

        const io = getIO()
        if (io) {
            await emitPostUpdatedToRecipients(io, post, postOwnerId)
        }

        res.status(200).json({ message: 'Music updated', post })
    } catch (error) {
        console.error('[setCollaborativePostAudio]', error)
        res.status(500).json({ error: error.message || 'Failed to update audio' })
    }
}

/** Owner only: remove background MP3 from a collaborative post. */
export const removeCollaborativePostAudio = async (req, res) => {
    try {
        const { postId } = req.params
        const userId = req.user._id

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ message: 'Post not found' })
        }
        if (!post.isCollaborative) {
            const hasCarouselImages = Array.isArray(post.images) && post.images.length > 0
            if (!hasCarouselImages) {
                return res.status(400).json({ message: 'This post is not collaborative' })
            }
        }

        const postOwnerId = post.postedBy.toString()
        if (postOwnerId !== userId.toString()) {
            return res.status(403).json({ message: 'Only the post owner can remove music' })
        }

        if (post.audio) {
            await deleteMediaAsset(post.audio).catch(() => {})
            post.audio = null
            post.editedAt = new Date()
            await post.save()
        }

        await post.populate('postedBy', 'username profilePic name')
        await post.populate('contributors', 'username profilePic name')

        const io = getIO()
        if (io) {
            await emitPostUpdatedToRecipients(io, post, postOwnerId)
        }

        res.status(200).json({ message: 'Music removed', post })
    } catch (error) {
        console.error('[removeCollaborativePostAudio]', error)
        res.status(500).json({ error: error.message })
    }
}

export const setContributorImage = async (req, res) => {
    try {
        const { postId } = req.params
        const userId = req.user._id
        const imgUrl = req.body.img != null ? String(req.body.img).trim() : ''

        if (!imgUrl) {
            return res.status(400).json({ error: 'Image URL is required' })
        }
        try {
            assertManagedMediaUrls([imgUrl])
        } catch (e) {
            return res.status(400).json({ error: e.message, code: e.code })
        }

        if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(imgUrl) || imgUrl.includes('/video/')) {
            return res.status(400).json({
                error: 'Collaborative posts only support one photo per contributor',
            })
        }

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ message: 'Post not found' })
        }
        if (!post.isCollaborative) {
            const hasCarouselImages = Array.isArray(post.images) && post.images.length > 0
            if (!hasCarouselImages) {
                return res.status(400).json({ message: 'This post is not collaborative' })
            }
        }

        const postOwnerId = post.postedBy.toString()
        const isOwner = postOwnerId === userId.toString()
        const isContributor =
            Array.isArray(post.contributors) &&
            post.contributors.some((c) => c.toString() === userId.toString())

        if (!isOwner && !isContributor) {
            return res.status(403).json({
                message: 'You must be the owner or a contributor to add a photo',
            })
        }

        await upsertCollaboratorImage(post, userId, imgUrl)
        post.editedAt = new Date()
        await post.save()

        await post.populate('postedBy', 'username profilePic name')
        await post.populate('contributors', 'username profilePic name')

        const io = getIO()
        if (io) {
            const sent = await emitPostUpdatedToRecipients(io, post, postOwnerId)
            if (sent > 0) {
                console.log(`📤 [setContributorImage] Emitted postUpdated to ${sent} recipient socket(s)`)
            }
        }

        res.status(200).json({
            message: 'Contributor photo updated',
            post,
        })
    } catch (error) {
        console.error('[setContributorImage]', error)
        res.status(500).json({ error: error.message })
    }
}

export const removeContributorImage = async (req, res) => {
    try {
        const { postId } = req.params
        const userId = req.user._id

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ message: 'Post not found' })
        }
        if (!post.isCollaborative) {
            const hasCarouselImages = Array.isArray(post.images) && post.images.length > 0
            if (!hasCarouselImages) {
                return res.status(400).json({ message: 'This post is not collaborative' })
            }
        }

        const postOwnerId = post.postedBy.toString()
        const isOwner = postOwnerId === userId.toString()
        const isContributor =
            Array.isArray(post.contributors) &&
            post.contributors.some((c) => c.toString() === userId.toString())

        if (!isOwner && !isContributor) {
            return res.status(403).json({
                message: 'You must be the owner or a contributor to remove your photo',
            })
        }

        const uid = userId.toString()
        const inCollabList = (post.collaboratorImages || []).some((e) => String(e.userId) === uid)
        const ownerHasLegacyImg = isOwner && !!post.img
        if (!inCollabList && !ownerHasLegacyImg) {
            return res.status(400).json({ message: 'No photo to remove' })
        }

        await removeCollaboratorImageForUser(post, userId)
        post.editedAt = new Date()
        await post.save()

        await post.populate('postedBy', 'username profilePic name')
        await post.populate('contributors', 'username profilePic name')

        const io = getIO()
        if (io) {
            const sent = await emitPostUpdatedToRecipients(io, post, postOwnerId)
            if (sent > 0) {
                console.log(`📤 [removeContributorImage] Emitted postUpdated to ${sent} recipient socket(s)`)
            }
        }

        res.status(200).json({
            message: 'Contributor photo removed',
            post,
        })
    } catch (error) {
        console.error('[removeContributorImage]', error)
        res.status(500).json({ error: error.message })
    }
}

/** Viewer-only: hide a post from this user's feed without affecting the post for others. */
export const hidePostFromFeed = async (req, res) => {
    try {
        const { postId } = req.params
        const userId = req.user._id

        const post = await Post.findById(postId).select('_id')
        if (!post) {
            return res.status(404).json({ message: 'Post not found' })
        }

        await addHiddenFeedPostForUser(userId, postId)
        await invalidateUserFeedCache(userId)

        res.status(200).json({
            message: 'Post hidden from feed',
            postId: String(postId),
        })
    } catch (error) {
        console.error('Error in hidePostFromFeed:', error)
        res.status(500).json({ error: error.message || 'Failed to hide post from feed' })
    }
}

/** Login sync only: ids this viewer hid from feed (capped). Not sent on every feed page. */
export const getHiddenFeedPostIds = async (req, res) => {
    try {
        const postIds = await getHiddenFeedPostIdStrings(req.user._id)
        res.status(200).json({ postIds })
    } catch (error) {
        console.error('Error in getHiddenFeedPostIds:', error)
        res.status(500).json({ error: error.message || 'Failed to load hidden feed posts' })
    }
}

// Get all comments/replies made by a specific user
export const getUserComments = async(req,res) => {
    try {
        const { username } = req.params
        const { limit = 20, skip = 0 } = req.query
        
        const user = await User.findOne({ username })
        if (!user) {
            return res.status(404).json({ error: "User not found" })
        }
        
        const result = await getUserCommentsPaginated(user._id, { limit, skip })
        res.status(200).json(result)
    } catch (error) {
        console.error('Error fetching user comments:', error)
        res.status(500).json({ error: error.message })
    }
}

export const deleteComment = async(req,res) => {
    try{
        const { postId, replyId } = req.params 
        const userId = req.user._id 

        const post = await Post.findById(postId)
        
        if(!post){
            return res.status(404).json({error:"Post not found"})
        }

        const reply = await findCommentById(replyId, postId)
        
        if(!reply){
            return res.status(404).json({error:"Comment not found"})
        }

        const isPostOwner = post.postedBy.toString() === userId.toString()
        const isCommentOwner = reply.userId && reply.userId.toString() === userId.toString()

        if(!isPostOwner && !isCommentOwner){
            return res.status(403).json({error:"You can only delete your own comments or comments on your posts"})
        }

        await deleteCommentTree(postId, replyId)

        res.status(200).json({
            message: "Comment deleted successfully",
            deletedReplyId: replyId
        })

    }
    catch(error){
        console.error('Error deleting comment:', error)
        res.status(500).json({error: error.message || "Failed to delete comment"})
    }
}

export const LikeComent = async(req,res) => {

    try{
      
        const { postId, replyId } = req.params 
        const userId = req.user._id 

       
        const post = await Post.findById(postId)
        
        if(!post){
            return res.status(400).json({message:"no post found"})
        }

        const toggled = await toggleCommentLike(postId, replyId, userId)
        if (!toggled) {
            return res.status(400).json({message:"no comment found"})
        }

        const { doc: reply, isLiked, likesCount } = toggled

        if (isLiked) {
            if (reply.userId && reply.userId.toString() !== userId.toString()) {
                const { createNotification } = await import('./notification.js')
                const isReply = reply.parentReplyId !== null && reply.parentReplyId !== undefined
                createNotification(reply.userId, 'like', userId, {
                    postId: post._id,
                    commentText: reply.text,
                    isReply: isReply
                }).catch(err => {
                    console.error('Error creating comment/reply like notification:', err)
                })
            }
        }

        res.status(200).json({
            message: isLiked ? "comment liked successfully" : "comment unliked successfully",
            likesCount,
            isLiked
        })

    }
    catch(error){
        console.log(error)
        res.status(500).json({ error: error.message })
    }
}









