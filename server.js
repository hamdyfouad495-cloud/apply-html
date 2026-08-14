require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const prisma = new PrismaClient();

// ─── Security Middleware ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
      frameSrc: ["'self'", "https://challenges.cloudflare.com"],
      connectSrc: ["'self'", "https://discord.com"],
      imgSrc: ["'self'", "https://cdn.discordapp.com", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.get('/apply.html', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'public', 'apply.html');
    let html = fs.readFileSync(filePath, 'utf8');

    html = html.replace(
      /data-sitekey="TURNSTILE_SITE_KEY"/g,
      `data-sitekey="${process.env.TURNSTILE_SITE_KEY || ''}"`
    );

    res.type('html').send(html);
  } catch (error) {
    console.error('Failed to load apply.html:', error);
    res.status(500).send('Failed to load application page.');
  }
});
app.use(express.static('public'));

// ─── Session ───
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  name: 'das.session',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// ─── Passport Discord OAuth2 ───
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'email'],
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    let user = await prisma.user.findUnique({
      where: { discordId: profile.id }
    });

    const userData = {
      username: profile.username,
      discriminator: profile.discriminator || '0',
      avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
      email: profile.email || null
    };

    if (!user) {
      user = await prisma.user.create({
        data: { discordId: profile.id, ...userData }
      });
    } else {
      user = await prisma.user.update({
        where: { discordId: profile.id },
        data: userData
      });
    }

    const adminRole = await prisma.adminRole.findUnique({
      where: { userId: user.id }
    });

    const superAdminIds = process.env.ADMIN_DISCORD_IDS ? process.env.ADMIN_DISCORD_IDS.split(',').map(id => id.trim()) : [];
    const isAdmin = adminRole !== null || superAdminIds.includes(profile.id);
    const role = adminRole ? adminRole.role : (superAdminIds.includes(profile.id) ? 'superadmin' : null);

    done(null, { 
      id: user.id, 
      discordId: user.discordId, 
      username: user.username, 
      avatar: user.avatar,
      isAdmin, 
      role 
    });
  } catch (error) {
    done(error, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return done(null, false);

    const adminRole = await prisma.adminRole.findUnique({ where: { userId: id } });
    const superAdminIds = process.env.ADMIN_DISCORD_IDS ? process.env.ADMIN_DISCORD_IDS.split(',').map(id => id.trim()) : [];
    const isAdmin = adminRole !== null || superAdminIds.includes(user.discordId);
    const role = adminRole ? adminRole.role : (superAdminIds.includes(user.discordId) ? 'superadmin' : null);

    done(null, { 
      id: user.id, 
      discordId: user.discordId, 
      username: user.username, 
      avatar: user.avatar,
      isAdmin, 
      role 
    });
  } catch (error) {
    done(error, null);
  }
});

app.use(passport.initialize());
app.use(passport.session());

// ─── CSRF Protection ───
const csrfProtection = csrf({ cookie: { signed: true, httpOnly: true } });

// ─── Rate Limiting ───
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You can only submit 3 applications per hour.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

app.use('/api/', apiLimiter);

// ─── Auth Middleware ───
function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    if (!roles.includes(req.user.role) && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}

// ─── Turnstile Verification ───
async function verifyTurnstile(token) {
  if (!token) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ''
      })
    });
    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return false;
  }
}

// ─── Discord Webhook Helper ───
async function sendDiscordWebhook(payload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn('Webhook failed:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// CSRF Token
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ─── Auth Routes ───
app.get('/api/auth/discord', loginLimiter, passport.authenticate('discord'));

app.get('/api/auth/discord/callback',
  loginLimiter,
  passport.authenticate('discord', { failureRedirect: '/admin.html?error=auth_failed' }),
  (req, res) => {
    res.redirect('/admin.html');
  }
);

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    id: req.user.id,
    discordId: req.user.discordId,
    username: req.user.username,
    avatar: req.user.avatar,
    isAdmin: req.user.isAdmin,
    role: req.user.role
  });
});

