const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

// POST /api/orders — customer only
const createOrder = async (req, res) => {
    const { userId } = req.user;
    const { sellerId, items } = req.body;

    if (!sellerId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'sellerId and items are required.' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Get customer and seller info
        const [[customer]] = await conn.query('SELECT name, phone FROM users WHERE id = ?', [userId]);
        const [[seller]] = await conn.query('SELECT name, phone FROM users WHERE id = ?', [sellerId]);

        if (!customer || !seller) {
            await conn.rollback();
            return res.status(404).json({ message: 'Customer or seller not found.' });
        }

        const orderId = uuidv4();

        // Insert order
        await conn.query(
            `INSERT INTO orders (id, customer_id, seller_id, total_amount, status)
             VALUES (?, ?, ?, 0, 'PENDING')`,
            [orderId, userId, sellerId]
        );

        // Insert order items
        for (const item of items) {
            await conn.query(
                'INSERT INTO order_items (order_id, name, quantity, price) VALUES (?, ?, ?, NULL)',
                [orderId, item.name, item.quantity ?? 1]
            );
        }

        await conn.commit();

        // Fetch the complete order to return
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

// PUT /api/orders/:id — seller adds prices
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

        // Update each item's price
        for (const item of items) {
            await conn.query(
                'UPDATE order_items SET price = ? WHERE order_id = ? AND name = ?',
                [item.price ?? null, id, item.name]
            );
        }

        // Recalculate total
        const [itemRows] = await conn.query(
            'SELECT price, quantity FROM order_items WHERE order_id = ?', [id]
        );
        const total = itemRows.reduce((sum, r) => sum + (r.price ?? 0) * r.quantity, 0);

        await conn.query(
            "UPDATE orders SET total_amount = ?, status = 'PRICED' WHERE id = ?",
            [total, id]
        );

        await conn.commit();

        const [[customer]] = await conn.query('SELECT name, phone FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        return res.status(200).json({ message: 'Order updated successfully.', order: updatedOrder });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// PATCH /api/orders/:id/items — customer edits items
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

        // Delete old items and re-insert
        await conn.query('DELETE FROM order_items WHERE order_id = ?', [id]);
        for (const item of items) {
            await conn.query(
                'INSERT INTO order_items (order_id, name, quantity, price) VALUES (?, ?, ?, NULL)',
                [id, item.name, item.quantity ?? 1]
            );
        }

        // Reset total and status to PENDING
        await conn.query(
            "UPDATE orders SET total_amount = 0, status = 'PENDING' WHERE id = ?",
            [id]
        );

        await conn.commit();

        const [[customer]] = await conn.query('SELECT name, phone FROM users WHERE id = ?', [order.customer_id]);
        const [[seller]] = await conn.query('SELECT name, phone FROM users WHERE id = ?', [order.seller_id]);
        const updatedOrder = await _fetchOrder(conn, id, customer, seller, order.customer_id, order.seller_id);
        return res.status(200).json({ message: 'Order items updated.', order: updatedOrder });
    } catch (error) {
        await conn.rollback();
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        conn.release();
    }
};

// ── Private helpers ───────────────────────────────────────────

async function _fetchOrder(conn, orderId, customer, seller, customerId, sellerId) {
    const [[o]] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [itemRows] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    return _formatOrder(o, itemRows, customer, seller, customerId, sellerId);
}

async function _fetchOrdersForUser(pool, column, userId) {
    const [orderRows] = await pool.query(`SELECT * FROM orders WHERE ${column} = ? ORDER BY created_at DESC`, [userId]);
    const result = [];
    for (const o of orderRows) {
        const [itemRows] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
        const [[customer]] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [o.customer_id]);
        const [[seller]] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [o.seller_id]);
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
        sellerId,
        sellerName: seller?.name ?? 'Unknown',
        sellerPhone: seller?.phone ?? 'N/A',
        items: itemRows.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price !== null ? parseFloat(i.price) : null,
        })),
        totalAmount: parseFloat(o.total_amount ?? 0),
        status: o.status,
        createdAt: o.created_at instanceof Date ? o.created_at.toISOString() : o.created_at,
    };
}

module.exports = { createOrder, getCustomerOrders, getSellerOrders, updateOrderPrices, updateOrderItems };
