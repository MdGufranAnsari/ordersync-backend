const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { getSellers } = require('../controllers/user.controller');

// GET /api/users/sellers — protected, any logged-in user
router.get('/sellers', verifyToken, getSellers);

module.exports = router;
