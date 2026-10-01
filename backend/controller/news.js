// Live TV channels (Al Jazeera, Fox11, etc.) — mounted at /api/news for mobile compatibility.
import jwt from 'jsonwebtoken'
import VideoLink from '../models/videoLink.js'
import { parseVideoLink, decorateChannel } from '../services/videoLinks.js'

const MAX_VIDEO_LINKS = 30
const VIDEO_SHELF_USERNAME = 'VideoShelf'

async function viewerIdFromCookie(req) {
  try {
    const token = req.cookies?.jwt
    if (!token) return null
    const decode = jwt.verify(token, process.env.JWT_SECRET)
    return decode?.userId || null
  } catch {
    return null
  }
}

async function videoShelfAccount() {
  const User = (await import('../models/user.js')).default
  let account = await User.findOne({ username: VIDEO_SHELF_USERNAME })
  if (!account) {
    account = new User({
      name: 'Video',
      username: VIDEO_SHELF_USERNAME,
      email: 'videoshelf@system.com',
      password: 'system_account',
      bio: 'Saved videos',
    })
    await account.save()
  }
  return account
}

async function emitNormalPost(authorId, post) {
  const Follow = (await import('../models/follow.js')).default
  const { getIO } = await import('../socket/socket.js')
  const { emitToUserIds } = await import('../services/postSocketEmit.js')
  const { invalidateUserFeedCaches } = await import('../services/feedCache.js')
  const io = getIO()
  if (!io) return
  const followerDocs = await Follow.find({ followeeId: authorId }).select('followerId').limit(10000).lean()
  const followerIds = followerDocs.map((d) => d.followerId).filter(Boolean)
  const postObj = post.toObject ? post.toObject() : post
  const recipientIds = [...new Set([...followerIds.map(String), String(authorId)])]
  await emitToUserIds(io, recipientIds, 'newPost', postObj)
  invalidateUserFeedCaches(recipientIds).catch(() => {})
}

export const createLiveStreamPost = async (req, res) => {
  try {
    let { channelId, streamIndex = 0, lang } = req.query

    // Backward compatibility: if lang is provided, assume it's Al Jazeera
    if (lang && !channelId) {
      channelId = 'aljazeera'
      streamIndex = lang === 'arabic' ? 1 : 0
    }

    console.log(`📺 [createLiveStreamPost] Creating live stream post for channel: ${channelId}`)

    const User = (await import('../models/user.js')).default
    const Post = (await import('../models/post.js')).default
    const { getIO } = await import('../socket/socket.js')
    const { getChannelById } = await import('../config/channels.js')
    const { invalidateUserFeedCache } = await import('../services/feedCache.js')
    const { emitToUserIds } = await import('../services/postSocketEmit.js')

    const channelConfig = getChannelById(channelId)

    if (!channelConfig) {
      return res.status(400).json({ error: `Channel ${channelId} not found` })
    }

    const streamConfig = channelConfig.streams[parseInt(streamIndex)] || channelConfig.streams[0]

    if (!streamConfig) {
      return res.status(400).json({ error: 'Stream not found' })
    }

    let channelAccount = await User.findOne({ username: channelConfig.username })

    if (!channelAccount) {
      console.log(`📺 Creating ${channelConfig.name} account...`)
      channelAccount = new User({
        name: channelConfig.name,
        username: channelConfig.username,
        email: `${channelConfig.username.toLowerCase()}@system.com`,
        password: 'system_account',
        profilePic: channelConfig.logo,
        bio: channelConfig.bio,
      })
      await channelAccount.save()
      console.log(`✅ ${channelConfig.name} account created`)
    }

    const streamUrl = `https://www.youtube.com/embed/${streamConfig.youtubeId}?autoplay=1&mute=0`
    const caption = String(req.body?.text || '').trim().slice(0, 500)
    const postText = caption || streamConfig.text

    console.log(`📺 Creating ${channelConfig.name} ${streamConfig.language} live stream post...`)

    const existingPost = await Post.findOne({
      postedBy: channelAccount._id,
      img: streamUrl,
      channelAddedBy: req.user._id.toString(),
    })

    if (existingPost) {
      console.log(`ℹ️ ${channelConfig.name} live stream post already exists for user`)
      if (caption) existingPost.text = caption

      // Do NOT bump updatedAt — that pinned the channel above newer user posts on refresh.
      // Client applies a short-lived viewer boost so the card is still easy to find.
      await invalidateUserFeedCache(req.user._id)

      if (caption) await existingPost.save({ timestamps: false })
      await existingPost.populate('postedBy', 'username profilePic name')
      const postObj = existingPost.toObject ? existingPost.toObject() : existingPost

      const io = getIO()
      if (io && req.user) {
        await emitToUserIds(io, [req.user._id], 'newPost', postObj)
        console.log('✅ Emitted existing channel post to userSelf')
      }

      return res.status(200).json({
        message: `${channelConfig.name} live stream post already in feed`,
        postId: existingPost._id,
        post: postObj,
        posted: false,
      })
    }

    const liveStreamPost = new Post({
      postedBy: channelAccount._id,
      text: postText,
      img: streamUrl,
      channelAddedBy: req.user._id.toString(),
    })

    await liveStreamPost.save()
    await liveStreamPost.populate('postedBy', 'username profilePic name')

    // New channel card must appear on the next page-1 load (avoid stale cached feed).
    await invalidateUserFeedCache(req.user._id)

    console.log(`✅ Created live stream post: ${liveStreamPost._id} for user: ${req.user._id}`)

    const postObj = liveStreamPost.toObject ? liveStreamPost.toObject() : liveStreamPost

    const io = getIO()
    if (io && req.user) {
      await emitToUserIds(io, [req.user._id], 'newPost', postObj)
      console.log('✅ Emitted new channel post to userSelf')
    }

    res.status(200).json({
      message: `${channelConfig.name} live stream post created successfully`,
      postId: liveStreamPost._id,
      post: postObj,
      posted: true,
      channel: channelConfig.name,
      language: streamConfig.language,
    })
  } catch (error) {
    console.error('📺 [createLiveStreamPost] Error:', error)
    res.status(500).json({ error: error.message })
  }
}

