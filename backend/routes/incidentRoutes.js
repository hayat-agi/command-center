const express = require('express');
const router = express.Router();
const { listIncidents, getIncidentMessages, closeIncident } = require('../controllers/incidentController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Admin: AI fusion service'ten incident listesini al
router.get('/', protect, adminOnly, listIncidents);

// Admin: bir olaya katılan orijinal mesajları (Alert) getir
router.get('/:id/messages', protect, adminOnly, getIncidentMessages);

// Admin: olayı kapat (opsiyonel ?false_alarm=true)
router.post('/:id/close', protect, adminOnly, closeIncident);

module.exports = router;
