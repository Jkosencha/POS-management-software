/**
 * ESC/POS bridge — run on the till PC with `node index.js`
 *
 * The browser app POSTs receipt JSON to http://127.0.0.1:8080/print
 * and this service forwards it to the USB thermal printer.
 *
 * Setup:
 *   cd escpos-bridge && npm install && node index.js
 *
 * The printer must be plugged in via USB before starting.
 * A cash-drawer kick pulse is sent automatically after each receipt.
 */

const http   = require('http')
const escpos = require('escpos')
escpos.USB   = require('escpos-usb')

const PORT = 8080
const PAD  = 32  // chars per line for 80mm paper at 12cpi

// ---- helpers ----------------------------------------------------------------

function padRow(left, right, width) {
  const space = width - left.length - right.length
  return left + ' '.repeat(Math.max(1, space)) + right
}

function printReceipt(data, cb) {
  let device
  try {
    device = new escpos.USB()
  } catch (e) {
    return cb(new Error('Printer not found. Is it plugged in? ' + e.message))
  }

  device.open((err) => {
    if (err) return cb(new Error('Could not open printer: ' + err.message))

    const printer = new escpos.Printer(device, { encoding: 'GB18030' })

    try {
      // ---- header ----
      printer
        .font('a')
        .align('ct')
        .style('bu')
        .size(1, 1)
        .text(data.store_name.toUpperCase())
        .style('normal')
        .size(0, 0)
        .text(data.meta)
        .drawLine()

      // ---- line items ----
      printer.align('lt')
      ;(data.items || []).forEach(item => {
        const left  = `${item.qty} x ${item.name}`
        const right = `${data.currency} ${Number(item.line_total).toFixed(0)}`
        printer.text(padRow(left.slice(0, PAD - right.length - 1), right, PAD))
      })

      printer.drawLine()

      // ---- totals ----
      if (data.discount_amt > 0) {
        printer.text(padRow(`Discount (${data.discount_pct}%)`, `-${data.currency} ${Number(data.discount_amt).toFixed(0)}`, PAD))
      }
      printer
        .align('rt')
        .style('b')
        .text(padRow('TOTAL', `${data.currency} ${Number(data.total).toFixed(0)}`, PAD))
        .style('normal')
        .text(padRow('VAT incl.', `${data.currency} ${Number(data.vat_amount).toFixed(0)}`, PAD))

      const methodLine = data.mpesa_ref ? `${data.method} (${data.mpesa_ref})` : data.method
      printer.text(padRow(methodLine, `${data.currency} ${Number(data.tendered).toFixed(0)}`, PAD))

      if (data.method === 'Cash' && data.change > 0) {
        printer.text(padRow('Change', `${data.currency} ${Number(data.change).toFixed(0)}`, PAD))
      }

      // ---- footer ----
      printer
        .drawLine()
        .align('ct')
        .text(data.footer || '')
        .text(' ')

      // ---- cut + cash-drawer kick ----
      printer
        .cut()
        .cashdraw(2, 200, 200)  // kick drawer on pin 2, 200ms on / 200ms off
        .close(() => cb(null))

    } catch (printErr) {
      cb(printErr)
    }
  })
}

// ---- HTTP server ------------------------------------------------------------

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end() }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200)
    return res.end('OK')
  }

  if (req.method === 'POST' && req.url === '/print') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      let data
      try { data = JSON.parse(body) } catch {
        res.writeHead(400)
        return res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }

      printReceipt(data, (err) => {
        if (err) {
          console.error('Print error:', err.message)
          res.writeHead(500)
          return res.end(JSON.stringify({ error: err.message }))
        }
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
      })
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ESC/POS bridge listening on http://127.0.0.1:${PORT}`)
  console.log('Make sure the thermal printer is connected via USB.')
})
