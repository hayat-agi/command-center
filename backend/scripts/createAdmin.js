const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
// .env dosyasını bir üst klasörden bul
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const User = require('../models/User');

async function run() {
    // 1. Bağlantı Kontrolü
    if (!process.env.MONGO_URI) {
        console.error('❌ MONGO_URI bulunamadı! .env dosyanı kontrol et.');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB bağlantısı kuruldu.');
    } catch (err) {
        console.error('❌ Bağlantı hatası:', err.message);
        process.exit(1);
    }

    // 2. Admin Kontrolü
    const email = 'admin@hayatagi.com';
    const exists = await User.findOne({ email });

    if (exists) {
        console.log('⚠️  Admin zaten mevcut. İşlem yapılmadı.');
        process.exit(0);
    }

    // 3. Şifre — env'den al veya rastgele üret. ASLA hardcoded değer.
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const generated = !process.env.ADMIN_PASSWORD;

    const admin = new User({
        name: 'Sistem',
        surname: 'Yöneticisi',
        email: email,
        password, // Modeldeki pre-save bunu otomatik hashleyecek
        role: 'admin'
    });

    try {
        await admin.save();
        console.log('🎉 Admin başarıyla oluşturuldu:', email);
        if (generated) {
            console.log('');
            console.log('   🔑  ADMIN ŞİFRESİ (sadece şimdi gösteriliyor, kaydet!):');
            console.log('   ' + password);
            console.log('');
            console.log('   Sonraki çalıştırmalarda bu komut zaten admin var diye atlanır.');
            console.log('   Şifreyi değiştirmek için DB\'yi temizleyip ADMIN_PASSWORD env ile çalıştır.');
        }
    } catch (error) {
        console.error('❌ Admin oluşturma hatası:', error.message);
    }

    process.exit(0);
}

run();