// ─── Application Routes ───
app.post('/api/apply', applyLimiter, csrfProtection, async (req, res) => {
  try {
    const { name, age, discordName, discordID, country, hours, experience, turnstileToken, _csrf } = req.body;

    // Verify Turnstile
    if (!turnstileToken || !(await verifyTurnstile(turnstileToken))) {
      return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
    }

    // Validation
    const errors = [];
    if (!name || name.length < 3 || name.length > 40) errors.push('Name must be 3-40 characters');
    if (!age || isNaN(age) || age < 8 || age > 99) errors.push('Age must be between 8 and 99');
    if (!discordName || discordName.length < 2 || discordName.length > 32) errors.push('Discord username is invalid');
    if (!discordID || !/^\d{15,20}$/.test(discordID)) errors.push('Discord ID must be 15-20 digits');
    if (!country || country.length < 2 || country.length > 40) errors.push('Country is required');
    if (!hours || isNaN(hours) || hours < 0 || hours > 24) errors.push('Hours must be between 0 and 24');
    if (!experience || experience.length < 10 || experience.length > 1000) errors.push('Experience must be 10-1000 characters');

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // Check if already applied
    const existing = await prisma.application.findFirst({
      where: { discordId: discordID }
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'You have already submitted an application with this Discord ID.',
        status: existing.status,
        id: existing.id,
        submittedAt: existing.submittedAt
      });
    }

    const application = await prisma.application.create({
      data: {
        discordId: discordID,
        name: name.trim(),
        age: parseInt(age),
        discordName: discordName.trim(),
        country: country.trim(),
        hours: parseInt(hours),
        experience: experience.trim(),
        status: 'pending'
      }
    });

    // Send Discord webhook
    await sendDiscordWebhook({
      content: `📥 **New Application** from \`${discordName}\` (ID: ${discordID})`,
      embeds: [{
        title: 'New Join Request',
        color: 0xe8b94d,
        fields: [
          { name: 'Name', value: name, inline: true },
          { name: 'Age', value: String(age), inline: true },
          { name: 'Country', value: country, inline: true },
          { name: 'Hours/Day', value: String(hours), inline: true },
          { name: 'Discord', value: discordName, inline: false },
          { name: 'Discord ID', value: discordID, inline: false },
          { name: 'Experience', value: experience.slice(0, 1024), inline: false }
        ],
        footer: { text: 'Status: Pending Review ⏳' },
        timestamp: new Date().toISOString()
      }]
    });

    res.json({ success: true, id: application.id, message: 'Application submitted successfully!' });
  } catch (error) {
    console.error('Apply error:', error);
    res.status(500).json({ error: 'Internal server error. Please try again later.' });
  }
});

