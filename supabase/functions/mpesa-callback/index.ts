/**
 * mpesa-callback — Supabase Edge Function (Deno runtime)
 *
 * Receives the asynchronous callback from Safaricom after STK Push completes.
 * Updates mpesa_requests.status + mpesa_ref, then the POS frontend picks up
 * the change via Supabase Realtime.
 *
 * Deploy:
 *   supabase functions deploy mpesa-callback --no-verify-jwt
 *
 * No env vars needed beyond the built-in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Safaricom sends a POST to this URL. The outer envelope looks like:
 * {
 *   "Body": {
 *     "stkCallback": {
 *       "MerchantRequestID": "...",
 *       "CheckoutRequestID": "ws_CO_...",
 *       "ResultCode": 0,       // 0 = success
 *       "ResultDesc": "The service request is processed successfully.",
 *       "CallbackMetadata": {
 *         "Item": [
 *           { "Name": "Amount",              "Value": 1500 },
 *           { "Name": "MpesaReceiptNumber",  "Value": "RGQ71KX63I" },
 *           { "Name": "TransactionDate",     "Value": 20240102120000 },
 *           { "Name": "PhoneNumber",         "Value": 254712345678 }
 *         ]
 *       }
 *     }
 *   }
 * }
 *
 * On failure ResultCode !== 0 and CallbackMetadata is absent.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // Safaricom only sends POST; ignore anything else
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const payload = await req.json()
    const callback = payload?.Body?.stkCallback

    if (!callback) {
      console.warn('mpesa-callback: unexpected payload shape', JSON.stringify(payload))
      return new Response('Bad Request', { status: 400 })
    }

    const {
      CheckoutRequestID: checkoutId,
      ResultCode:        resultCode,
      ResultDesc:        resultDesc,
      CallbackMetadata,
    } = callback

    // Extract M-Pesa receipt number from metadata (only present on success)
    let mpesaRef: string | null = null
    if (resultCode === 0 && CallbackMetadata?.Item) {
      const receiptItem = (CallbackMetadata.Item as Array<{ Name: string; Value: unknown }>)
        .find(i => i.Name === 'MpesaReceiptNumber')
      mpesaRef = receiptItem ? String(receiptItem.Value) : null
    }

    const status = resultCode === 0 ? 'success' : 'failed'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error } = await supabase
      .from('mpesa_requests')
      .update({
        status,
        mpesa_ref:   mpesaRef,
        result_desc: resultDesc,
      })
      .eq('checkout_id', checkoutId)

    if (error) {
      console.error('mpesa-callback: DB update failed', error)
      // Still return 200 so Safaricom doesn't keep retrying — we can reconcile later
    }

    console.log(`mpesa-callback: ${checkoutId} → ${status}${mpesaRef ? ` (${mpesaRef})` : ''}`)

    // Safaricom expects a 200 with this exact JSON to acknowledge receipt
    return new Response(
      JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('mpesa-callback: unhandled error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
})
