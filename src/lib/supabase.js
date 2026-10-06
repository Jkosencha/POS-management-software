import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
}

// Invite and password-reset emails link back here with "#...&type=invite" or
// "type=recovery". supabase-js consumes and clears that hash while creating
// the client, so read it first: those users must set a password before
// they can use the app.
const hashType = new URLSearchParams(window.location.hash.slice(1)).get('type')
export const authLinkType = hashType === 'invite' || hashType === 'recovery' ? hashType : null

export const supabase = createClient(url, key)
