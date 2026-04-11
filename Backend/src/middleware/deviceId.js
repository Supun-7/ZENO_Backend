// Instead of JWT auth, every request carries a device_id header.
// This is the unique ID generated on first app launch, stored in localStorage.
// It's not "secure" in a multi-user sense — but for a personal app
// used by one person on one device, it's perfectly fine.

export default function deviceId(req, res, next) {
  const id = req.headers['x-device-id']
  if (!id || id.trim().length < 10) {
    return res.status(400).json({ error: 'Missing x-device-id header' })
  }
  req.deviceId = id.trim()
  next()
}
