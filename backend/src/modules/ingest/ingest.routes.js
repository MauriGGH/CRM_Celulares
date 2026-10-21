const router = require('express').Router();
const serviceToken = require('../../middleware/serviceToken');
const ctrl = require('./ingest.controller');

router.use(serviceToken);
router.post('/batches', ctrl.createBatch);
router.get('/batches/:id', ctrl.getBatch);

module.exports = router;
