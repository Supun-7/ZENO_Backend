import { createClient } from '@supabase/supabase-js'

// We use the SERVICE ROLE key here - this bypasses RLS
// That's intentional because our Express server enforces
// its own auth via JWT. The service role key must NEVER
// go to the frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default supabase
