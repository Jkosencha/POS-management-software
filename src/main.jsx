import React from 'react'
import ReactDOM from 'react-dom/client'
import { SessionProvider } from './auth/useSession'
import App from './App'
import './styles/tailwind.css'

// Ask the browser to never auto-delete this app's storage (the offline sale
// queue lives there). Installed PWAs are usually granted this automatically.
navigator.storage?.persist?.().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </React.StrictMode>
)
