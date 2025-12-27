# Supabase Storage Setup Guide

## Steps to Set Up Supabase Storage for File Uploads

### 1. Get Your Supabase Credentials

1. Go to your Supabase Dashboard (https://app.supabase.com)
2. Select your project (or create a new one)
3. Go to **Settings** > **API**
4. Copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (under "Project API keys")

### 2. Update Config File

Edit `thredtrain/frontent/src/config/supabase.js` and replace:
- `YOUR_SUPABASE_PROJECT_URL` with your Project URL
- `YOUR_SUPABASE_ANON_KEY` with your anon/public key

### 3. Create Storage Bucket

1. In Supabase Dashboard, go to **Storage** (left sidebar)
2. Click **"New bucket"**
3. Name it: `messages`
4. Set it to **Public** (so URLs can be accessed without auth)
5. Click **"Create bucket"**

### 4. Set Bucket Policies (Optional but Recommended)

1. Go to **Storage** > **Policies** > `messages` bucket
2. Click **"New Policy"**
3. Choose **"Create a policy from scratch"**
4. Add these policies:

**Policy 1: Allow Uploads**
- Policy name: `Allow authenticated uploads`
- Allowed operation: `INSERT`
- Policy definition:
```sql
(bucket_id = 'messages'::text) AND (auth.role() = 'authenticated'::text)
```

**Policy 2: Allow Public Read**
- Policy name: `Allow public read`
- Allowed operation: `SELECT`
- Policy definition:
```sql
bucket_id = 'messages'::text
```

**Policy 3: Allow Deletes (Optional)**
- Policy name: `Allow own file deletes`
- Allowed operation: `DELETE`
- Policy definition:
```sql
(bucket_id = 'messages'::text) AND ((storage.foldername(name))[1] = auth.uid()::text)
```

### 5. Test It Out!

Once configured, try uploading an image or video in the chat. It should upload to Supabase Storage and display a progress bar.

## Benefits of Supabase Storage

✅ **No Credit Card Required** - Free tier is generous  
✅ **No 100MB Limit** - Can upload large files (145MB+ videos)  
✅ **No CORS Issues** - Properly configured  
✅ **Free Tier**: 1GB storage, 2GB bandwidth per month  
✅ **Progress Tracking** - Real-time upload progress  
✅ **Public URLs** - Direct access to uploaded files  

## File Size Limits

- **Free Tier**: Up to 50MB per file (but can handle larger with proper configuration)
- **Pro Tier**: Up to 5GB per file
- **Custom**: Configure as needed

## Troubleshooting

**Error: "Bucket not found"**
- Make sure you created the `messages` bucket in Storage

**Error: "Invalid API key"**
- Double-check your Project URL and anon key in `supabase.js`

**Error: "Policy violation"**
- Make sure bucket is set to **Public** or policies are configured correctly

**Upload fails silently**
- Check browser console for detailed error messages
- Verify bucket name matches exactly: `messages`




