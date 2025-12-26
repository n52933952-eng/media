# Supabase Storage Buckets Setup

After adding your Supabase API key to `thredtrain/frontent/src/config/supabase.js`, you need to create these storage buckets:

## Required Buckets

### 1. `messages` bucket
- **Purpose**: Store chat message images and videos
- **Public**: Yes (so URLs can be accessed)
- **Steps**:
  1. Go to **Storage** in Supabase Dashboard
  2. Click **"New bucket"**
  3. Name: `messages`
  4. Toggle **"Public bucket"** ON
  5. Click **"Create bucket"**

### 2. `posts` bucket
- **Purpose**: Store post images and videos
- **Public**: Yes
- **Steps**:
  1. Go to **Storage** in Supabase Dashboard
  2. Click **"New bucket"**
  3. Name: `posts`
  4. Toggle **"Public bucket"** ON
  5. Click **"Create bucket"**

### 3. `profile-pics` bucket
- **Purpose**: Store user profile pictures
- **Public**: Yes
- **Steps**:
  1. Go to **Storage** in Supabase Dashboard
  2. Click **"New bucket"**
  3. Name: `profile-pics`
  4. Toggle **"Public bucket"** ON
  5. Click **"Create bucket"**

## Optional: Set Bucket Policies

For better security, you can set policies. Go to **Storage** > **Policies** > [bucket name] and add:

**Allow public read** (for all buckets):
- Operation: `SELECT`
- Policy: `bucket_id = '[bucket-name]'::text`

**Allow authenticated uploads** (for messages and posts):
- Operation: `INSERT`
- Policy: `(bucket_id = '[bucket-name]'::text) AND (auth.role() = 'authenticated'::text)`

**Note**: Since you're using the `anon` key directly from frontend, public read is sufficient for now.

## That's It!

Once buckets are created and your API key is added, all file uploads will work! 🎉


