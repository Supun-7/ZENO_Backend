import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import profileRoutes  from './routes/profile.js'
import moduleRoutes   from './routes/modules.js'
import planRoutes     from './routes/plan.js'
import slotRoutes     from './routes/slots.js'
import sessionRoutes  from './routes/sessions.js'

const app  = express()
const PORT = process.env.PORT || 3001

app.use(express.json({ limit: '10mb' }))

const allowedOrigins = [
  'http://localhost:5173',
  'https://zeno-frontend-ruby.vercel.app'
]

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.railway.app')
    ) {
      return callback(null, true)
    }

    return callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

app.options('*', cors()) // ✅ handle preflight

app.use('/api/profile',  profileRoutes)
app.use('/api/modules',  moduleRoutes)
app.use('/api/plan',     planRoutes)
app.use('/api/slots',    slotRoutes)
app.use('/api/sessions', sessionRoutes)

app.get('/health', (_, res) =>
  res.json({ status: 'ok', version: '3.0', timestamp: new Date().toISOString() })
)

app.use((req, res) =>
  res.status(404).json({ error: `${req.method} ${req.path} not found` })
)

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => console.log(`Zeno backend v3 running on port ${PORT}`))