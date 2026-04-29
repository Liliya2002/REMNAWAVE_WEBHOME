import React from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { SiteConfigProvider } from './contexts/SiteConfigContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { ThemeProvider } from './contexts/ThemeContext'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <ThemeProvider>
        <SiteConfigProvider>
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </SiteConfigProvider>
      </ThemeProvider>
    </HelmetProvider>
  </React.StrictMode>
)
