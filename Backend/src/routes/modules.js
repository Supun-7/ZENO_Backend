import express from 'express'
import supabase from '../services/supabase.js'
import authenticate from '../middleware/authenticate.js'
import { analyzeModuleOverview } from '../services/gemini.js'

const router = express.Router()

// All module routes require authentication
router.use(authenticate)

// -----------------------------------------------
// GET /api/modules
// Get all modules for the logged-in user
// -----------------------------------------------
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .eq('user_id', req.user.id)
    .order('display_order')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// -----------------------------------------------
// POST /api/modules
// Create a new module
// Body: { name, credits, midMark, midWeight, confidenceRating, overviewText, color }
// -----------------------------------------------
router.post('/', async (req, res) => {
  const { name, credits, midMark, midWeight, confidenceRating, overviewText, color, displayOrder } = req.body

  if (!name) return res.status(400).json({ error: 'Module name required' })

  const { data, error } = await supabase
    .from('modules')
    .insert({
      user_id:           req.user.id,
      name,
      credits:           credits || 3,
      mid_mark:          midMark ?? null,
      mid_weight:        midWeight || 30,
      confidence_rating: confidenceRating || 3,
      overview_text:     overviewText || null,
      color:             color || '#7C6FE0',
      display_order:     displayOrder || 0
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// -----------------------------------------------
// PATCH /api/modules/:id
// Update a module
// -----------------------------------------------
router.patch('/:id', async (req, res) => {
  const { name, credits, midMark, midWeight, confidenceRating, overviewText, color } = req.body

  const updates = {}
  if (name !== undefined)               updates.name = name
  if (credits !== undefined)            updates.credits = credits
  if (midMark !== undefined)            updates.mid_mark = midMark
  if (midWeight !== undefined)          updates.mid_weight = midWeight
  if (confidenceRating !== undefined)   updates.confidence_rating = confidenceRating
  if (overviewText !== undefined)       updates.overview_text = overviewText
  if (color !== undefined)              updates.color = color

  const { data, error } = await supabase
    .from('modules')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id) // ensure user owns this module
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// -----------------------------------------------
// POST /api/modules/:id/analyze
// Trigger Gemini to analyze the module overview.
// This is a separate endpoint because it's async and
// expensive - we don't want it running on every save.
// -----------------------------------------------
router.post('/:id/analyze', async (req, res) => {
  // Fetch the module
  const { data: module, error: fetchError } = await supabase
    .from('modules')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (fetchError || !module) {
    return res.status(404).json({ error: 'Module not found' })
  }

  // Fetch user profile for context
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single()

  const weeksLeft = profile?.exam_date
    ? Math.max(1, Math.ceil((new Date(profile.exam_date) - new Date()) / (1000 * 60 * 60 * 24 * 7)))
    : 5

  try {
    const aiResult = await analyzeModuleOverview({
      name:              module.name,
      credits:           module.credits,
      midMark:           module.mid_mark,
      midWeight:         module.mid_weight,
      confidenceRating:  module.confidence_rating,
      overviewText:      module.overview_text,
      targetGrade:       profile?.target_grade || 'A',
      weeksLeft
    })

    // Save AI results back to the module
    const { data: updated, error: updateError } = await supabase
      .from('modules')
      .update({
        topics:             aiResult.topics,
        recommended_hours:  aiResult.recommendedHours
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()

    if (updateError) return res.status(500).json({ error: updateError.message })
    res.json(updated)

  } catch (err) {
    console.error('Gemini error:', err)
    res.status(500).json({ error: 'AI analysis failed. Check your Gemini API key.' })
  }
})

// -----------------------------------------------
// DELETE /api/modules/:id
// -----------------------------------------------
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('modules')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

export default router
