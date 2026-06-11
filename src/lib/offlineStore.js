// IndexedDB wrapper for product cache and offline sale queue.
// All operations are promise-based; errors are caught by callers.

const DB_NAME    = 'minimart-pos'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('product_cache')) {
        db.createObjectStore('product_cache', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('pending_sales')) {
        db.createObjectStore('pending_sales', { keyPath: 'id' })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = ()  => reject(req.error)
  })
}

function awaitTx(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = res
    tx.onerror    = () => rej(tx.error)
  })
}

/* ---- product cache ---- */

export async function cacheProducts(products) {
  const db = await openDB()
  const tx = db.transaction('product_cache', 'readwrite')
  tx.objectStore('product_cache').put({ key: 'all', products, ts: Date.now() })
  return awaitTx(tx)
}

export async function getCachedProducts() {
  const db = await openDB()
  return new Promise((res, rej) => {
    const req = db.transaction('product_cache').objectStore('product_cache').get('all')
    req.onsuccess = e => res(e.target.result?.products ?? null)
    req.onerror   = () => rej(req.error)
  })
}

/* ---- pending sale queue ---- */

export async function enqueueSale(sale) {
  const db = await openDB()
  const tx = db.transaction('pending_sales', 'readwrite')
  tx.objectStore('pending_sales').add(sale)
  return awaitTx(tx)
}

export async function getPendingSales() {
  const db = await openDB()
  return new Promise((res, rej) => {
    const req = db.transaction('pending_sales').objectStore('pending_sales').getAll()
    req.onsuccess = e => res(e.target.result ?? [])
    req.onerror   = () => rej(req.error)
  })
}

export async function removePendingSale(id) {
  const db = await openDB()
  const tx = db.transaction('pending_sales', 'readwrite')
  tx.objectStore('pending_sales').delete(id)
  return awaitTx(tx)
}

export async function countPendingSales() {
  const db = await openDB()
  return new Promise((res, rej) => {
    const req = db.transaction('pending_sales').objectStore('pending_sales').count()
    req.onsuccess = e => res(e.target.result)
    req.onerror   = () => rej(req.error)
  })
}
