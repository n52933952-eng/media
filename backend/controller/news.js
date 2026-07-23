// Live TV channels (Al Jazeera, Fox11, etc.) — mounted at /api/news for mobile compatibility.

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

    console.log(`📺 Creating ${channelConfig.name} ${streamConfig.language} live stream post...`)

    const existingPost = await Post.findOne({
      postedBy: channelAccount._id,
      img: streamUrl,
      channelAddedBy: req.user._id.toString(),
    })

    if (existingPost) {
      console.log(`ℹ️ ${channelConfig.name} live stream post already exists for user`)

      // Do NOT bump updatedAt — that pinned the channel above newer user posts on refresh.
      // Client applies a short-lived viewer boost so the card is still easy to find.
      await invalidateUserFeedCache(req.user._id)

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
      text: streamConfig.text,
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
    res.status(200).json({ channels: LIVE_CHANNELS })
  } catch (error) {
    console.error('📺 [getChannels] Error:', error)
    res.status(500).json({ error: error.message })
  }
}
