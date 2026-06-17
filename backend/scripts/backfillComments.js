/**
 * Copy embedded Post.replies[] into the Comment collection (preserves reply _id).
 * Run once after deploy: node backend/scripts/backfillComments.js
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import Post from '../models/post.js'
import Comment from '../models/comment.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const BATCH = Number(process.env.BACKFILL_COMMENTS_BATCH || 200)

async function main() {
  const uri = process.env.MONGO || process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGO (or MONGO_URI) required')
    process.exit(1)
  }
  await mongoose.connect(uri, { maxPoolSize: 10 })
  console.log('Connected — backfilling comments…')

  let lastId = null
  let postsSeen = 0
  let commentsUpserted = 0

  while (true) {
    const query = {
      replies: { $exists: true, $not: { $size: 0 } },
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    }
    const posts = await Post.find(query)
      .sort({ _id: 1 })
      .limit(BATCH)
      .select('_id replies')
      .lean()

    if (!posts.length) break

    for (const post of posts) {
      postsSeen++
      const postId = post._id
      const replies = Array.isArray(post.replies) ? post.replies : []
      if (!replies.length) continue

      for (const r of replies) {
        if (!r?.userId || !r?.text) continue
        await Comment.updateOne(
          { _id: r._id },
          {
            $set: {
              postId,
              userId: r.userId,
              text: r.text,
              username: r.username || '',
              userProfilePic: r.userProfilePic || '',
              date: r.date || new Date(),
              parentReplyId: r.parentReplyId || null,
              likes: Array.isArray(r.likes) ? r.likes : [],
              mentionedUser: r.mentionedUser || null,
              footballMatchId: r.footballMatchId || null,
            },
          },
          { upsert: true },
        )
        commentsUpserted++
      }

      await Post.updateOne({ _id: postId }, { $set: { replyCount: replies.length } })
    }

    lastId = posts[posts.length - 1]._id
    console.log(`… posts ${postsSeen}, comments upserted ${commentsUpserted}`)
  }

  console.log(`Done. Posts with replies: ${postsSeen}, comment docs upserted: ${commentsUpserted}`)
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
