/**
 * invite-staff - Supabase Edge Function (Deno runtime)
 *
 * Sends a Supabase magic-link invitation to a new staff member.
 * Only owners may call this. The invited user sets their password
 * when they click the link; the handle_new_user trigger creates
 * their profile with the supplied full_name and role.
 *
 * Deploy:
 *   supabase functions deploy invite-staff
 *   (keep --verify-jwt default ON - the caller must be authenticated)
 *
 * Request body: { email, full_name, role: "cashier" | "manager" | "owner", redirect_to? }
 *   redirect_to: where the invite link lands (the app's origin). Must be listed
 *   under Authentication > URL Configuration > Redirect URLs in Supabase.
 * Response:     { ok: true } | { error: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// supabase-js sends x-client-info on every request, so the preflight must
// allow it or the browser blocks the call before it reaches this function.
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    // Service-role client (bypasses RLS for the role check)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller's identity
    const { data: { user }, error: userErr } = await serviceClient.auth.getUser(token)
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    // Check that caller is owner
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('role, active, deleted_at')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'owner' || profile?.active === false || profile?.deleted_at) {
      return new Response(JSON.stringify({ error: 'Only owners can invite staff' }), { status: 403, headers: corsHeaders })
    }

    const { email, full_name, role, redirect_to } = await req.json()
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'email is required' }), { status: 400, headers: corsHeaders })
    }

    const validRoles = ['cashier', 'manager', 'owner']
    if (role && !validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers: corsHeaders })
    }

    // Send invitation email - the user clicks the link and sets a password
    const { error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(email.trim(), {
      data: {
        full_name: full_name || email.split('@')[0],
        role:      role || 'cashier',
      },
      ...(typeof redirect_to === 'string' && redirect_to.startsWith('http') ? { redirectTo: redirect_to } : {}),
    })

    if (inviteErr) {
      const msg = /already (been )?registered/i.test(inviteErr.message)
        ? 'That email already has an account. Send them a password reset instead.'
        : inviteErr.message
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders })

  } catch (err) {
    console.error('invite-staff error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
