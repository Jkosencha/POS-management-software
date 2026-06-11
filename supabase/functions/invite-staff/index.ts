/**
 * invite-staff — Supabase Edge Function (Deno runtime)
 *
 * Sends a Supabase magic-link invitation to a new staff member.
 * Only owners may call this. The invited user sets their password
 * when they click the link; the handle_new_user trigger creates
 * their profile with the supplied full_name and role.
 *
 * Deploy:
 *   supabase functions deploy invite-staff
 *   (keep --verify-jwt default ON — the caller must be authenticated)
 *
 * Request body: { email, full_name, role: "cashier" | "manager" | "owner" }
 * Response:     { ok: true } | { error: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    })
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
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
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Only owners can invite staff' }), { status: 403, headers: corsHeaders })
    }

    const { email, full_name, role } = await req.json()
    if (!email) {
      return new Response(JSON.stringify({ error: 'email is required' }), { status: 400, headers: corsHeaders })
    }

    const validRoles = ['cashier', 'manager', 'owner']
    if (role && !validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers: corsHeaders })
    }

    // Send invitation email — the user clicks the link and sets a password
    const { error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: full_name || email.split('@')[0],
        role:      role || 'cashier',
      },
    })

    if (inviteErr) {
      return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400, headers: corsHeaders })
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
