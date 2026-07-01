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
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Post from '../models/post.js'
import Like from '../models/like.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Load .env from the current dir if present, then fall back to the project root .env
// (this repo keeps it at D:/thredtrain/.env, one level above /backend).
dotenv.config()
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

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
    let docs = []

    const flush = async () => {
        if (!docs.length) return
        try {
            // Insert order is preserved, so _id stays monotonic = like order (newest last).
            const res = await Like.insertMany(docs, { ordered: false })
            likesInserted += res.length
        } catch (e) {
            // ordered:false → duplicate-key (11000) errors are expected on re-run; keep the rest.
            likesInserted += Array.isArray(e?.insertedDocs) ? e.insertedDocs.length : 0
            const writeErrors = e?.writeErrors || []
            const nonDup = writeErrors.filter((w) => (w?.err?.code ?? w?.code) !== 11000)
            if (nonDup.length) {
                console.error('insertMany non-dup errors:', nonDup.length, nonDup[0]?.errmsg || '')
            }
        }
        docs = []
    }

    for await (const post of cursor) {
        const likes = Array.isArray(post.likes) ? post.likes : []

        for (const uid of likes) {
            if (!uid) continue
            docs.push({ post: post._id, user: uid })
        }

        await Post.updateOne({ _id: post._id }, { $set: { likeCount: likes.length } })
        posts++

        if (docs.length >= BATCH) await flush()
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
