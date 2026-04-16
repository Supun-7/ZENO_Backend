import express from 'express'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'
import { gradeSessionSummary, analyzeWeeklyProgress } from '../services/gemini.js'

const router = express.Router()
router.use(deviceId)

const SLOT_DURATIONS = { S1: 120, S2: 105, S3: 60, S4: 75 }

// POST /api/sessions — complete a slot
router.post('/', async (req, res) => {
  const { slotId, summary } = req.body
  if (!slotId || !summary?.trim()) {
    return res.status(400).json({ error: 'slotId and summary are required' })
  }

  const { data: slot, error: slotErr } = await supabase
    .from('slots')
    .select('*, module:modules(id, name, topics)')
    .eq('id', slotId)
    .eq('device_id', req.deviceId)
    .single()

  if (slotErr || !slot)     return res.status(404).json({ error: 'Slot not found' })
  if (slot.status === 'done')   return res.status(400).json({ error: 'Already completed' })
  if (slot.status === 'missed') return res.status(400).json({ error: 'Slot was missed' })
  if (slot.status === 'rest')   return res.status(400).json({ error: 'Rest slot cannot be completed' })
  if (!slot.module_id)          return res.status(400).json({ error: 'No module assigned to slot' })

  // Fetch recent sessions for trend context
  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('efficiency_score')
    .eq('module_id', slot.module_id)
    .eq('device_id', req.deviceId)
    .order('created_at', { ascending: false })
    .limit(5)

  // Grade with Gemini
  let efficiency = {
    score: 70, label: 'Logged',
    feedback: 'Session saved successfully.',
    tip: 'Try to be more specific next time.',
    topicsCovered: [], trendNote: ''
  }

  try {
    efficiency = await gradeSessionSummary({
      moduleName:      slot.module?.name || '',
      summary,
      durationMinutes: SLOT_DURATIONS[slot.slot_key] || 60,
      topics:          slot.module?.topics || [],
      recentSessions:  recentSessions || []
    })
  } catch (err) {
    console.error('Gemini grading error:', err.message)
  }

  // Save session
  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .insert({
      slot_id:          slotId,
      module_id:        slot.module_id,
      device_id:        req.deviceId,
      summary:          summary.trim(),
      efficiency_score: efficiency.score,
      efficiency_label: efficiency.label,
      feedback:         efficiency.feedback,
      tip:              efficiency.tip,
      topics_covered:   efficiency.topicsCovered || [],
      duration_minutes: SLOT_DURATIONS[slot.slot_key] || 60
    })
    .select()
    .single()

  if (sessErr) return res.status(500).json({ error: sessErr.message })

  // Mark slot done
  await supabase.from('slots').update({ status: 'done' })
    .eq('id', slotId).eq('device_id', req.deviceId)

  res.status(201).json({ session, efficiency })
})

// GET /api/sessions/stats
router.get('/stats', async (req, res) => {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('module_id, efficiency_score, duration_minutes, created_at')
    .eq('device_id', req.deviceId)
    .order('created_at', { ascending: false })

  const { data: modules } = await supabase
    .from('modules').select('id, name, color, recommended_hours').eq('device_id', req.deviceId)

  const stats = (modules || []).map(mod => {
    const ms     = (sessions || []).filter(s => s.module_id === mod.id)
    const scores = ms.map(s => s.efficiency_score).filter(Boolean)
    const totalM = ms.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
    return {
      moduleId:         mod.id,
      moduleName:       mod.name,
      color:            mod.color,
      totalSessions:    ms.length,
      totalHours:       Math.round((totalM / 60) * 10) / 10,
      avgEfficiency:    scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      trend:            ms.slice(0, 8).map(s => s.efficiency_score).reverse(),
      recommendedHours: mod.recommended_hours?.perWeek || null
    }
  })

  // Last week overall efficiency
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const lastWeekEnd = new Date(weekStart)

  const lastWeekSessions = (sessions || []).filter(s => {
    const d = new Date(s.created_at)
    return d >= lastWeekStart && d < lastWeekEnd
  })
  const lwScores = lastWeekSessions.map(s => s.efficiency_score).filter(Boolean)
  const lastWeekAvg = lwScores.length
    ? Math.round(lwScores.reduce((a, b) => a + b, 0) / lwScores.length)
    : null

  res.json({ stats, lastWeekAvg })
})

// GET /api/sessions/weekly-analysis
router.get('/weekly-analysis', async (req, res) => {
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd   = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const { data: weekSessions } = await supabase
    .from('sessions').select('*').eq('device_id', req.deviceId)
    .gte('created_at', weekStart).lte('created_at', weekEnd + 'T23:59:59')

  const { data: modules }  = await supabase.from('modules').select('*').eq('device_id', req.deviceId)
  const { data: profile }  = await supabase.from('profiles').select('exam_date').eq('device_id', req.deviceId).single()

  const weeksLeft = profile?.exam_date
    ? Math.max(1, Math.ceil((new Date(profile.exam_date) - new Date()) / (1000*60*60*24*7)))
    : 5

  try {
    const analysis = await analyzeWeeklyProgress({
      modules: modules || [], weekSessions: weekSessions || [], weeksLeft
    })
    res.json(analysis)
  } catch {
    res.status(500).json({ error: 'Weekly analysis failed' })
  }
})

export default router
