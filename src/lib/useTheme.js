import { useState, useEffect } from 'react'

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('pos-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return 'system'
  })

  // Derive effective mode (for the toggle UI)
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('pos-theme')
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      root.removeAttribute('data-theme')
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      setIsDark(mq.matches)
      const handler = (e) => setIsDark(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      root.setAttribute('data-theme', theme)
      setIsDark(theme === 'dark')
    }
  }, [theme])

  function toggle() {
    const next = isDark ? 'light' : 'dark'
    localStorage.setItem('pos-theme', next)
    setTheme(next)
  }

  return { isDark, toggle }
}
