import express from 'express'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'
import { analyzeModuleOverview } from '../services/gemini.js'

const router = express.Router()
router.use(deviceId)

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .eq('device_id', req.deviceId)
    .order('display_order')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const {
    name, credits, midMark, midWeight,
    confidenceRating, overviewText, color, displayOrder,
    assessments
  } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'Module name required' })

  // Validate assessments if provided
  const validatedAssessments = validateAssessments(assessments)

  const { data, error } = await supabase
    .from('modules')
    .insert({
      device_id:         req.deviceId,
      name:              name.trim(),
      credits:           parseFloat(credits) || 3,
      mid_mark:          midMark != null && midMark !== '' ? parseFloat(midMark) : null,
      mid_weight:        parseFloat(midWeight) || 30,
      confidence_rating: parseInt(confidenceRating) || 3,
      overview_text:     overviewText?.trim() || null,
      color:             color || '#7C9E87',
      display_order:     displayOrder || 0,
      assessments:       validatedAssessments,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.patch('/:id', async (req, res) => {
  const fields = {
    name:             'name',
    credits:          'credits',
    midMark:          'mid_mark',
    midWeight:        'mid_weight',
    confidenceRating: 'confidence_rating',
    overviewText:     'overview_text',
    color:            'color',
  }

  const updates = {}
  Object.entries(fields).forEach(([k, dbk]) => {
    if (req.body[k] !== undefined) updates[dbk] = req.body[k]
  })

  // Handle assessments separately with validation
  if (req.body.assessments !== undefined) {
    updates.assessments = validateAssessments(req.body.assessments)
  }

  const { data, error } = await supabase
    .from('modules')
    .update(updates)
    .eq('id', req.params.id)
    .eq('device_id', req.deviceId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Trigger AI analysis on a single module
router.post('/:id/analyze', async (req, res) => {
  const { data: mod } = await supabase
    .from('modules').select('*').eq('id', req.params.id).eq('device_id', req.deviceId).single()
  if (!mod) return res.status(404).json({ error: 'Module not found' })

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('device_id', req.deviceId).single()

  const weeksLeft = profile?.exam_date
    ? Math.max(1, Math.ceil((new Date(profile.exam_date) - new Date()) / (1000*60*60*24*7)))
    : 5

  try {
    const result = await analyzeModuleOverview({
      name:             mod.name,
      credits:          mod.credits,
      midMark:          mod.mid_mark,
      midWeight:        mod.mid_weight,
      confidenceRating: mod.confidence_rating,
      overviewText:     mod.overview_text,
      targetGrade:      profile?.target_grade || 'A',
      weeksLeft,
    })

    const { data: updated } = await supabase
      .from('modules')
      .update({ topics: result.topics, recommended_hours: result.recommendedHours })
      .eq('id', req.params.id).eq('device_id', req.deviceId)
      .select().single()

    res.json(updated)
  } catch (err) {
    console.error('Gemini analyze error:', err.message)
    res.status(500).json({ error: 'AI analysis failed: ' + err.message })
  }
})

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('modules').delete().eq('id', req.params.id).eq('device_id', req.deviceId)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

/* ─── Helper: validate and normalise assessments payload ─────────────────── */
// assessments = { scored, outOf, weight, type } | null
function validateAssessments(raw) {
  if (!raw) return null
  const scored = raw.scored != null && raw.scored !== '' ? parseFloat(raw.scored) : null
  const outOf  = raw.outOf  != null && raw.outOf  !== '' ? parseFloat(raw.outOf)  : null
  const weight = raw.weight != null && raw.weight !== '' ? parseFloat(raw.weight) : null
  const type   = raw.type?.trim() || 'Project / Assignment'

  // Only store if at least weight is set
  if (weight == null) return null

  return { scored, outOf, weight, type }
}

export default router
