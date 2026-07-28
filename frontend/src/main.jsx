import React from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { SiteConfigProvider } from './contexts/SiteConfigContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { ThemeProvider } from './contexts/ThemeContext'
import TelegramAuthGate from './components/TelegramAuthGate'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <ThemeProvider>
        <SiteConfigProvider>
          <NotificationProvider>
            <TelegramAuthGate>
              <App />
            </TelegramAuthGate>
          </NotificationProvider>
        </SiteConfigProvider>
      </ThemeProvider>
    </HelmetProvider>
  </React.StrictMode>
)
