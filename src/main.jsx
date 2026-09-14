import React from 'react'
import ReactDOM from 'react-dom/client'
import { SessionProvider } from './auth/useSession'
import App from './App'
import './styles/tailwind.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </React.StrictMode>
)
