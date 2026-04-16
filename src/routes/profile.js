import express from 'express'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'

const router = express.Router()
router.use(deviceId)

// GET /api/profile — fetch or auto-create
router.get('/', async (req, res) => {
  let { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('device_id', req.deviceId)
    .single()

  if (!data) {
    const { data: created, error } = await supabase
      .from('profiles')
      .insert({ device_id: req.deviceId })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ...created, isNew: true })
  }
  res.json(data)
})

// PATCH /api/profile
router.patch('/', async (req, res) => {
  const allowed = [
    'target_grade','exam_date','setup_complete',
    'sat_s1','sat_s2','sat_s3','sat_s4',
    'sun_s1','sun_s2','sun_s3','sun_s4'
  ]
  const updates = {}
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('device_id', req.deviceId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
