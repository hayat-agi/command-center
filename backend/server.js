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

// CORS ayarları — origin from env so docker / prod can override
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});