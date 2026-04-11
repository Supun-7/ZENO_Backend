import express from 'express'
import supabase from '../services/supabase.js'
import authenticate from '../middleware/authenticate.js'

const router = express.Router()
router.use(authenticate)

// Valid slot keys matching the fixed schedule
const VALID_SLOT_KEYS = ['M1', 'M2', 'E1', 'E2', 'E3', 'N1']

// -----------------------------------------------
// GET /api/slots?date=2025-01-15
// Get all slots for a specific date
// -----------------------------------------------
router.get('/', async (req, res) => {
  const { date } = req.query

  if (!date) return res.status(400).json({ error: 'date query param required' })

  const { data, error } = await supabase
    .from('slots')
    .select(`
      *,
      module:modules(id, name, color)
    `)
    .eq('user_id', req.user.id)
    .eq('date', date)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// -----------------------------------------------
// GET /api/slots/week?startDate=2025-01-13
// Get all slots for a week
// -----------------------------------------------
router.get('/week', async (req, res) => {
  const { startDate } = req.query
  if (!startDate) return res.status(400).json({ error: 'startDate required' })

  // Calculate end of week (7 days from start)
  const start = new Date(startDate)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const endDate = end.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('slots')
    .select(`
      *,
      module:modules(id, name, color),
      session:sessions(id, efficiency_score, efficiency_label)
    `)
    .eq('user_id', req.user.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')
    .order('slot_key')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// -----------------------------------------------
// POST /api/slots
// Assign a module to a slot
// Body: { date, slotKey, moduleId }
// -----------------------------------------------
router.post('/', async (req, res) => {
  const { date, slotKey, moduleId } = req.body

  if (!date || !slotKey || !moduleId) {
    return res.status(400).json({ error: 'date, slotKey and moduleId required' })
  }

  if (!VALID_SLOT_KEYS.includes(slotKey)) {
    return res.status(400).json({ error: `slotKey must be one of: ${VALID_SLOT_KEYS.join(', ')}` })
  }

  // Verify module belongs to user
  const { data: module } = await supabase
    .from('modules')
    .select('id')
    .eq('id', moduleId)
    .eq('user_id', req.user.id)
    .single()

  if (!module) return res.status(404).json({ error: 'Module not found' })

  // upsert - if slot exists update it, if not create it
  // But only allow changing if status is still 'pending'
  const { data: existing } = await supabase
    .from('slots')
    .select('status')
    .eq('user_id', req.user.id)
    .eq('date', date)
    .eq('slot_key', slotKey)
    .single()

  if (existing && existing.status !== 'pending') {
    return res.status(400).json({ error: 'Cannot reassign a completed or missed slot' })
  }

  const { data, error } = await supabase
    .from('slots')
    .upsert({
      user_id:   req.user.id,
      date,
      slot_key:  slotKey,
      module_id: moduleId,
      status:    'pending'
    }, { onConflict: 'user_id,date,slot_key' })
    .select(`*, module:modules(id, name, color)`)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// -----------------------------------------------
// PATCH /api/slots/:id/miss
// Mark a slot as missed (called automatically for
// past slots that were never completed)
// -----------------------------------------------
router.patch('/:id/miss', async (req, res) => {
  const { data: slot } = await supabase
    .from('slots')
    .select('status')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!slot) return res.status(404).json({ error: 'Slot not found' })
  if (slot.status !== 'pending') {
    return res.status(400).json({ error: 'Slot is already completed or missed' })
  }

  const { data, error } = await supabase
    .from('slots')
    .update({ status: 'missed' })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
