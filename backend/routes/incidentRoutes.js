const express = require('express');
const router = express.Router();
const { listIncidents } = require('../controllers/incidentController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Admin: AI fusion service'ten incident listesini al
router.get('/', protect, adminOnly, listIncidents);

module.exports = router;
