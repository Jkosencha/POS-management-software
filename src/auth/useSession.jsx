import { useState, useEffect, createContext, useContext } from 'react'
import { supabase, authLinkType } from '../lib/supabase'

const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // 'invite' | 'recovery' | null: user arrived from an email link and
  // must choose a password before using the app
  const [mustSetPassword, setMustSetPassword] = useState(authLinkType)
  const [blockedMsg, setBlockedMsg] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else { setMustSetPassword(null); setLoading(false) }  // e.g. expired email link
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setMustSetPassword('recovery')
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    // Deactivated staff are already locked out by RLS; sign them out too
    if (data && (data.active === false || data.deleted_at)) {
      setBlockedMsg('This account has been deactivated. Ask the store owner to reactivate it.')
      await supabase.auth.signOut()
      return
    }

    setProfile(data)
    setLoading(false)
  }

  const signOut = async () => {
    // Don't leave the last user's cached data on a shared till
    if ('caches' in window) await caches.delete('supabase-rest-cache').catch(() => {})
    return supabase.auth.signOut()
  }

  return (
    <SessionContext.Provider value={{
      session, profile, loading, signOut,
      refetchProfile: () => fetchProfile(session?.user?.id),
      mustSetPassword, clearMustSetPassword: () => setMustSetPassword(null),
      blockedMsg, clearBlockedMsg: () => setBlockedMsg(null),
    }}>
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = () => useContext(SessionContext)
