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

// Admin kontrolü
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Bu işlem için admin yetkisi gereklidir.' });
  }
};

module.exports = { protect, adminOnly };