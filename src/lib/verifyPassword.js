import { supabase } from './supabase'

// Re-checks the signed-in user's password before a destructive action.
// Returns null if correct, or an error message.
export async function verifyPassword(password) {
  const { data: { session } } = await supabase.auth.getSession()
  const email = session?.user?.email
  if (!email) return 'You are signed out. Sign in again.'
  if (!password) return 'Enter your password.'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error ? 'Incorrect password.' : null
}
