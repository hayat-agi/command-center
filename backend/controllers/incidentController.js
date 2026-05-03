const axios = require('axios');
const mongoose = require('mongoose');
const Alert = require('../models/Alert');

const AI_FUSION_URL = process.env.AI_FUSION_URL || 'http://localhost:8000';
const PROXY_TIMEOUT_MS = 5000;

// GET /api/admin/incidents?status_filter=open
//
// Pass-through proxy to the AI fusion service. The fusion service holds
// incidents in process memory (no Mongo) — see hayat-agi/ai
// hayat-agi-fusion/app/store.py — so we can't query them locally.
exports.listIncidents = async (req, res) => {
  try {
    const upstream = await axios.get(`${AI_FUSION_URL}/incidents`, {
      params: req.query,
      timeout: PROXY_TIMEOUT_MS,
    });
    res.status(upstream.status).json(upstream.data);
  } catch (err) {
    const status = err.response?.status ?? 502;
    res.status(status === 502 || status >= 500 ? 502 : status).json({
      message: 'AI fusion service unreachable',
      detail: err.response?.data ?? err.message,
    });
  }
};

// GET /api/admin/incidents/:id/messages
//
// Returns the original Alert documents that were folded into this incident.
// The fusion service tracks event_ids[] per incident; the forwarder uses
// Alert._id as the message_id when calling /ingest, so those event_ids
// look up directly against Mongo Alerts.
exports.getIncidentMessages = async (req, res) => {
  const { id } = req.params;
  try {
    const upstream = await axios.get(`${AI_FUSION_URL}/incidents/${id}`, {
      timeout: PROXY_TIMEOUT_MS,
    });
    const eventIds = upstream.data?.event_ids || [];
    if (eventIds.length === 0) return res.json({ messages: [] });

    // Filter to valid ObjectIds — anything else is a forwarder synthetic id
    // and won't exist in Mongo.
    const objectIds = eventIds
      .filter((s) => mongoose.isValidObjectId(s))
      .map((s) => new mongoose.Types.ObjectId(s));

    const alerts = await Alert.find({ _id: { $in: objectIds } })
      .populate('source_user', 'name surname')
      .populate('gateway', 'name serialNumber')
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      messages: alerts.map((a) => ({
        id: String(a._id),
        text: a.text || a.payload?.message || '',
        lang: a.lang || 'tr',
        type: a.type,
        deviceId: a.device_id,
        gatewayName: a.gateway?.name || a.gateway?.serialNumber || a.device_id,
        gatewaySerial: a.gateway?.serialNumber || a.device_id,
        sourceUserName: a.source_user
          ? `${a.source_user.name || ''} ${a.source_user.surname || ''}`.trim()
          : null,
        sentAt: a.payload?.sentAt || null,
        receivedAt: a.createdAt,
        location: a.location || null,
        classification: a.classification || null,
      })),
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ message: 'Olay bulunamadı' });
    }
    const status = err.response?.status ?? 502;
    res.status(status >= 500 ? 502 : status).json({
      message: 'Olay mesajları alınamadı',
      detail: err.response?.data ?? err.message,
    });
  }
};
