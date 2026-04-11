import express from 'express'
import supabase from '../services/supabase.js'
import authenticate from '../middleware/authenticate.js'
import { gradeSessionSummary, analyzeWeeklyProgress } from '../services/gemini.js'

const router = express.Router()
router.use(authenticate)

// Slot duration map in minutes - matches frontend schedule
const SLOT_DURATIONS = {
  M1: 120, M2: 120,
  E1: 60,  E2: 60,  E3: 30,
  N1: 150
}

// -----------------------------------------------
// POST /api/sessions
// Complete a slot - core action of the app
// Body: { slotId, summary }
// -----------------------------------------------
router.post('/', async (req, res) => {
  const { slotId, summary } = req.body

  if (!slotId || !summary?.trim()) {
    return res.status(400).json({ error: 'slotId and summary required' })
  }

  // Fetch the slot and verify ownership
  const { data: slot, error: slotError } = await supabase
    .from('slots')
    .select('*, module:modules(id, name, topics)')
    .eq('id', slotId)
    .eq('user_id', req.user.id)
    .single()

  if (slotError || !slot) return res.status(404).json({ error: 'Slot not found' })
  if (slot.status === 'done') return res.status(400).json({ error: 'Slot already completed' })
  if (slot.status === 'missed') return res.status(400).json({ error: 'Cannot complete a missed slot' })
  if (!slot.module_id) return res.status(400).json({ error: 'No module assigned to this slot' })

  // Fetch recent sessions for this module (for trend context)
  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('efficiency_score')
    .eq('module_id', slot.module_id)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(5)

  // Call Gemini to grade the session
  let efficiency = { score: 70, label: 'Logged', feedback: 'Session saved.', tip: 'Keep going.', topicsCovered: [], trendNote: '' }

  try {
    efficiency = await gradeSessionSummary({
      moduleName:     slot.module?.name || '',
      summary,
      durationMinutes: SLOT_DURATIONS[slot.slot_key] || 60,
      topics:          slot.module?.topics || [],
      recentSessions:  recentSessions || []
    })
  } catch (err) {
    console.error('Gemini grading error:', err.message)
    // Don't fail the request if AI fails - still save the session
  }

  // Create the session record
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      slot_id:          slotId,
      module_id:        slot.module_id,
      user_id:          req.user.id,
      summary,
      efficiency_score: efficiency.score,
      efficiency_label: efficiency.label,
      feedback:         efficiency.feedback,
      tip:              efficiency.tip,
      topics_covered:   efficiency.topicsCovered || [],
      duration_minutes: SLOT_DURATIONS[slot.slot_key] || 60
    })
    .select()
    .single()

  if (sessionError) return res.status(500).json({ error: sessionError.message })

  // Mark the slot as done
  await supabase
    .from('slots')
    .update({ status: 'done' })
    .eq('id', slotId)
    .eq('user_id', req.user.id)

  res.status(201).json({ session, efficiency })
})

// -----------------------------------------------
// GET /api/sessions/history?moduleId=xxx&limit=20
// Get session history, optionally filtered by module
// -----------------------------------------------
router.get('/history', async (req, res) => {
  const { moduleId, limit = 20 } = req.query

  let query = supabase
    .from('session_details')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit))

  if (moduleId) query = query.eq('module_id', moduleId)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// -----------------------------------------------
// GET /api/sessions/stats
// Per-module efficiency trends and hour totals
// -----------------------------------------------
router.get('/stats', async (req, res) => {
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('module_id, efficiency_score, duration_minutes, created_at, topics_covered')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const { data: modules } = await supabase
    .from('modules')
    .select('id, name, color, recommended_hours')
    .eq('user_id', req.user.id)

  // Build stats per module
  const stats = (modules || []).map(mod => {
    const modSessions = sessions.filter(s => s.module_id === mod.id)
    const scores = modSessions.map(s => s.efficiency_score).filter(Boolean)
    const totalMinutes = modSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)

    // Trend: last 5 sessions efficiency scores in order
    const trend = modSessions.slice(0, 5).map(s => s.efficiency_score).reverse()

    return {
      moduleId:         mod.id,
      moduleName:       mod.name,
      color:            mod.color,
      totalSessions:    modSessions.length,
      totalHours:       Math.round((totalMinutes / 60) * 10) / 10,
      avgEfficiency:    scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : null,
      trend,
      recommendedHours: mod.recommended_hours?.perWeek || null
    }
  })

  res.json(stats)
})

// -----------------------------------------------
// GET /api/sessions/weekly-analysis?startDate=2025-01-13
// AI analysis of the entire week's performance
// -----------------------------------------------
router.get('/weekly-analysis', async (req, res) => {
  const { startDate } = req.query
  if (!startDate) return res.status(400).json({ error: 'startDate required' })

  const end = new Date(startDate)
  end.setDate(end.getDate() + 6)
  const endDate = end.toISOString().split('T')[0]

  const { data: weekSessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', req.user.id)
    .gte('created_at', startDate)
    .lte('created_at', endDate + 'T23:59:59')

  const { data: modules } = await supabase
    .from('modules')
    .select('*')
    .eq('user_id', req.user.id)

  const { data: profile } = await supabase
    .from('profiles')
    .select('exam_date')
    .eq('id', req.user.id)
    .single()

  const weeksLeft = profile?.exam_date
    ? Math.max(1, Math.ceil((new Date(profile.exam_date) - new Date()) / (1000 * 60 * 60 * 24 * 7)))
    : 5

  try {
    const analysis = await analyzeWeeklyProgress({
      modules:      modules || [],
      weekSessions: weekSessions || [],
      weeksLeft
    })
    res.json(analysis)
  } catch (err) {
    res.status(500).json({ error: 'Weekly analysis failed' })
  }
})

export default router
