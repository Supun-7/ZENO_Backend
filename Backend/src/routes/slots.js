import express from 'express'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'

const router = express.Router()
router.use(deviceId)

const VALID_KEYS = ['M1','M2','E1','E2','E3','N1']

router.get('/', async (req, res) => {
  const { date } = req.query
  if (!date) return res.status(400).json({ error: 'date required' })

  const { data, error } = await supabase
    .from('slots')
    .select(`*, module:modules(id,name,color), session:sessions(id,efficiency_score,efficiency_label,feedback,tip,summary)`)
    .eq('device_id', req.deviceId)
    .eq('date', date)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.get('/week', async (req, res) => {
  const { startDate } = req.query
  if (!startDate) return res.status(400).json({ error: 'startDate required' })
  const end = new Date(startDate)
  end.setDate(end.getDate() + 6)
  const endDate = end.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('slots')
    .select(`*, module:modules(id,name,color), session:sessions(id,efficiency_score,efficiency_label)`)
    .eq('device_id', req.deviceId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date').order('slot_key')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { date, slotKey, moduleId } = req.body
  if (!date || !slotKey || !moduleId) return res.status(400).json({ error: 'date, slotKey, moduleId required' })
  if (!VALID_KEYS.includes(slotKey)) return res.status(400).json({ error: 'Invalid slotKey' })

  const { data: existing } = await supabase
    .from('slots')
    .select('status')
    .eq('device_id', req.deviceId)
    .eq('date', date)
    .eq('slot_key', slotKey)
    .single()

  if (existing && existing.status !== 'pending') {
    return res.status(400).json({ error: 'Cannot reassign a completed or missed slot' })
  }

  const { data, error } = await supabase
    .from('slots')
    .upsert({ device_id: req.deviceId, date, slot_key: slotKey, module_id: moduleId, status: 'pending' }, { onConflict: 'device_id,date,slot_key' })
    .select(`*, module:modules(id,name,color)`)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.patch('/:id/miss', async (req, res) => {
  const { data: slot } = await supabase
    .from('slots').select('status').eq('id', req.params.id).eq('device_id', req.deviceId).single()

  if (!slot) return res.status(404).json({ error: 'Slot not found' })
  if (slot.status !== 'pending') return res.status(400).json({ error: 'Already completed or missed' })

  const { data, error } = await supabase
    .from('slots').update({ status: 'missed' }).eq('id', req.params.id).eq('device_id', req.deviceId).select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
