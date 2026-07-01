/**
 * One-time backfill: migrate legacy `Post.likes[]` arrays into the `Like` collection
 * and set the denormalized `Post.likeCount`.
 *
 * Safe to re-run (idempotent): likes are upserted against the unique {post,user} index,
 * so existing rows are never duplicated, and likeCount is recomputed from the array.
 *
 * Run from the backend directory:
 *   node scripts/backfillLikes.js
 */
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Post from '../models/post.js'
import Like from '../models/like.js'

dotenv.config()

const BATCH = 500

async function run() {
    if (!process.env.MONGO) {
        console.error('❌ MONGO env var is not set.')
        process.exit(1)
    }
    await mongoose.connect(process.env.MONGO)
    console.log('✅ Connected. Backfilling post likes → Like collection...')

    const cursor = Post.find({ 'likes.0': { $exists: true } })
        .select('_id likes createdAt')
        .lean()
        .cursor()

    let posts = 0
    let likesInserted = 0
    let ops = []

    const flush = async () => {
        if (!ops.length) return
        try {
            const r = await Like.bulkWrite(ops, { ordered: false })
            likesInserted += r.upsertedCount || 0
        } catch (e) {
            // ordered:false → duplicate-key errors on re-run are expected and safe.
            likesInserted += e?.result?.upsertedCount || 0
            const nonDup = (e?.writeErrors || []).filter((w) => w?.err?.code !== 11000)
            if (nonDup.length) console.error('bulkWrite errors:', nonDup.length)
        }
        ops = []
    }

    for await (const post of cursor) {
        const likes = Array.isArray(post.likes) ? post.likes : []
        const baseTime = post.createdAt ? new Date(post.createdAt).getTime() : Date.now()

        likes.forEach((uid, idx) => {
            if (!uid) return
            const ts = new Date(baseTime + idx * 1000)
            ops.push({
                updateOne: {
                    filter: { post: post._id, user: uid },
                    update: {
                        $setOnInsert: {
                            _id: new mongoose.Types.ObjectId(),
                            post: post._id,
                            user: uid,
                            createdAt: ts,
                            updatedAt: ts,
                        },
                    },
                    upsert: true,
                },
            })
        })

        await Post.updateOne({ _id: post._id }, { $set: { likeCount: likes.length } })
        posts++

        if (ops.length >= BATCH) await flush()
        if (posts % 500 === 0) {
            console.log(`  …processed ${posts} posts, ~${likesInserted} likes inserted`)
        }
    }
    await flush()

    console.log(`✅ Done. Posts processed: ${posts}, likes inserted: ${likesInserted}`)
    await mongoose.disconnect()
    process.exit(0)
}

run().catch((e) => {
    console.error('❌ Backfill failed:', e)
    process.exit(1)
})
