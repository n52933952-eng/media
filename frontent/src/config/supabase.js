// Supabase configuration for thredtrain
import { createClient } from '@supabase/supabase-js'

// Your Supabase credentials from Dashboard > Settings > API
const supabaseUrl = 'https://esmtbzmxhugnxrwyvlkb.supabase.co' // Your Project URL
const supabaseAnonKey = 'sb_publishable_lgh0MgMXND422E_EE1K2rw_VsLq97GB' // Publishable key (safe for browser)

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export default supabase

