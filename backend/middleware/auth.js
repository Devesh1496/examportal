// middleware/auth.js — Supabase JWT verification
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAuth;
if (supabaseUrl && serviceRoleKey) {
  supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify JWT and attach user to req
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch profile for role
    const { data: profile } = await supabaseAuth
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    req.user = user;
    req.profile = profile;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Check admin role
function requireAdmin(req, res, next) {
  if (!req.profile || req.profile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
