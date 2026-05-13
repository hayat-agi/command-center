const Gateway = require('../models/Gateway');
const Alert = require('../models/Alert');
const mongoose = require('mongoose');
const { getCoordsFromAddress } = require('../utils/geocoder');

const isMongoDBConnected = () => mongoose.connection.readyState === 1;

// Get All Gateways
exports.getGateways = async (req, res) => {
  try {
    if (isMongoDBConnected()) {
      const gateways = await Gateway.find()
        .populate('owner', 'name surname email role')
        .sort({ createdAt: -1 });
      res.status(200).json(gateways);
    }
  } catch (error) {
    console.error('Error fetching gateways:', error);
    res.status(500).json({ message: error.message });
  }
};

// Get User's Gateways
exports.getUserGateways = async (req, res) => {
  try {
    if (isMongoDBConnected()) {
      const gateways = await Gateway.find({ owner: req.user._id }).sort({ createdAt: -1 });
      res.status(200).json(gateways);
    }
  } catch (error) {
    console.error('Error fetching gateways:', error);
    res.status(500).json({ message: error.message });
  }
};

// Create New Gateway
exports.createGateway = async (req, res) => {
  try {
    const { name, serialNumber } = req.body;

    // Accept either nested `address: {...}` or flat top-level fields
    // (the Flutter mobile client sends flat `street`, `district`, `city`,
    // `buildingNumber`, etc. — older shape that predates the nested schema).
    // Map field-name variants here so both clients work.
    const a = req.body.address || {};
    const address = {
      street:       a.street       ?? req.body.street       ?? null,
      buildingNo:   a.buildingNo   ?? req.body.buildingNumber ?? req.body.buildingNo ?? null,
      doorNo:       a.doorNo       ?? req.body.doorNumber   ?? req.body.doorNo     ?? null,
      neighborhood: a.neighborhood ?? req.body.neighborhood ?? null,
      district:     a.district     ?? req.body.district     ?? null,
      province:     a.province     ?? req.body.province     ?? req.body.city       ?? null,
      postalCode:   a.postalCode   ?? req.body.postalCode   ?? null,
    };

    const hasAnyAddress = Object.values(address).some((v) => v != null && String(v).trim() !== '');
    if (!name || !serialNumber || !hasAnyAddress) {
      return res.status(400).json({
        message: 'Cihaz adı, seri numarası ve adres bilgileri zorunludur.'
      });
    }

    // Geocoding: try the most specific query first; if Nominatim doesn't
    // recognise it, progressively drop precision (street → neighborhood →
    // district → province). Many Turkish neighborhoods/streets aren't
    // indexed in OSM, so failing the whole gateway-create over a missing
    // street tile is too strict.
    const trim = (s) => (s == null ? null : String(s).trim() || null);
    const streetFull = trim(address.street)
      ? `${trim(address.street)}${trim(address.buildingNo) ? ' ' + trim(address.buildingNo) : ''}`
      : null;
    const neighborhood = trim(address.neighborhood);
    const district = trim(address.district);
    const province = trim(address.province);

    // Structured queries run before the bare-street POI fallback so a common
    // street name doesn't pin the gateway in the wrong district of the same
    // province.
    const street = trim(address.street);
    const queryLevels = [
      [streetFull, neighborhood, district, province, 'Türkiye'],
      [street, neighborhood, district, province, 'Türkiye'],
      [neighborhood, district, province, 'Türkiye'],
      [district, province, 'Türkiye'],
      [street, province, 'Türkiye'],
      [province, 'Türkiye'],
    ].map((parts) => parts.filter(Boolean).join(', '))
     .filter((q) => q && q !== 'Türkiye');

    let coords = null;
    let geocodedBy = null;
    for (const q of queryLevels) {
      console.log('📍 Konum aranıyor:', q);
      coords = await getCoordsFromAddress(q);
      if (coords) {
        geocodedBy = q;
        break;
      }
    }

    if (!coords) {
      return res.status(400).json({
        message: 'Adres haritada bulunamadı. İlçe ve il bilgisini kontrol ediniz.'
      });
    }
    console.log('✅ Geocoded by:', geocodedBy);

    if (!isMongoDBConnected()) {
      return res.status(503).json({ message: 'Veritabanı bağlantısı yok.' });
    }


    const newGateway = new Gateway({
      owner: req.user._id,
      name,
      serialNumber,

      address: {
        street: address.street,
        buildingNo: address.buildingNo,
        doorNo: address.doorNo,
        neighborhood: address.neighborhood,
        district: address.district,
        province: address.province,
        postalCode: address.postalCode
      },
      location: coords,
      // Truthful default: a freshly-registered gateway is inactive until the
      // physical device sends its first heartbeat. The liveness watcher in
      // server.js flips status to 'active' only when the firmware checks in.
      status: 'inactive',
      battery: 0,
      signal_quality: 'none',
      connected_devices: 0,
      uptime: 0,
      last_seen: null,
    });

    await newGateway.save();

    res.status(201).json({
      message: 'Cihaz başarıyla kaydedildi.',
      gateway: newGateway
    });

  } catch (error) {
    console.error('Error creating gateway:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        message: 'Bu seri numarasına sahip bir cihaz zaten mevcut.'
      });
    }

    res.status(500).json({ message: 'Sunucu hatası' });
  }
};


