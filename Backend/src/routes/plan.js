import express from 'express'
import { format, addDays, getDay } from 'date-fns'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'
import { analyzeModuleOverview, generateStudyPlan } from '../services/gemini.js'

const router = express.Router()
router.use(deviceId)

const SLOT_DURATIONS = { S1: 120, S2: 105, S3: 60, S4: 75 }
const ALL_SLOTS      = ['S1', 'S2', 'S3', 'S4']

// POST /api/plan/generate
// Called after setup — analyzes all modules then generates full schedule
router.post('/generate', async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('device_id', req.deviceId).single()

  if (!profile?.exam_date) {
    return res.status(400).json({ error: 'exam_date must be set in profile before generating plan' })
  }

  const { data: modules } = await supabase
    .from('modules').select('*').eq('device_id', req.deviceId).order('display_order')

  if (!modules?.length) {
    return res.status(400).json({ error: 'No modules found. Add modules first.' })
  }

  const weeksLeft = Math.max(1, Math.ceil(
    (new Date(profile.exam_date) - new Date()) / (1000 * 60 * 60 * 24 * 7)
  ))

  // Step 1 — analyze all modules that have overview text but no AI data yet
  res.setHeader('Content-Type', 'application/json')

  const analyzedModules = []
  for (const mod of modules) {
    if (mod.overview_text && !mod.recommended_hours) {
      try {
        const result = await analyzeModuleOverview({
          name: mod.name, credits: mod.credits,
          midMark: mod.mid_mark, midWeight: mod.mid_weight,
          confidenceRating: mod.confidence_rating,
          overviewText: mod.overview_text,
          targetGrade: profile.target_grade || 'A',
          weeksLeft
        })
        await supabase.from('modules')
          .update({ topics: result.topics, recommended_hours: result.recommendedHours })
          .eq('id', mod.id)
        analyzedModules.push({ ...mod, ...result, recommended_hours: result.recommendedHours })
      } catch (err) {
        console.error(`Analysis failed for ${mod.name}:`, err.message)
        // Fallback hours based on credits
        const fallbackHours = { perWeek: mod.credits * 1.5, totalNeeded: mod.credits * 1.5 * weeksLeft, reasoning: 'Estimated from credit weight.' }
        await supabase.from('modules').update({ recommended_hours: fallbackHours }).eq('id', mod.id)
        analyzedModules.push({ ...mod, recommended_hours: fallbackHours })
      }
    } else {
      analyzedModules.push(mod)
    }
  }

  // Re-fetch modules with updated AI data
  const { data: freshModules } = await supabase
    .from('modules').select('*').eq('device_id', req.deviceId).order('display_order')

  // Step 2 — determine available slots
  const weekdaySlots = ALL_SLOTS
  const satSlots = ALL_SLOTS.filter(s => profile[`sat_${s.toLowerCase()}`])
  const sunSlots = ALL_SLOTS.filter(s => profile[`sun_${s.toLowerCase()}`])

  // Step 3 — generate plan with Gemini
  const today     = format(new Date(), 'yyyy-MM-dd')
  const startDate = today
  const examDate  = profile.exam_date

  let planEntries = []
  try {
    planEntries = await generateStudyPlan({
      modules: freshModules, startDate, examDate,
      weekdaySlots, satSlots, sunSlots
    })
  } catch (err) {
    console.error('Plan generation failed, using fallback:', err.message)
    // Fallback: round-robin assignment
    planEntries = buildFallbackPlan(freshModules, startDate, examDate, weekdaySlots, satSlots, sunSlots)
  }

  // Step 4 — delete old slots and insert new plan
  await supabase.from('slots').delete().eq('device_id', req.deviceId)

  // Batch insert in chunks of 100
  const rows = planEntries.map(e => ({
    device_id: req.deviceId,
    date:      e.date,
    slot_key:  e.slotKey,
    module_id: e.moduleId || null,
    status:    e.status || 'pending'
  }))

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('slots').insert(rows.slice(i, i + 100))
    if (error) console.error('Insert batch error:', error.message)
  }

  // Mark setup complete
  await supabase.from('profiles')
    .update({ setup_complete: true })
    .eq('device_id', req.deviceId)

  res.json({ success: true, slotsGenerated: rows.length, modules: freshModules })
})

// Fallback plan builder (no AI) — used if Gemini fails
function buildFallbackPlan(modules, startDate, examDate, weekdaySlots, satSlots, sunSlots) {
  const entries = []
  let current   = new Date(startDate)
  const end     = new Date(examDate)
  let modIndex  = 0

  while (current < end) {
    const dayOfWeek = getDay(current) // 0=Sun, 6=Sat
    const dateStr   = format(current, 'yyyy-MM-dd')
    const slots     = dayOfWeek === 6 ? satSlots : dayOfWeek === 0 ? sunSlots : weekdaySlots

    for (const slotKey of ALL_SLOTS) {
      if (slots.includes(slotKey)) {
        entries.push({
          date: dateStr, slotKey,
          moduleId: modules[modIndex % modules.length]?.id,
          status: 'pending'
        })
        modIndex++
      } else {
        entries.push({ date: dateStr, slotKey, moduleId: null, status: 'rest' })
      }
    }
    current = addDays(current, 1)
  }
  return entries
}

// GET /api/plan/future?from=YYYY-MM-DD&limit=14
router.get('/future', async (req, res) => {
  const from  = req.query.from || format(new Date(), 'yyyy-MM-dd')
  const limit = parseInt(req.query.limit) || 14

  const end = format(addDays(new Date(from), limit), 'yyyy-MM-dd')

  const { data, error } = await supabase
    .from('slots')
    .select('*, module:modules(id,name,color)')
    .eq('device_id', req.deviceId)
    .gte('date', from)
    .lt('date', end)
    .neq('status', 'rest')
    .order('date').order('slot_key')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
