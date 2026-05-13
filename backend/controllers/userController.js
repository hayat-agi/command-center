const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const { GENDER_LABELS } = require('../utils/constants');

const isMongoDBConnected = () => mongoose.connection.readyState === 1;

function normalizeGender(value) {
  if (!value) return value;
  if (Object.prototype.hasOwnProperty.call(GENDER_LABELS, value)) return value;

  const normalized = String(value).trim().toLocaleLowerCase('tr-TR');
  const entry = Object.entries(GENDER_LABELS).find(([, label]) =>
    String(label).trim().toLocaleLowerCase('tr-TR') === normalized
  );

  return entry ? entry[0] : value;
}

// POST /api/users/register
async function register(req, res, next) {
  try {
    const { name, surname, tcNumber, email, password } = req.body;
    const normalizedEmail = (email || '').toLowerCase();

    if (!name || !surname || !email || !password || !tcNumber) {
      return res.status(400).json({ message: 'Ad, soyad, e-posta, şifre ve TC Kimlik zorunludur' });
    }

    if (!isMongoDBConnected()) {
      return res.status(503).json({
        message: 'Veritabanı bağlantısı yok. Kayıt işlemi şu anda kullanılamıyor.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Şifre en az 6 karakter olmalıdır.' });
    }

    const existsEmail = await User.findOne({ email: normalizedEmail });
    if (existsEmail) {
      return res.status(400).json({ message: 'Email kayıtlı.' });
    }

    const existsTC = await User.findOne({ tcNumber });
    if (existsTC) {
      return res.status(400).json({ message: 'TC Kimlik Numarası zaten kayıtlı.' });
    }

    // Do not hash here — the model's pre-save hook will hash the password.
    const user = await User.create({
      name,
      surname,
      tcNumber,
      email: normalizedEmail,
      password
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      surname: user.surname,
      email: user.email,
      role: user.role
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/users/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!isMongoDBConnected()) {
      return res.status(503).json({
        message: 'Veritabanı bağlantısı yok. Giriş işlemi şu anda kullanılamıyor.'
      });
    }

    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );
    res.json({ token, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/myProfile
async function me(req, res, next) {
  {
    try {
      const user = await User.findById(req.user._id).select('-password');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json(user);
    } catch (err) {
      next(err);
    }
  }
}

// PUT /api/users/profile - Profil bilgilerini güncelle
async function updateProfile(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    }
    const allowedUpdates = ['phoneNumber', 'bloodType',
      'birthDate', 'gender', 'medicalConditions',
      'medications', 'prosthetics'];

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        user[field] = field === 'gender'
          ? normalizeGender(req.body[field])
          : req.body[field];
      }
    });

    if (req.body.emergencyContact) {
      user.emergencyContact = {
        // Mevcut verileri koru, yenileri üzerine yaz (Merge mantığı)
        fullname: req.body.emergencyContact.fullname || user.emergencyContact.fullname,
        phone: req.body.emergencyContact.phone || user.emergencyContact.phone,
        relation: req.body.emergencyContact.relation || user.emergencyContact.relation
      };
    }

    const updatedUser = await user.save();
    res.json({
      success: true,
      message: 'Profil başarıyla güncellendi.',
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        surname: updatedUser.surname,
        email: updatedUser.email,
        role: updatedUser.role,
        // Diğer alanları tek tek yazmana gerek yok, frontend ihtiyacına göre dönersin
        // veya tüm güncel objeyi dönebilirsin (password hariç):
        ...updatedUser.toObject()
      }
    });

  } catch (err) {
    // Validasyon hatalarını (örn: geçersiz enum) yakalamak için
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

module.exports = { register, login, me, updateProfile };
