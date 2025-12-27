// Script to clean up sample posts and news posts from database
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Post from '../models/post.js'
import User from '../models/user.js'

dotenv.config()

async function cleanupSamplePosts() {
    try {
        await mongoose.connect(process.env.MONGO)
        console.log("✅ Connected to MongoDB")

        // Find all posts
        const allPosts = await Post.find().populate('postedBy')
        
        console.log(`\n📊 Total posts in database: ${allPosts.length}`)
        
        // Find posts where postedBy is null or invalid (these are likely news/sample posts)
        const invalidPosts = allPosts.filter(post => !post.postedBy || !post.postedBy._id)
        
        console.log(`\n🔍 Found ${invalidPosts.length} posts with invalid postedBy`)
        
        if (invalidPosts.length > 0) {
            // Delete posts where postedBy is invalid
            const deleteResult = await Post.deleteMany({
                _id: { $in: invalidPosts.map(p => p._id) }
            })
            
            console.log(`\n🗑️  Deleted ${deleteResult.deletedCount} invalid posts`)
        }
        
        // Also check for posts that might be sample posts by checking if postedBy exists in User collection
        const validUsers = await User.find({}, '_id')
        const validUserIds = validUsers.map(u => u._id)
        
        const orphanPosts = await Post.find({
            postedBy: { $nin: validUserIds }
        })
        
        console.log(`\n🔍 Found ${orphanPosts.length} orphan posts (postedBy not in User collection)`)
        
        if (orphanPosts.length > 0) {
            const deleteOrphanResult = await Post.deleteMany({
                _id: { $in: orphanPosts.map(p => p._id) }
            })
            
            console.log(`\n🗑️  Deleted ${deleteOrphanResult.deletedCount} orphan posts`)
        }
        
        // Show remaining posts
        const remainingPosts = await Post.find().populate('postedBy')
        console.log(`\n✅ Remaining valid posts: ${remainingPosts.length}`)
        
        console.log("\n✨ Cleanup complete!")
        
        process.exit(0)
    } catch (error) {
        console.error("❌ Error:", error)
        process.exit(1)
    }
}

cleanupSamplePosts()















