import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import profileRoutes  from '../routes/profile.js'
import moduleRoutes   from '../routes/modules.js'
import planRoutes     from '../routes/plan.js'
import slotRoutes     from '../routes/slots.js'
import sessionRoutes  from '../routes/sessions.js'

const app  = express()
const PORT = process.env.PORT || 3001

app.use(express.json({ limit: '10mb' }))

// ✅ SAFE CORS (NO CRASH VERSION)
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://zeno-frontend-ruby.vercel.app'
  ],
  credentials: true
}))

app.options('*', cors())

// ROUTES
app.use('/api/profile',  profileRoutes)
app.use('/api/modules',  moduleRoutes)
app.use('/api/plan',     planRoutes)
app.use('/api/slots',    slotRoutes)
app.use('/api/sessions', sessionRoutes)

// HEALTH
app.get('/health', (_, res) =>
  res.json({ status: 'ok', version: '3.0', timestamp: new Date().toISOString() })
)

// 404
app.use((req, res) =>
  res.status(404).json({ error: `${req.method} ${req.path} not found` })
)

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () =>
  console.log(`Zeno backend v3 running on port ${PORT}`)
)