import express from 'express'
import supabase from '../services/supabase.js'
import deviceId from '../middleware/deviceId.js'

const router = express.Router()
router.use(deviceId)

// GET /api/profile — fetch or create profile for this device
router.get('/', async (req, res) => {
  let { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('device_id', req.deviceId)
    .single()

  // First time — create the profile
  if (error || !data) {
    const { data: created, error: createError } = await supabase
      .from('profiles')
      .insert({ device_id: req.deviceId })
      .select()
      .single()

    if (createError) return res.status(500).json({ error: createError.message })
    return res.json({ ...created, isNew: true })
  }

  res.json(data)
})

// PATCH /api/profile — update settings
router.patch('/', async (req, res) => {
  const { wakeHour, targetGrade, examDate } = req.body
  const updates = {}
  if (wakeHour !== undefined)    updates.wake_hour     = wakeHour
  if (targetGrade !== undefined) updates.target_grade  = targetGrade
  if (examDate !== undefined)    updates.exam_date     = examDate

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
