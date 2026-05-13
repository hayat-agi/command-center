const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const gatewayRoutes = require('./routes/gatewayRoutes');
const userRoutes = require('./routes/userRoutes');
const issueRoutes = require('./routes/issueRoutes');
const metadataRoutes = require('./routes/metadataRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const connectDB = require('./config/db');
const path = require('path');

// .env dosyasının yolunu garantiye alıyoruz
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Fail-fast on missing or weak security-critical env vars.
const { validateEnv } = require('./config/validateEnv');
validateEnv();

const app = express();

// MongoDB bağlantısını başlat
connectDB();

// CORS ayarları — FRONTEND_URL accepts a comma-separated list so both local
// dev and the public domain can call the API from the browser.
// Example: FRONTEND_URL=http://localhost:5173,https://hayatagi.duckdns.org
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Token', 'X-Source', 'X-Mesh-Hops', 'X-Mesh-MsgId']
}));

app.use(express.json());

// Lightweight request logger — every HTTP request logs method + URL + status + timing.
// No dep on morgan; flips off via DISABLE_REQ_LOG=1.
if (process.env.DISABLE_REQ_LOG !== '1') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const dur = Date.now() - start;
      const ip = req.ip || req.socket.remoteAddress || '?';
      console.log(`[req] ${req.method} ${req.originalUrl} ${res.statusCode} ${dur}ms ip=${ip}`);
    });
    next();
  });
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);

app.use('/api/gateways', gatewayRoutes);
app.use('/api/users', userRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/api/admin/incidents', incidentRoutes);

// Liveness watcher: any gateway whose last_seen is older than the timeout
// (or never seen at all) gets flipped to status:inactive. The heartbeat
// endpoint is the only thing that pushes status back to active/low_battery.
//
// Tunables via env:
//   HEARTBEAT_TIMEOUT_MS   default 90000  — staleness threshold
//   HEARTBEAT_CHECK_MS     default 30000  — how often we sweep
const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_MS, 10) || 90 * 1000;
const HEARTBEAT_CHECK_MS = parseInt(process.env.HEARTBEAT_CHECK_MS, 10) || 30 * 1000;

const startLivenessWatcher = () => {
  const Gateway = require('./models/Gateway');
  const mongoose = require('mongoose');
  setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
      const result = await Gateway.updateMany(
        {
          status: { $ne: 'inactive' },
          $or: [{ last_seen: { $lt: cutoff } }, { last_seen: null }],
        },
        { $set: { status: 'inactive' } }
      );
      if (result.modifiedCount > 0) {
        console.log(`[liveness] flipped ${result.modifiedCount} gateway(s) to inactive (stale > ${HEARTBEAT_TIMEOUT_MS}ms)`);
      }
    } catch (err) {
      console.error('[liveness] watcher error:', err.message);
    }
  }, HEARTBEAT_CHECK_MS);
  console.log(`[liveness] watcher armed: timeout=${HEARTBEAT_TIMEOUT_MS}ms, sweep=${HEARTBEAT_CHECK_MS}ms`);
};

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startLivenessWatcher();
});