// Delete Gateway
exports.deleteGateway = async (req, res) => {
  try {
    if (!isMongoDBConnected()) {
      return res.status(503).json({ message: 'Veritabanı bağlantısı yok.' });
    }

    // Admins can delete any gateway (operational override on the
    // /dashboard/gateways management page); regular users can only delete
    // gateways they own.
    const filter = req.user?.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, owner: req.user._id };

    const gateway = await Gateway.findOneAndDelete(filter);

    if (!gateway) {
      return res.status(404).json({
        message: 'Gateway bulunamadı veya silme yetkiniz yok.'
      });
    }

    res.json({ message: 'Gateway silindi.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /gateways/heartbeat — hardware liveness ping from a registered ESP32.
//
// Auth: shared device token via X-Device-Token (see requireDeviceToken
// middleware). Body:
//   serialNumber:    string, MAC-style — must match a registered gateway
//   battery:         0-100, integer percent (required)
//   signal_rssi:     dBm, typical -40 (great) to -110 (dead). Optional.
//   firmware_version: string, optional, useful for fleet visibility
//
// Side effects:
//   - last_seen=now
//   - battery / signal_quality updated
//   - status derived: low_battery if <20%, else active
//
// The liveness watcher (server.js) is what flips active→inactive when no
// heartbeat arrives within HEARTBEAT_TIMEOUT_MS — this endpoint only knows
// "I just saw a device".
exports.heartbeat = async (req, res) => {
  try {
    if (!isMongoDBConnected()) {
      return res.status(503).json({ message: 'Veritabanı bağlantısı yok.' });
    }

    const { serialNumber, battery, signal_rssi, firmware_version } = req.body || {};

    if (!serialNumber || typeof battery !== 'number') {
      return res.status(400).json({
        message: 'serialNumber ve battery (0-100) gerekli.',
      });
    }
    if (battery < 0 || battery > 100) {
      return res.status(400).json({ message: 'battery 0-100 aralığında olmalı.' });
    }

    // Map dBm → categorical signal quality. Thresholds match what the mesh
    // ops literature treats as "usable" / "marginal" for ESP32 LoRa setups.
    let signalQuality = 'none';
    if (typeof signal_rssi === 'number') {
      if (signal_rssi >= -75) signalQuality = 'strong';
      else if (signal_rssi >= -95) signalQuality = 'medium';
      else signalQuality = 'weak';
    }

    const status = battery < 20 ? 'low_battery' : 'active';

    const update = {
      status,
      battery,
      signal_quality: signalQuality,
      last_seen: new Date(),
    };
    if (firmware_version) update.firmware_version = firmware_version;

    const gateway = await Gateway.findOneAndUpdate(
      { serialNumber },
      { $set: update },
      { new: true }
    );

    if (!gateway) {
      return res.status(404).json({
        message: 'Bu seri numarasıyla kayıtlı cihaz yok.',
      });
    }

    res.json({
      ok: true,
      next_heartbeat_in_ms: 30000,
      status: gateway.status,
    });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
};

// PUT /gateways/:id
exports.updateGateway = async (req, res) => {
  try {
    if (!isMongoDBConnected()) {
      return res.status(503).json({ message: 'Veritabanı bağlantısı yok.' });
    }

    const { id } = req.params;
    const { name, address } = req.body;


    const gateway = await Gateway.findOne({ _id: id, owner: req.user._id });

    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı veya güncelleme yetkiniz yok.' });
    }


    if (name) gateway.name = name;


    if (address) {
      gateway.address = {
        city: address.city || gateway.address.city,
        district: address.district || gateway.address.district,
        street: address.street || gateway.address.street,
        buildingNo: address.buildingNo || gateway.address.buildingNo,
      };
      const coords = await getCoordsFromAddress(address);

      if (coords) {
        gateway.location = coords;
      }
    }
    await gateway.save();

    res.status(200).json({
      message: 'Cihaz başarıyla güncellendi.',
      gateway
    });

  } catch (error) {
    console.error('Update gateway error:', error);
    res.status(500).json({ message: 'Güncelleme sırasında sunucu hatası oluştu.' });
  }
};

// GET /gateways/:id/alerts — list alerts for a gateway, owner-scoped, newest first.
exports.listGatewayAlerts = async (req, res) => {
  try {
    if (!isMongoDBConnected()) {
      return res.status(503).json({ message: 'Veritabanı bağlantısı yok.' });
    }

    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const gateway = await Gateway.findOne({ _id: id, owner: req.user._id }).select('_id');
    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı veya yetkiniz yok.' });
    }

    const alerts = await Alert.find({ gateway: gateway._id })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.status(200).json(alerts);
  } catch (error) {
    console.error('List gateway alerts error:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
};

exports.addPersonToGateway = async (req, res) => {
  try {
    const { id } = req.params; // Gateway ID'si URL'den gelir
    const personData = req.body; // Formdan gelen kişi bilgileri

    // 1. Gateway'i bul (Sadece kendi cihazına ekleyebilsin diye owner kontrolü şart)
    const gateway = await Gateway.findOne({ _id: id, owner: req.user._id });

    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı veya yetkiniz yok.' });
    }

    // 2. Kişiyi diziye ekle
    // Not: Mongoose, şemadaki validasyonları (TC, isim zorunluluğu vb.) burada kontrol eder.
    gateway.registered_users.push(personData);

    // 3. Kaydet
    await gateway.save();

    res.status(200).json({
      message: 'Kişi başarıyla eklendi.',
      updatedGateway: gateway
    });

  } catch (error) {
    res.status(400).json({ message: 'Kişi eklenemedi.', error: error.message });
  }
};

// 2. Gateway'den Kişi Sil
exports.removePersonFromGateway = async (req, res) => {
  try {
    const { gatewayId, personId } = req.params;

    const gateway = await Gateway.findOne({ _id: gatewayId, owner: req.user._id });

    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı.' });
    }

    // Subdocument'i silme yöntemi
    gateway.registered_users.pull({ _id: personId });

    await gateway.save();

    res.status(200).json({ message: 'Kişi silindi.', updatedGateway: gateway });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 3. Gateway'e Evcil Hayvan Ekle
exports.addPetToGateway = async (req, res) => {
  try {
    const { id } = req.params;
    const petData = req.body;

    const gateway = await Gateway.findOne({ _id: id, owner: req.user._id });

    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı.' });
    }

    gateway.registered_animals.push(petData);
    await gateway.save();

    res.status(200).json({
      message: 'Evcil hayvan eklendi.',
      updatedGateway: gateway
    });

  } catch (error) {
    res.status(400).json({ message: 'Evcil hayvan eklenemedi.', error: error.message });
  }
};

// Disaster Event — mobil disaster modunda gönderilen olayları kayıt eder.
// Body: { type: 'manual_message' | 'sos' | ..., message?: string, sentAt?: ISO-8601 }
exports.addDisasterEvent = async (req, res) => {
  try {
    if (!isMongoDBConnected()) {
      return res.status(503).json({ message: 'Veritabanı bağlantısı yok.' });
    }

    const { id } = req.params;
    const { type, message, sentAt, lang } = req.body || {};

    if (!type) {
      return res.status(400).json({ message: 'Olay tipi (type) zorunludur.' });
    }

    // Mobile sends BLE MAC or serialNumber as :id (not the Mongo ObjectId).
    // Try ObjectId first, fall back to serialNumber lookup. Mesh-uplink
    // requests have req.user === null (no JWT) — drop the owner constraint,
    // gateway identity is established by the :id param alone.
    const mongoose = require('mongoose');
    const lookup = req.user ? { owner: req.user._id } : {};
    if (mongoose.isValidObjectId(id)) {
      lookup.$or = [{ _id: id }, { serialNumber: id }];
    } else {
      lookup.serialNumber = id;
    }
    const gateway = await Gateway.findOne(lookup);
    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı veya yetkiniz yok.' });
    }

    const trimmedMessage = typeof message === 'string' ? message.trim() : null;

    // Delivery-path headers set by the gateway uplink firmware. Phone-direct
    // POSTs don't set these → source falls back to 'direct'.
    const sourceHeader = (req.get('X-Source') || '').toLowerCase();
    const source = sourceHeader === 'mesh-uplink' || sourceHeader === 'mesh'
      ? 'mesh'
      : 'direct';

    const meshHopsHeader = req.get('X-Mesh-Hops');
    const meshHops = meshHopsHeader != null && meshHopsHeader !== ''
      ? parseInt(meshHopsHeader, 10)
      : null;
    const meshMsgId = req.get('X-Mesh-MsgId') || null;

    // Defensive dedup against firmware double-uplinks: if the same mesh
    // packet (matching X-Mesh-MsgId) hit us within the last 30s, return
    // the existing alert instead of creating a second one.
    if (source === 'mesh' && meshMsgId) {
      const recent = await Alert.findOne({
        meshMsgId,
        createdAt: { $gte: new Date(Date.now() - 30_000) },
      }).lean();
      if (recent) {
        return res.status(200).json({
          message: 'Duplicate mesh uplink ignored.',
          alert: recent,
        });
      }
    }

    const alert = await Alert.create({
      device_id: gateway.serialNumber,
      gateway: gateway._id,
      type,
      battery: gateway.battery,
      signal_quality: gateway.signal_quality,
      location: gateway.location,

      // First-class fields the fusion classifier reads directly.
      text: trimmedMessage || null,
      lang: lang || 'tr',
      source_user: req.user ? req.user._id : null,

      source,
      meshHops:    Number.isFinite(meshHops) ? meshHops : null,
      meshSrcAddr: req.get('X-Mesh-Src') || null,
      meshMsgId,

      // Legacy payload kept so existing readers don't break; will be
      // dropped once all consumers move to top-level fields.
      payload: {
        message: trimmedMessage || null,
        sentAt: sentAt || new Date().toISOString(),
      },
    });

    res.status(201).json({ message: 'Olay kaydedildi.', alert });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    console.error('Error creating disaster event:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
};

// 4. Gateway'den Evcil Hayvan Sil
exports.removePetFromGateway = async (req, res) => {
  try {
    const { gatewayId, petId } = req.params;

    const gateway = await Gateway.findOne({ _id: gatewayId, owner: req.user._id });

    if (!gateway) {
      return res.status(404).json({ message: 'Cihaz bulunamadı.' });
    }

    gateway.registered_animals.pull({ _id: petId });
    await gateway.save();

    res.status(200).json({ message: 'Evcil hayvan silindi.', updatedGateway: gateway });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};