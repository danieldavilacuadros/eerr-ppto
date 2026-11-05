import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { DatosProvider } from './lib/datos'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <DatosProvider>
        <App />
      </DatosProvider>
    </HashRouter>
  </React.StrictMode>,
)
