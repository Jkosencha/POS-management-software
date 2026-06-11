/**
 * mpesa-stk  — Supabase Edge Function (Deno runtime)
 *
 * Called by the POS frontend to initiate a Lipa Na M-Pesa Online (STK Push).
 *
 * Required env vars in Supabase dashboard → Settings → Edge Functions:
 *   MPESA_CONSUMER_KEY       — from Daraja / Safaricom Developer portal
 *   MPESA_CONSUMER_SECRET    — from Daraja
 *   MPESA_SHORTCODE          — your Till / Paybill number
 *   MPESA_PASSKEY            — Lipa Na M-Pesa online passkey
 *   MPESA_CALLBACK_URL       — public URL of your mpesa-callback function
 *                              e.g. https://<project-ref>.supabase.co/functions/v1/mpesa-callback
 *
 * Deploy:
 *   supabase functions deploy mpesa-stk --no-verify-jwt
 *   (no-verify-jwt so the function can be called with the anon key)
 *
 * Request body: { phone: "0712345678", amount: 1500, cashier_id: "<uuid>" }
 * Response:     { checkout_id: "...", request_id: "<mpesa_requests.id>" }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DARAJA_BASE = Deno.env.get('MPESA_SANDBOX') === 'true'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke'

function formatPhone(raw: string): string {
  // Accept 07xxxxxxxx, +2547xxxxxxxx, 2547xxxxxxxx → always 2547xxxxxxxx
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0'))  return '254' + digits.slice(1)
  if (digits.startsWith('254')) return digits
  if (digits.startsWith('7') || digits.startsWith('1')) return '254' + digits
  return digits
}

async function getOAuthToken(): Promise<string> {
  const key    = Deno.env.get('MPESA_CONSUMER_KEY')!
  const secret = Deno.env.get('MPESA_CONSUMER_SECRET')!
  const creds  = btoa(`${key}:${secret}`)

  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  })
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`)
  const { access_token } = await res.json()
  return access_token
}

Deno.serve(async (req) => {
  // CORS for browser requests
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
    const { phone, amount, cashier_id } = await req.json()

    if (!phone || !amount) {
      return new Response(JSON.stringify({ error: 'phone and amount are required' }), {
        status: 400, headers: corsHeaders,
      })
    }

    const shortcode   = Deno.env.get('MPESA_SHORTCODE')!
    const passkey     = Deno.env.get('MPESA_PASSKEY')!
    const callbackUrl = Deno.env.get('MPESA_CALLBACK_URL')!

    // Timestamp: YYYYMMDDHHmmss
    const ts = new Date().toISOString()
      .replace(/[-:T]/g, '').slice(0, 14)

    const password = btoa(`${shortcode}${passkey}${ts}`)
    const token    = await getOAuthToken()

    const stkBody = {
      BusinessShortCode: shortcode,
      Password:          password,
      Timestamp:         ts,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(Number(amount)), // Safaricom requires integer
      PartyA:            formatPhone(phone),
      PartyB:            shortcode,
      PhoneNumber:       formatPhone(phone),
      CallBackURL:       callbackUrl,
      AccountReference:  'Minimart POS',
      TransactionDesc:   'Sale payment',
    }

    const stkRes = await fetch(
      `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(stkBody),
      }
    )

    const stkData = await stkRes.json()

    if (!stkRes.ok || stkData.ResponseCode !== '0') {
      return new Response(
        JSON.stringify({ error: stkData.errorMessage || stkData.ResponseDescription || 'STK push failed' }),
        { status: 502, headers: corsHeaders }
      )
    }

    // Persist in mpesa_requests using service-role key (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await supabase
      .from('mpesa_requests')
      .insert({
        checkout_id: stkData.CheckoutRequestID,
        phone:       formatPhone(phone),
        amount:      Number(amount),
        status:      'pending',
        cashier_id:  cashier_id || null,
      })
      .select('id')
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({ checkout_id: stkData.CheckoutRequestID, request_id: data.id }),
      { status: 200, headers: corsHeaders }
    )

  } catch (err) {
    console.error('mpesa-stk error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
