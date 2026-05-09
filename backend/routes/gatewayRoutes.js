const express = require('express');
const router = express.Router();
const gatewayController = require('../controllers/gatewayController');
const { protect, protectOrMeshUplink, requireDeviceToken } = require('../middleware/authMiddleware');

router.get('/', protect, gatewayController.getGateways);
router.get('/user', protect, gatewayController.getUserGateways);

// Heartbeat MUST come before any /:id route — Express matches in order and
// "heartbeat" would otherwise be treated as an :id by an earlier rule.
router.post('/heartbeat', requireDeviceToken, gatewayController.heartbeat);

router.put('/:id', protect, gatewayController.updateGateway);

router.post('/', protect, gatewayController.createGateway);

router.delete('/:id', protect, gatewayController.deleteGateway);

router.post('/:id/citizens', protect, gatewayController.addPersonToGateway);
router.delete('/:gatewayId/citizens/:personId', protect, gatewayController.removePersonFromGateway);

router.post('/:id/pets', protect, gatewayController.addPetToGateway);
router.delete('/:gatewayId/pets/:petId', protect, gatewayController.removePetFromGateway);

router.post('/:id/disaster-events', protectOrMeshUplink, gatewayController.addDisasterEvent);
router.get('/:id/alerts', protect, gatewayController.listGatewayAlerts);

module.exports = router;