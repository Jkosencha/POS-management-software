import { useEffect, useRef } from 'react'

const MIN_LEN = 6       // barcodes are at least 6 chars (EAN-8 is 8, EAN-13 is 13)
const MAX_GAP_MS = 40   // keystrokes faster than this are from a scanner, not a human

/**
 * Detects HID barcode scanner input by watching for bursts of fast keystrokes
 * ending in Enter. Works on any OS without drivers — scanners "type" the code.
 *
 * @param {(code: string) => void} onScan  called with the scanned code
 * @param {boolean} enabled               set false to pause (e.g. while a modal is open)
 */
export function useBarcode(onScan, enabled = true) {
  const buffer   = useRef('')
  const lastTime = useRef(0)
  const timer    = useRef(null)

  useEffect(() => {
    if (!enabled) return

    const handleKey = (e) => {
      const now = Date.now()
      const gap = now - lastTime.current
      lastTime.current = now

      if (e.key === 'Enter') {
        const code = buffer.current.trim()
        buffer.current = ''
        clearTimeout(timer.current)
        if (code.length >= MIN_LEN) {
          e.preventDefault()   // don't submit any focused form
          onScan(code)
        }
        return
      }

      if (e.key.length !== 1) return  // skip Shift, Ctrl, ArrowLeft, etc.

      // Gap too large and buffer not empty → this is human typing, reset
      if (gap > MAX_GAP_MS && buffer.current.length > 0) {
        buffer.current = ''
      }

      buffer.current += e.key

      // Safety valve: clear buffer if Enter never arrives
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { buffer.current = '' }, 200)
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(timer.current)
    }
  }, [onScan, enabled])
}
