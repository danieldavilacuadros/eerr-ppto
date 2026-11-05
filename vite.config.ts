import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa: funciona en GitHub Pages (https://usuario.github.io/repo/) sin configurar nada
export default defineConfig({
  plugins: [react()],
  base: './',
})
