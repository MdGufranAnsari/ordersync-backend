require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const orderRoutes = require('./routes/order.routes');
const userRoutes = require('./routes/user.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);

// Temporary migration route 
app.get('/api/migrate', async (req, res) => {
    try {
        const pool = require('./db');
        await pool.query('ALTER TABLE users ADD COLUMN profile_image VARCHAR(255) DEFAULT NULL');
        res.send("Migration successful! Added profile_image column.");
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            res.send("Migration already applied! profile_image exists.");
        } else {
            res.status(500).send("Migration failed: " + e.message);
        }
    }
});

module.exports = app;
