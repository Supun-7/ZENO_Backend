import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import authRoutes    from './routes/auth.js'
import moduleRoutes  from './routes/modules.js'
import slotRoutes    from './routes/slots.js'
import sessionRoutes from './routes/sessions.js'

const app = express()
const PORT = process.env.PORT || 3001

// -----------------------------------------------
// MIDDLEWARE
// These run on every single request, in order
// -----------------------------------------------

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' })) // 10mb for large overview texts

// Allow requests from your React frontend
// In production replace with your actual Vercel URL
app.use(cors({
  origin: [
    'http://localhost:5173',           // Vite dev server
    'https://zeno-frontend-ruby.vercel.app',      // your production frontend
    /\.vercel\.app$/                   // any vercel preview URL
  ],
  credentials: true
}))

// -----------------------------------------------
// ROUTES
// Each route file handles a specific resource
// -----------------------------------------------
app.use('/api/auth',     authRoutes)
app.use('/api/modules',  moduleRoutes)
app.use('/api/slots',    slotRoutes)
app.use('/api/sessions', sessionRoutes)

// Health check - useful for Render to verify server is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// Global error handler - catches any unhandled errors
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`StudyOS backend running on port ${PORT}`)
})
