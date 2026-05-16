const axios = require('axios');
const http = require('http');
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const Gateway = require('../models/Gateway');

const AI_FUSION_URL = process.env.AI_FUSION_URL || 'http://localhost:8000';
const FUSION_INGEST_TOKEN = process.env.FUSION_INGEST_TOKEN || '';
const PROXY_TIMEOUT_MS = 5000;

// Disable keep-alive on the proxy hop to ai-fusion. With keep-alive on,
// axios was reusing TCP sockets that ai-fusion's uvicorn had already
// closed — every ~3rd request returned 'AI fusion service unreachable'
// in 7ms because the first packet hit a half-dead socket. Fresh socket
// per request costs ~1ms and is reliable.
const proxyAgent = new http.Agent({ keepAlive: false });
const fusion = axios.create({
  baseURL: AI_FUSION_URL,
  timeout: PROXY_TIMEOUT_MS,
  httpAgent: proxyAgent,
});

// Single one-shot retry on connection-reset-style failures so the
// occasional flaky socket doesn't surface to the operator UI.
const isTransientNetworkError = (err) => {
  if (err.response) return false; // got an HTTP response → not transient
  const code = err.code || '';
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED'].includes(code);
};

const fusionRequest = async (config) => {
  try {
    return await fusion.request(config);
  } catch (err) {
    if (isTransientNetworkError(err)) {
      return fusion.request(config);
    }
    throw err;
  }
};

const upstreamHeaders = () =>
  FUSION_INGEST_TOKEN ? { Authorization: `Bearer ${FUSION_INGEST_TOKEN}` } : {};

// GET /api/admin/incidents?status_filter=open
//
// Pass-through proxy to the AI fusion service. The fusion service holds
// incidents in process memory (no Mongo) — see hayat-agi/ai
// hayat-agi-fusion/app/store.py — so we can't query them locally.
exports.listIncidents = async (req, res) => {
  try {
    const upstream = await fusionRequest({
      method: 'get',
      url: '/incidents',
      params: req.query,
      headers: upstreamHeaders(),
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
    const upstream = await fusionRequest({
      method: 'get',
      url: `/incidents/${id}`,
      headers: upstreamHeaders(),
    });
    const eventIds = upstream.data?.event_ids || [];
    if (eventIds.length === 0) return res.json({ messages: [] });

    // Filter to valid ObjectIds — anything else is a forwarder synthetic id
    // and won't exist in Mongo.
    const objectIds = eventIds
      .filter((s) => mongoose.isValidObjectId(s))
      .map((s) => new mongoose.Types.ObjectId(s));

    const alerts = await Alert.find({ _id: { $in: objectIds } })
      .populate('source_user', 'name surname medicalConditions medications prosthetics bloodType')
      .populate('gateway', 'name serialNumber')
      .sort({ createdAt: 1 })
      .lean();

    // For alerts that weren't linked to a Gateway by ObjectId (demo data /
    // legacy ingests use device_id only), look up the Gateway by serialNumber.
    const orphanDeviceIds = [
      ...new Set(alerts.filter((a) => !a.gateway && a.device_id).map((a) => a.device_id)),
    ];
    const orphanGateways = orphanDeviceIds.length
      ? await Gateway.find({ serialNumber: { $in: orphanDeviceIds } })
          .select('name serialNumber')
          .lean()
      : [];
    const gatewayBySerial = new Map(orphanGateways.map((g) => [g.serialNumber, g]));

    res.json({
      messages: alerts.map((a) => {
        const gw = a.gateway || gatewayBySerial.get(a.device_id);
        return {
          id: String(a._id),
          text: a.text || a.payload?.message || '',
          lang: a.lang || 'tr',
          type: a.type,
          deviceId: a.device_id,
          gatewayName: gw?.name || gw?.serialNumber || a.device_id,
          gatewaySerial: gw?.serialNumber || a.device_id,
          sourceUserName: a.source_user
            ? `${a.source_user.name || ''} ${a.source_user.surname || ''}`.trim()
            : null,
          // Health profile snapshot — only surfaced when the citizen has
          // at least one entry on file so the UI can simply check `!!`.
          // Frontend matches against incident.health_risk_factors to show
          // which of these conditions actually triggered a risk bonus.
          sourceUserHealth: a.source_user && (
            (a.source_user.medicalConditions?.length ?? 0) > 0 ||
            (a.source_user.medications?.length ?? 0) > 0 ||
            (a.source_user.prosthetics?.length ?? 0) > 0 ||
            a.source_user.bloodType
          )
            ? {
                medicalConditions: a.source_user.medicalConditions || [],
                medications: a.source_user.medications || [],
                prosthetics: a.source_user.prosthetics || [],
                bloodType: a.source_user.bloodType || null,
              }
            : null,
          sentAt: a.payload?.sentAt || null,
          receivedAt: a.createdAt,
          location: a.location || null,
          classification: a.classification || null,
          source: a.source || null,
          meshHops: a.meshHops ?? null,
          meshSrcAddr: a.meshSrcAddr || null,
          meshMsgId: a.meshMsgId || null,
          meshHopPath: a.meshHopPath || null,
        };
      }),
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

// POST /api/admin/incidents/:id/close?false_alarm=true
exports.closeIncident = async (req, res) => {
  const { id } = req.params;
  try {
    const upstream = await fusionRequest({
      method: 'post',
      url: `/incidents/${id}/close`,
      data: null,
      params: { false_alarm: req.query.false_alarm === 'true' },
      headers: upstreamHeaders(),
    });
    res.status(upstream.status).json(upstream.data);
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ message: 'Olay bulunamadı' });
    }
    const status = err.response?.status ?? 502;
    res.status(status >= 500 ? 502 : status).json({
      message: 'Olay kapatılamadı',
      detail: err.response?.data ?? err.message,
    });
  }
};