// Get application status (protected)
app.get('/api/applications/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { discordId } = req.query;

    const application = await prisma.application.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ error: 'Application not found' });

    // Admin can see everything
    if (req.isAuthenticated && req.isAuthenticated() && req.user.isAdmin) {
      return res.json(application);
    }

    // Owner can see limited data
    if (discordId && application.discordId === discordId) {
      return res.json({
        id: application.id,
        status: application.status,
        name: application.name,
        submittedAt: application.submittedAt,
        reviewedAt: application.reviewedAt
      });
    }

    res.status(403).json({ error: 'Forbidden. You do not have permission to view this application.' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check by Discord ID (for status banner)
app.get('/api/applications/discord/:discordId/status', async (req, res) => {
  try {
    const { discordId } = req.params;

    if (!/^\d{15,20}$/.test(discordId)) {
      return res.status(400).json({ error: 'Invalid Discord ID format' });
    }

    const application = await prisma.application.findFirst({
      where: { discordId },
      orderBy: { submittedAt: 'desc' }
    });

    if (!application) return res.status(404).json({ error: 'No application found' });

    res.json({
      id: application.id,
      status: application.status,
      name: application.name,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin Routes ───
app.get('/api/applications', requireAdmin, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status && status !== 'all') where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { discordName: { contains: search, mode: 'insensitive' } },
        { discordId: { contains: search } },
        { country: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.application.count({ where })
    ]);

    res.json({ applications, total, pages: Math.ceil(total / parseInt(limit)), currentPage: parseInt(page) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/applications/:id', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const application = await prisma.application.update({
      where: { id },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedBy: req.user.discordId
      }
    });

    // Send status update webhook
    const statusLabels = { pending: '⏳ Pending', accepted: '✅ Accepted', rejected: '❌ Rejected' };
    const statusColors = { pending: 0xe8b94d, accepted: 0x2fa968, rejected: 0xe5626b };

    await sendDiscordWebhook({
      content: `**Status Update** for \`${application.discordName}\`: ${statusLabels[status]}`,
      embeds: [{
        title: 'Application Status Updated',
        color: statusColors[status],
        fields: [
          { name: 'Name', value: application.name, inline: true },
          { name: 'New Status', value: statusLabels[status], inline: true },
          { name: 'Reviewed By', value: req.user.username, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    });

    res.json(application);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const [total, pending, accepted, rejected] = await Promise.all([
      prisma.application.count(),
      prisma.application.count({ where: { status: 'pending' } }),
      prisma.application.count({ where: { status: 'accepted' } }),
      prisma.application.count({ where: { status: 'rejected' } })
    ]);

    res.json({ total, pending, accepted, rejected });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export CSV
app.get('/api/export', requireAdmin, async (req, res) => {
  try {
    const applications = await prisma.application.findMany({
      orderBy: { submittedAt: 'desc' }
    });

    const headers = ['Status', 'Name', 'Age', 'Discord Name', 'Discord ID', 'Country', 'Hours/Day', 'Experience', 'Submitted At', 'Reviewed At', 'Reviewed By'];
    const statusMap = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' };

    const rows = applications.map(app => [
      statusMap[app.status] || app.status,
      app.name,
      app.age,
      app.discordName,
      app.discordId,
      app.country,
      app.hours,
      (app.experience || '').replace(/"/g, '""').replace(/\n/g, ' '),
      app.submittedAt ? new Date(app.submittedAt).toLocaleString('en-US') : '',
      app.reviewedAt ? new Date(app.reviewedAt).toLocaleString('en-US') : '',
      app.reviewedBy || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin Role Management (Superadmin only) ───
app.get('/api/admin/roles', requireRole('superadmin'), async (req, res) => {
  try {
    const roles = await prisma.adminRole.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/roles', requireRole('superadmin'), csrfProtection, async (req, res) => {
  try {
    const { discordId, role } = req.body;

    if (!discordId || !/^\d{15,20}$/.test(discordId)) {
      return res.status(400).json({ error: 'Valid Discord ID is required' });
    }

    if (!['admin', 'moderator'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or moderator' });
    }

    const user = await prisma.user.findUnique({ where: { discordId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found. They must login first.' });
    }

    const adminRole = await prisma.adminRole.upsert({
      where: { userId: user.id },
      update: { role },
      create: { userId: user.id, role }
    });

    res.json({ success: true, adminRole });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/roles/:id', requireRole('superadmin'), csrfProtection, async (req, res) => {
  try {
    await prisma.adminRole.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── 404 Fallback ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '404.html'));
});

// ─── Error Handler ───
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token. Please refresh the page.' });
  }
  res.status(500).json({ error: 'Something went wrong!' });
});

// ─── Start Server ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  Discord Application System v2.0                         ║`);
  console.log(`║  Server running on http://localhost:${PORT}                    ║`);
  console.log(`║  Admin Panel: http://localhost:${PORT}/admin.html              ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(`\n📋 Setup Checklist:`);
  console.log(`   1. Copy .env.example to .env and fill values`);
  console.log(`   2. Run: npx prisma db push`);
  console.log(`   3. Run: npm start`);
  console.log(`   4. Add your Discord ID to ADMIN_DISCORD_IDS in .env\n`);
});