export const getChannels = async (req, res) => {
  try {
    const { LIVE_CHANNELS } = await import('../config/channels.js')
    const User = (await import('../models/user.js')).default
    const userId = await viewerIdFromCookie(req)
    let hidden = []
    let links = []
    if (userId) {
      const user = await User.findById(userId).select('hiddenChannelIds').lean()
      hidden = Array.isArray(user?.hiddenChannelIds) ? user.hiddenChannelIds : []
      links = await VideoLink.find({ userId }).sort({ createdAt: -1 }).limit(MAX_VIDEO_LINKS).lean()
    }
    const hiddenSet = new Set(hidden.map(String))
    const channels = LIVE_CHANNELS
      .filter((channel) => !hiddenSet.has(channel.id))
      .map(decorateChannel)
    res.status(200).json({ channels, links })
  } catch (error) {
    console.error('📺 [getChannels] Error:', error)
    res.status(500).json({ error: error.message })
  }
}

export const addVideoLink = async (req, res) => {
  try {
    const parsed = parseVideoLink(req.body?.url)
    if (!parsed) {
      return res.status(400).json({
        error: 'Paste a YouTube, Dailymotion, Vimeo, or video file link',
      })
    }
    const count = await VideoLink.countDocuments({ userId: req.user._id })
    if (count >= MAX_VIDEO_LINKS) {
      return res.status(400).json({ error: `You can save up to ${MAX_VIDEO_LINKS} links` })
    }
    const existing = await VideoLink.findOne({ userId: req.user._id, url: parsed.url })
    if (existing) return res.status(200).json({ link: existing, posted: false })
    const link = await VideoLink.create({ userId: req.user._id, ...parsed })
    res.status(200).json({ link })
  } catch (error) {
    if (error?.code === 11000) {
      const link = await VideoLink.findOne({ userId: req.user._id, url: String(req.body?.url || '').trim() })
      return res.status(200).json({ link, posted: false })
    }
    console.error('📺 [addVideoLink]', error)
    res.status(500).json({ error: error.message })
  }
}

