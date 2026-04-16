export default function deviceId(req, res, next) {
  const id = req.headers['x-device-id']
  if (!id || id.trim().length < 8) {
    return res.status(400).json({ error: 'Missing or invalid x-device-id header' })
  }
  req.deviceId = id.trim()
  next()
}
