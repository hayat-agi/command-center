const express = require('express');
const router = express.Router();
const { listIncidents, getIncidentMessages } = require('../controllers/incidentController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Admin: AI fusion service'ten incident listesini al
router.get('/', protect, adminOnly, listIncidents);

// Admin: bir olaya katılan orijinal mesajları (Alert) getir
router.get('/:id/messages', protect, adminOnly, getIncidentMessages);

module.exports = router;
