# Fix Row Level Security (RLS) Policy Error

## Error Message:
```
new row violates row-level security policy
```

## Solution: Disable RLS or Add Policies

Since your buckets are **public**, you need to either disable RLS or create policies to allow uploads.

### Option 1: Disable RLS (Easiest - Recommended for Public Buckets)

1. Go to **Storage** in Supabase Dashboard
2. Click on your bucket (e.g., `messages`, `posts`, or `profile-pics`)
3. Go to the **"Policies"** tab
4. You'll see "Row Level Security (RLS) is enabled"
5. **Toggle OFF** the RLS switch for public buckets
6. Do this for all 3 buckets: `messages`, `posts`, `profile-pics`

### Option 2: Add Upload Policies (More Secure)

If you want to keep RLS enabled, add these policies:

#### For each bucket (`messages`, `posts`, `profile-pics`):

1. Go to **Storage** > **[Bucket Name]** > **Policies**
2. Click **"New Policy"**
3. Choose **"Create a policy from scratch"**

**Policy 1: Allow Public Uploads**
- Policy name: `Allow public uploads`
- Allowed operation: `INSERT`
- Policy definition (SQL):
```sql
bucket_id = '[bucket-name]'::text
```
(Replace `[bucket-name]` with `messages`, `posts`, or `profile-pics`)

**Policy 2: Allow Public Read** (if not already there)
- Policy name: `Allow public read`
- Allowed operation: `SELECT`
- Policy definition:
```sql
bucket_id = '[bucket-name]'::text
```

### Recommended: Option 1 (Disable RLS)

Since your buckets are already set to **Public**, disabling RLS is the simplest solution. Public buckets don't need RLS because they're meant to be accessible to anyone anyway.