async function deleteViewerVideoPosts(userId, embedUrls) {
  const Post = (await import('../models/post.js')).default
  const Like = (await import('../models/like.js')).default
  const Follow = (await import('../models/follow.js')).default
  const { deleteCommentsForPost } = await import('../services/commentService.js')
  const { getIO } = await import('../socket/socket.js')
  const { emitToUserIds } = await import('../services/postSocketEmit.js')
  const { invalidateUserFeedCaches } = await import('../services/feedCache.js')
  const needles = [...new Set((embedUrls || []).map((url) => embedFromText(url)).filter(Boolean))]
  if (!needles.length) return []
  const imgOr = needles.map((embed) => {
    const yt = embed.match(/youtube\.com\/embed\/([\w-]{6,})/i)
    if (yt) return { img: new RegExp(`youtube\\.com/embed/${yt[1]}`) }
    const dm = embed.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/i)
    if (dm) return { img: new RegExp(`dailymotion\\.com/embed/video/${dm[1]}`) }
    const vm = embed.match(/player\.vimeo\.com\/video\/(\\d+)/i)
    if (vm) return { img: new RegExp(`player\\.vimeo\\.com/video/${vm[1]}`) }
    return { img: embed }
  })
  const posts = await Post.find({
    $and: [
      { $or: imgOr },
      {
        $or: [
          { channelAddedBy: String(userId) },
          {
            postedBy: userId,
            $or: [
              { channelAddedBy: { $exists: false } },
              { channelAddedBy: null },
              { channelAddedBy: '' },
            ],
          },
        ],
      },
    ],
  }).select('_id')
  const ids = posts.map((post) => post._id)
  if (!ids.length) return []
  await Post.deleteMany({ _id: { $in: ids } })
  await Promise.all(ids.map((id) => deleteCommentsForPost(id).catch(() => {})))
  Like.deleteMany({ post: { $in: ids } }).catch(() => {})
  const followerDocs = await Follow.find({ followeeId: userId }).select('followerId').limit(10000).lean()
  const recipientIds = [...new Set([String(userId), ...followerDocs.map((doc) => String(doc.followerId)).filter(Boolean)])]
  const io = getIO()
  if (io) {
    for (const id of ids) {
      await emitToUserIds(io, recipientIds, 'postDeleted', { postId: String(id) })
    }
  }
  invalidateUserFeedCaches(recipientIds).catch(() => {})
  return ids.map(String)
}

