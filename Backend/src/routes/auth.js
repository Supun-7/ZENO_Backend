import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import supabase from '../services/supabase.js'
import authenticate from '../middleware/authenticate.js'

const router = express.Router()

// Helper - generate a JWT for a user
function generateToken(userId, email) {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' } // stay logged in for 30 days
  )
}

// -----------------------------------------------
// POST /api/auth/signup
// Body: { email, password, wakeHour, targetGrade, examDate }
// -----------------------------------------------
router.post('/signup', async (req, res) => {
  const { email, password, wakeHour, targetGrade, examDate } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  // Check if user already exists
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', (await supabase.auth.admin.getUserByEmail(email))?.data?.user?.id)
    .single()

  // Create user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true // skip email confirmation for now
  })

  if (authError) {
    return res.status(400).json({ error: authError.message })
  }

  const userId = authData.user.id

  // Create profile row
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      wake_hour: wakeHour || 6,
      target_grade: targetGrade || 'A',
      exam_date: examDate || null
    })

  if (profileError) {
    return res.status(500).json({ error: 'Failed to create profile' })
  }

  const token = generateToken(userId, email)
  res.status(201).json({ token, userId, email })
})

// -----------------------------------------------
// POST /api/auth/login
// Body: { email, password }
// -----------------------------------------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  // Use Supabase Auth to verify credentials
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const userId = data.user.id

  // Fetch the user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  const token = generateToken(userId, email)
  res.json({ token, userId, email, profile })
})

// -----------------------------------------------
// GET /api/auth/me
// Returns current user profile - requires auth
// -----------------------------------------------
router.get('/me', authenticate, async (req, res) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single()

  if (error) {
    return res.status(404).json({ error: 'Profile not found' })
  }

  res.json({ userId: req.user.id, email: req.user.email, profile })
})

// -----------------------------------------------
// PATCH /api/auth/profile
// Update wake hour, target grade, exam date
// -----------------------------------------------
router.patch('/profile', authenticate, async (req, res) => {
  const { wakeHour, targetGrade, examDate } = req.body

  const updates = {}
  if (wakeHour !== undefined)   updates.wake_hour = wakeHour
  if (targetGrade !== undefined) updates.target_grade = targetGrade
  if (examDate !== undefined)   updates.exam_date = examDate

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
