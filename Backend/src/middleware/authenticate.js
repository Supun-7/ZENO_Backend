import jwt from 'jsonwebtoken'

// This middleware runs BEFORE any protected route handler.
// It checks the Authorization header, verifies the JWT,
// and attaches the user id to req.user so route handlers
// know who is making the request.

export default function authenticate(req, res, next) {
  // JWT is sent as: Authorization: Bearer <token>
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    // Attach user info to the request object
    // Every route handler after this can access req.user.id
    req.user = { id: decoded.userId, email: decoded.email }
    next() // pass control to the actual route handler
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
