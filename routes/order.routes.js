const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const {
    createOrder,
    getCustomerOrders,
    getSellerOrders,
    updateOrderPrices,
    updateOrderItems,
    confirmOrder,
    markReady,
    verifyCode,
    completeOrder,
    reportNoShow,
} = require('../controllers/order.controller');

// All routes protected by JWT auth
router.post('/', verifyToken, authorizeRole('customer'), createOrder);
router.get('/customer', verifyToken, authorizeRole('customer'), getCustomerOrders);
router.get('/seller', verifyToken, authorizeRole('seller'), getSellerOrders);
router.put('/:id', verifyToken, authorizeRole('seller'), updateOrderPrices);
router.patch('/:id/items', verifyToken, authorizeRole('customer'), updateOrderItems);
router.post('/:id/confirm', verifyToken, authorizeRole('customer'), confirmOrder);
router.post('/:id/ready', verifyToken, authorizeRole('seller'), markReady);
router.post('/:id/verify-code', verifyToken, authorizeRole('seller'), verifyCode);
router.post('/:id/complete', verifyToken, authorizeRole('seller'), completeOrder);
router.post('/:id/no-show', verifyToken, authorizeRole('seller'), reportNoShow);

module.exports = router;