export const deleteVideoLink = async (req, res) => {
  try {
    const link = await VideoLink.findOneAndDelete({ _id: req.params.id, userId: req.user._id })
    if (!link) return res.status(404).json({ error: 'Link not found' })
    const removedIds = await deleteViewerVideoPosts(req.user._id, [link.embedUrl, link.url])
    res.status(200).json({ ok: true, removedIds })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

export const hideDefaultChannel = async (req, res) => {
  try {
    const User = (await import('../models/user.js')).default
    const { LIVE_CHANNELS } = await import('../config/channels.js')
    const channelId = String(req.body?.channelId || '').trim()
    if (!LIVE_CHANNELS.some((c) => c.id === channelId)) {
      return res.status(400).json({ error: 'Channel not found' })
    }
    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { hiddenChannelIds: channelId } },
    )
    const { getChannelById } = await import('../config/channels.js')
    const channel = getChannelById(channelId)
    const embeds = (channel?.streams || [])
      .map((stream) => (stream?.youtubeId ? `https://www.youtube.com/embed/${stream.youtubeId}` : ''))
      .filter(Boolean)
    const removedIds = await deleteViewerVideoPosts(req.user._id, embeds)
    res.status(200).json({ ok: true, removedIds })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

async function watchEmbed({ userId, embedUrl, text, title }) {
  const Post = (await import('../models/post.js')).default
  const { getIO } = await import('../socket/socket.js')
  const { emitToUserIds } = await import('../services/postSocketEmit.js')
  const { invalidateUserFeedCache } = await import('../services/feedCache.js')
  const shelf = await videoShelfAccount()
  const existing = await Post.findOne({
    postedBy: shelf._id,
    img: embedUrl,
    channelAddedBy: String(userId),
  })
  if (existing) {
    if (text && existing.text !== text) {
      existing.text = text
      await existing.save({ timestamps: false })
    }
    await invalidateUserFeedCache(userId)
    await existing.populate('postedBy', 'username profilePic name')
    const postObj = existing.toObject()
    const io = getIO()
    if (io) await emitToUserIds(io, [userId], 'newPost', postObj)
    return { post: postObj, posted: false, postId: existing._id }
  }
  const post = new Post({
    postedBy: shelf._id,
    text: text || title || 'Video',
    img: embedUrl,
    channelAddedBy: String(userId),
  })
  await post.save()
  await post.populate('postedBy', 'username profilePic name')
  await invalidateUserFeedCache(userId)
  const postObj = post.toObject()
  const io = getIO()
  if (io) await emitToUserIds(io, [userId], 'newPost', postObj)
  return { post: postObj, posted: true, postId: post._id }
}

export const watchVideoLink = async (req, res) => {
  try {
    const link = await VideoLink.findOne({ _id: req.params.id, userId: req.user._id }).lean()
    if (!link?.embedUrl) return res.status(404).json({ error: 'Link not found' })
    const caption = String(req.body?.text || '').trim().slice(0, 500)
    const result = await watchEmbed({
      userId: req.user._id,
      embedUrl: link.embedUrl,
      text: caption || link.title,
      title: link.title,
    })
    res.status(200).json(result)
  } catch (error) {
    console.error('📺 [watchVideoLink]', error)
    res.status(500).json({ error: error.message })
  }
}

function embedFromText(raw) {
  const parsed = parseVideoLink(raw)
  if (parsed?.embedUrl) return parsed.embedUrl
  const text = String(raw || '')
  const yt = text.match(/(?:youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/live\/)([\w-]{6,})/i)
  if (yt?.[1]) return `https://www.youtube.com/embed/${yt[1]}`
  const dm = text.match(/dailymotion\.com\/(?:embed\/video|video)\/([a-zA-Z0-9]+)/i)
  if (dm?.[1]) return `https://www.dailymotion.com/embed/video/${dm[1]}`
  const vm = text.match(/(?:player\.vimeo\.com\/video\/|vimeo\.com\/)(\d+)/i)
  if (vm?.[1]) return `https://player.vimeo.com/video/${vm[1]}`
  return ''
}

async function shareEmbed({ userId, embedUrl, text }) {
  const Post = (await import('../models/post.js')).default
  const { createActivity } = await import('./activity.js')
  const post = new Post({
    postedBy: userId,
    text: String(text || 'Video').slice(0, 500),
    img: embedUrl,
  })
  await post.save()
  await post.populate('postedBy', 'username profilePic name')
  await emitNormalPost(userId, post)
  createActivity(userId, 'post', {
    postId: post._id,
    metadata: { text: String(text || '').slice(0, 50), hasImage: false },
  }).catch(() => {})
  return post.toObject()
}

export const shareVideo = async (req, res) => {
  try {
    const linkId = req.body?.linkId
    const channelId = req.body?.channelId
    const postId = req.body?.postId
    const caption = String(req.body?.text || '').trim().slice(0, 500)
    if (postId) {
      const Post = (await import('../models/post.js')).default
      const source = await Post.findById(postId).select('img images text channelAddedBy postedBy').lean()
      const candidates = [source?.img, ...(Array.isArray(source?.images) ? source.images : []), req.body?.embedUrl, source?.text]
      let embed = ''
      for (const candidate of candidates) {
        embed = embedFromText(candidate)
        if (embed) break
      }
      if (!embed) return res.status(400).json({ error: 'Nothing to share' })
      const alreadyMine = source && !source.channelAddedBy && String(source.postedBy || '') === String(req.user._id)
      if (alreadyMine) return res.status(200).json({ already: true, post: source })
      const post = await shareEmbed({
        userId: req.user._id,
        embedUrl: embed,
        text: caption || source?.text || 'Video',
      })
      return res.status(200).json({ post })
    }
    if (linkId) {
      const link = await VideoLink.findOne({ _id: linkId, userId: req.user._id }).lean()
      if (!link?.embedUrl) return res.status(404).json({ error: 'Link not found' })
      const post = await shareEmbed({
        userId: req.user._id,
        embedUrl: link.embedUrl,
        text: caption || link.title || 'Video',
      })
      return res.status(200).json({ post })
    }
    if (channelId) {
      const { getChannelById } = await import('../config/channels.js')
      const channel = getChannelById(String(channelId))
      if (!channel) return res.status(400).json({ error: 'Channel not found' })
      const streamIndex = parseInt(req.body?.streamIndex, 10) || 0
      const stream = channel.streams[streamIndex] || channel.streams[0]
      if (!stream?.youtubeId) return res.status(400).json({ error: 'Stream not found' })
      const post = await shareEmbed({
        userId: req.user._id,
        embedUrl: `https://www.youtube.com/embed/${stream.youtubeId}?autoplay=1&mute=0`,
        text: caption || stream.text || channel.name,
      })
      return res.status(200).json({ post })
    }
    return res.status(400).json({ error: 'Nothing to share' })
  } catch (error) {
    console.error('📺 [shareVideo]', error)
    res.status(500).json({ error: error.message })
  }
}
