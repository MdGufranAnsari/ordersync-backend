const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

// ── Helper: generate 4-digit pickup code ──
function _genCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

// ── Helper: check & auto-expire ready orders past deadline ──
async function _checkExpiry(conn, orderId) {
    const [[o]] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (
        o &&
        o.status === 'ready' &&
        o.code_verified === 0 &&
        o.pickup_deadline &&
        new Date() > new Date(o.pickup_deadline)
    ) {
        await conn.query(
            "UPDATE orders SET status = 'expired_pending_confirmation' WHERE id = ?",
            [orderId]
        );
        return true;
    }
    return false;
}

// POST /api/orders — customer only
const createOrder = async (req, res) => {
    const { userId } = req.user;
    const { sellerId, items } = req.body;

    if (!sellerId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'sellerId and items are required.' });
    }

    const conn = await pool.getConnection();
    try {
        // Check if customer account is restricted
        const [[customer]] = await conn.query('SELECT name, phone, account_status, profile_image FROM users WHERE id = ?', [userId]);
        if (customer?.account_status === 'restricted') {
            conn.release();
            return res.status(403).json({ message: 'Your account is restricted due to repeated no-shows. Contact support.' });
        }

        await conn.beginTransaction();
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [sellerId]);

        if (!customer || !seller) {
            await conn.rollback();
            return res.status(404).json({ message: 'Customer or seller not found.' });
        }

        const orderId = uuidv4();
        await conn.query(
            `INSERT INTO orders (id, customer_id, seller_id, total_amount, status) VALUES (?, ?, ?, 0, 'PENDING')`,
            [orderId, userId, sellerId]
        );
        for (const item of items) {
            await conn.query(
                'INSERT INTO order_items (order_id, name, quantity, price) VALUES (?, ?, ?, NULL)',
                [orderId, item.name, item.quantity ?? 1]
            );
        }
        await conn.commit();
        const order = await _fetchOrder(conn, orderId, customer, seller, userId, sellerId);
        return res.status(201).json({ message: 'Order created successfully.', order });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// GET /api/orders/customer
