import express from 'express'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'
import { gradeSessionSummary, analyzeWeeklyProgress } from '../services/gemini.js'

const router = express.Router()
router.use(deviceId)

const SLOT_DURATIONS = { M1:120, M2:120, E1:60, E2:60, E3:30, N1:150 }

router.post('/', async (req, res) => {
  const { slotId, summary } = req.body
  if (!slotId || !summary?.trim()) return res.status(400).json({ error: 'slotId and summary required' })

  const { data: slot, error: slotErr } = await supabase
    .from('slots')
    .select('*, module:modules(id,name,topics)')
    .eq('id', slotId)
    .eq('device_id', req.deviceId)
    .single()

  if (slotErr || !slot) return res.status(404).json({ error: 'Slot not found' })
  if (slot.status === 'done')   return res.status(400).json({ error: 'Already completed' })
  if (slot.status === 'missed') return res.status(400).json({ error: 'Cannot complete a missed slot' })
  if (!slot.module_id)          return res.status(400).json({ error: 'No module assigned' })

  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('efficiency_score')
    .eq('module_id', slot.module_id)
    .eq('device_id', req.deviceId)
    .order('created_at', { ascending: false })
    .limit(5)

  let efficiency = { score: 70, label: 'Logged', feedback: 'Session saved.', tip: 'Keep going.', topicsCovered: [], trendNote: '' }

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

  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .insert({
      slot_id:          slotId,
      module_id:        slot.module_id,
      device_id:        req.deviceId,
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

  if (sessErr) return res.status(500).json({ error: sessErr.message })

  await supabase.from('slots').update({ status: 'done' }).eq('id', slotId).eq('device_id', req.deviceId)

  res.status(201).json({ session, efficiency })
})

router.get('/stats', async (req, res) => {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('module_id, efficiency_score, duration_minutes, created_at')
    .eq('device_id', req.deviceId)
    .order('created_at', { ascending: false })

  const { data: modules } = await supabase
    .from('modules')
    .select('id, name, color, recommended_hours')
    .eq('device_id', req.deviceId)

  const stats = (modules || []).map(mod => {
    const ms = (sessions || []).filter(s => s.module_id === mod.id)
    const scores = ms.map(s => s.efficiency_score).filter(Boolean)
    const totalMin = ms.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
    return {
      moduleId:         mod.id,
      moduleName:       mod.name,
      color:            mod.color,
      totalSessions:    ms.length,
      totalHours:       Math.round((totalMin/60)*10)/10,
      avgEfficiency:    scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : null,
      trend:            ms.slice(0,5).map(s => s.efficiency_score).reverse(),
      recommendedHours: mod.recommended_hours?.perWeek || null
    }
  })

  res.json(stats)
})

router.get('/weekly-analysis', async (req, res) => {
  const { startDate } = req.query
  if (!startDate) return res.status(400).json({ error: 'startDate required' })

  const end = new Date(startDate)
  end.setDate(end.getDate() + 6)
  const endDate = end.toISOString().split('T')[0]

  const { data: weekSessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('device_id', req.deviceId)
    .gte('created_at', startDate)
    .lte('created_at', endDate + 'T23:59:59')

  const { data: modules } = await supabase
    .from('modules').select('*').eq('device_id', req.deviceId)

  const { data: profile } = await supabase
    .from('profiles').select('exam_date').eq('device_id', req.deviceId).single()

  const weeksLeft = profile?.exam_date
    ? Math.max(1, Math.ceil((new Date(profile.exam_date) - new Date()) / (1000*60*60*24*7)))
    : 5

  try {
    const analysis = await analyzeWeeklyProgress({ modules: modules||[], weekSessions: weekSessions||[], weeksLeft })
    res.json(analysis)
  } catch {
    res.status(500).json({ error: 'Weekly analysis failed' })
  }
})

export default router
