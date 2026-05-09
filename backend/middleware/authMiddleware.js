const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  // 1. Header'da "Authorization: Bearer <token>" var mı bak
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // 2. Token'ı al (Bearer kelimesini at)
      token = req.headers.authorization.split(' ')[1];

      // 3. Token'ı çöz (Verify) — algoritmayı pin'liyoruz ki "alg: none" kabul etmesin
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

      // 4. Token içindeki ID'den kullanıcıyı bul ve req.user'a ata
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        // DB bağlı değilse rolü doğrulayamıyoruz — token claim'ine güvenmek
        // privilege escalation riski. Fail-closed.
        return res.status(503).json({ message: 'Servis geçici olarak kullanılamıyor (DB).' });
      }

      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ message: 'Kullanıcı bulunamadı.' });
      }

      next(); // Tamamdır, sıradaki fonksiyona (me controller'ına) geç
    } catch (error) {
      console.error('Token doğrulama hatası:', error);
      res.status(401).json({ message: 'Yetkisiz işlem, token geçersiz.' });
    }
  } else {
    res.status(401).json({ message: 'Token bulunamadı, giriş yapmalısınız.' });
  }
};

// Mesh-uplink bypass: gateway firmware (Node B) doesn't carry a JWT.
// When the request advertises X-Source: mesh-uplink we skip auth and let
// the controller handle the unauthenticated case (req.user === null).
//
// SECURITY: this is currently shared-network-trust only. Anyone reachable
// at the backend can claim mesh-uplink. Add a shared-secret check
// (X-Mesh-Token vs FUSION-style env var) before exposing this beyond LAN.
// Mount this middleware ONLY on routes that explicitly support uplink —
// never as a global app-level guard.
const protectOrMeshUplink = async (req, res, next) => {
  if ((req.headers['x-source'] || '').toLowerCase() === 'mesh-uplink') {
    req.user = null;
    return next();
  }
  return protect(req, res, next);
};

// Admin kontrolü
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Bu işlem için admin yetkisi gereklidir.' });
  }
};

// Device-token auth for hardware-originated requests (gateway heartbeats,
// firmware updates, etc). The shared secret is provisioned out-of-band into
// each device. Compared with JWT this is simpler and survives the device
// having no user identity.
//
// SECURITY: this is shared-secret bearer auth. Rotate via env when a device
// is decommissioned. If the env var is unset we fail open in dev only —
// production must set GATEWAY_HEARTBEAT_TOKEN.
const requireDeviceToken = (req, res, next) => {
  const expected = process.env.GATEWAY_HEARTBEAT_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[auth] GATEWAY_HEARTBEAT_TOKEN unset in production — refusing.');
      return res.status(503).json({ message: 'Heartbeat servisi yapılandırılmadı.' });
    }
    // dev mode: warn once and pass through
    if (!requireDeviceToken._warned) {
      console.warn('[auth] GATEWAY_HEARTBEAT_TOKEN unset — heartbeat endpoint open (dev mode).');
      requireDeviceToken._warned = true;
    }
    return next();
  }
  const got = req.headers['x-device-token'];
  if (!got || got !== expected) {
    return res.status(401).json({ message: 'Geçersiz cihaz tokeni.' });
  }
  next();
};

module.exports = { protect, adminOnly, protectOrMeshUplink, requireDeviceToken };