const getCustomerOrders = async (req, res) => {
    const { userId } = req.user;
    try {
        const orders = await _fetchOrdersForUser(pool, 'customer_id', userId);
        return res.status(200).json({ orders });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// GET /api/orders/seller
const getSellerOrders = async (req, res) => {
    const { userId } = req.user;
    try {
        const orders = await _fetchOrdersForUser(pool, 'seller_id', userId);
        return res.status(200).json({ orders });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// PUT /api/orders/:id — seller sets prices → status: PRICED
const updateOrderPrices = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'items array with prices is required.' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { await conn.rollback(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.seller_id !== userId) { await conn.rollback(); return res.status(403).json({ message: 'Not authorized.' }); }

        for (const item of items) {
            await conn.query(
                'UPDATE order_items SET price = ? WHERE order_id = ? AND name = ?',
                [item.price ?? null, id, item.name]
            );
        }
        const [itemRows] = await conn.query('SELECT price, quantity FROM order_items WHERE order_id = ?', [id]);
        const total = itemRows.reduce((sum, r) => sum + (r.price ?? 0) * r.quantity, 0);

        await conn.query("UPDATE orders SET total_amount = ?, status = 'PRICED' WHERE id = ?", [total, id]);
        await conn.commit();

        const [[customer]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        return res.status(200).json({ message: 'Order priced.', order: updatedOrder });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// PATCH /api/orders/:id/items — customer edits items (only on PENDING)
const updateOrderItems = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'items array is required.' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { await conn.rollback(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.customer_id !== userId) { await conn.rollback(); return res.status(403).json({ message: 'Not authorized.' }); }

        await conn.query('DELETE FROM order_items WHERE order_id = ?', [id]);
        for (const item of items) {
            await conn.query(
                'INSERT INTO order_items (order_id, name, quantity, price) VALUES (?, ?, ?, NULL)',
                [id, item.name, item.quantity ?? 1]
            );
        }
        await conn.query("UPDATE orders SET total_amount = 0, status = 'PENDING' WHERE id = ?", [id]);
        await conn.commit();

        const [[customer]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        return res.status(200).json({ message: 'Order items updated.', order: updatedOrder });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// POST /api/orders/:id/confirm — customer picks immediate or later
const confirmOrder = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;
    const { pickupType } = req.body; // 'immediate' | 'later'

    if (!['immediate', 'later'].includes(pickupType)) {
        return res.status(400).json({ message: "pickupType must be 'immediate' or 'later'." });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { await conn.rollback(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.customer_id !== userId) { await conn.rollback(); return res.status(403).json({ message: 'Not authorized.' }); }
        if (order.status !== 'PRICED') { await conn.rollback(); return res.status(400).json({ message: 'Order must be PRICED to confirm.' }); }

        const newStatus = pickupType === 'immediate' ? 'confirmed_immediate' : 'confirmed';
        const pickupCode = pickupType === 'later' ? _genCode() : null;

        await conn.query(
            'UPDATE orders SET status = ?, pickup_type = ?, pickup_code = ?, code_verified = 0 WHERE id = ?',
            [newStatus, pickupType, pickupCode, id]
        );
        await conn.commit();

        const [[customer]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        return res.status(200).json({ message: 'Order confirmed.', order: updatedOrder });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// POST /api/orders/:id/ready — seller marks order ready (later pickup only)
const markReady = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { await conn.rollback(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.seller_id !== userId) { await conn.rollback(); return res.status(403).json({ message: 'Not authorized.' }); }
        if (order.status !== 'confirmed') { await conn.rollback(); return res.status(400).json({ message: 'Order must be confirmed (later) to mark ready.' }); }

        const readyAt = new Date();
        const deadline = new Date(readyAt.getTime() + 2 * 60 * 60 * 1000); // +2 hours

        await conn.query(
            "UPDATE orders SET status = 'ready', ready_at = ?, pickup_deadline = ? WHERE id = ?",
            [readyAt, deadline, id]
        );
        await conn.commit();

        const [[customer]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        return res.status(200).json({ message: 'Order marked ready.', order: updatedOrder });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// POST /api/orders/:id/verify-code — seller enters code, completes order
const verifyCode = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;
    const { code } = req.body;

    const conn = await pool.getConnection();
    try {
        // Check expiry first
        await _checkExpiry(conn, id);

        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { conn.release(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.seller_id !== userId) { conn.release(); return res.status(403).json({ message: 'Not authorized.' }); }
        if (order.status !== 'ready') { conn.release(); return res.status(400).json({ message: 'Order is not in ready state.' }); }

        if (String(code) !== String(order.pickup_code)) {
            conn.release();
            return res.status(400).json({ message: 'Incorrect pickup code.' });
        }

        await conn.query(
            "UPDATE orders SET status = 'completed', code_verified = 1 WHERE id = ?", [id]
        );

        const [[customer]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        conn.release();
        return res.status(200).json({ message: 'Code verified. Order completed!', order: updatedOrder });
    } catch (error) {
        conn.release();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// POST /api/orders/:id/complete — seller completes immediate order OR confirms "Yes, collected"
const completeOrder = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;

    const conn = await pool.getConnection();
    try {
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { conn.release(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.seller_id !== userId) { conn.release(); return res.status(403).json({ message: 'Not authorized.' }); }

        const allowed = ['confirmed_immediate', 'expired_pending_confirmation'];
        if (!allowed.includes(order.status)) {
            conn.release();
            return res.status(400).json({ message: 'Order cannot be completed from current status.' });
        }

        await conn.query("UPDATE orders SET status = 'completed' WHERE id = ?", [id]);

        const [[customer]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        conn.release();
        return res.status(200).json({ message: 'Order completed.', order: updatedOrder });
    } catch (error) {
        conn.release();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// POST /api/orders/:id/no-show — seller says customer did NOT collect
const reportNoShow = async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;

    const conn = await pool.getConnection();
    try {
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (!order) { conn.release(); return res.status(404).json({ message: 'Order not found.' }); }
        if (order.seller_id !== userId) { conn.release(); return res.status(403).json({ message: 'Not authorized.' }); }
        if (order.status !== 'expired_pending_confirmation') {
            conn.release();
            return res.status(400).json({ message: 'Order is not awaiting no-show confirmation.' });
        }

        await conn.query("UPDATE orders SET status = 'expired' WHERE id = ?", [id]);

        // Increment no_show_count and possibly restrict
        await conn.query(
            'UPDATE users SET no_show_count = no_show_count + 1 WHERE id = ?',
            [order.customer_id]
        );
        const [[customer]] = await conn.query('SELECT no_show_count FROM users WHERE id = ?', [order.customer_id]);
        if (customer.no_show_count >= 3) {
            await conn.query(
                "UPDATE users SET account_status = 'restricted' WHERE id = ?",
                [order.customer_id]
            );
        }

        conn.release();
        return res.status(200).json({
            message: 'No-show recorded.',
            noShowCount: customer.no_show_count,
            restricted: customer.no_show_count >= 3,
        });
    } catch (error) {
        conn.release();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// ── Private helpers ─────────────────────────────────────────────

async function _fetchOrder(conn, orderId, customer, seller, customerId, sellerId) {
    const [[o]] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [itemRows] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    return _formatOrder(o, itemRows, customer, seller, customerId, sellerId);
}

async function _fetchOrdersForUser(pool, column, userId) {
    const [orderRows] = await pool.query(
        `SELECT * FROM orders WHERE ${column} = ? ORDER BY created_at DESC`, [userId]
    );

    // Auto-expire any ready orders past deadline
    for (const o of orderRows) {
        if (
            o.status === 'ready' &&
            o.code_verified === 0 &&
            o.pickup_deadline &&
            new Date() > new Date(o.pickup_deadline)
        ) {
            await pool.query(
                "UPDATE orders SET status = 'expired_pending_confirmation' WHERE id = ?",
                [o.id]
            );
            o.status = 'expired_pending_confirmation';
        }
    }

    const result = [];
    for (const o of orderRows) {
        const [itemRows] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
        const [[customer]] = await pool.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [o.customer_id]);
        const [[seller]] = await pool.query('SELECT name, phone, profile_image FROM users WHERE id = ?', [o.seller_id]);
        result.push(_formatOrder(o, itemRows, customer, seller, o.customer_id, o.seller_id));
    }
    return result;
}

function _formatOrder(o, itemRows, customer, seller, customerId, sellerId) {
    return {
        id: o.id,
        customerId,
        customerName: customer?.name ?? 'Unknown',
        customerPhone: customer?.phone ?? 'N/A',
        customerProfileImage: customer?.profile_image ?? null,
        sellerId,
        sellerName: seller?.name ?? 'Unknown',
        sellerPhone: seller?.phone ?? 'N/A',
        sellerProfileImage: seller?.profile_image ?? null,
        items: itemRows.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price !== null ? parseFloat(i.price) : null,
        })),
        totalAmount: parseFloat(o.total_amount ?? 0),
        status: o.status,
        pickupType: o.pickup_type ?? null,
        pickupCode: o.pickup_code ?? null,
        codeVerified: !!o.code_verified,
        readyAt: o.ready_at ? new Date(o.ready_at).toISOString() : null,
        pickupDeadline: o.pickup_deadline ? new Date(o.pickup_deadline).toISOString() : null,
        createdAt: o.created_at instanceof Date ? o.created_at.toISOString() : o.created_at,
    };
}

module.exports = {
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
};
