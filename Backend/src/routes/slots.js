import express from 'express'
import { format } from 'date-fns'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'

const router = express.Router()
router.use(deviceId)

// GET /api/slots?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  const date = req.query.date || format(new Date(), 'yyyy-MM-dd')

  const { data, error } = await supabase
    .from('slots')
    .select(`
      *,
      module:modules(id, name, color),
      session:sessions(id, efficiency_score, efficiency_label, feedback, tip, summary)
    `)
    .eq('device_id', req.deviceId)
    .eq('date', date)
    .order('slot_key')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// PATCH /api/slots/:id/miss
router.patch('/:id/miss', async (req, res) => {
  const { data: slot } = await supabase
    .from('slots').select('status').eq('id', req.params.id).eq('device_id', req.deviceId).single()

  if (!slot)                    return res.status(404).json({ error: 'Slot not found' })
  if (slot.status !== 'pending') return res.status(400).json({ error: 'Slot is not pending' })

  const { data, error } = await supabase
    .from('slots').update({ status: 'missed' })
    .eq('id', req.params.id).eq('device_id', req.deviceId)
    .select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
