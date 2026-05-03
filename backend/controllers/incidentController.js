const axios = require('axios');

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
