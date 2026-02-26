require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const orderRoutes = require('./routes/order.routes');
const userRoutes = require('./routes/user.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);

// Temp debug — remove after resolving Railway DB issue
app.get('/api/debug', (req, res) => {
    res.json({
        DB_HOST: process.env.DB_HOST || 'NOT SET',
        DB_USER: process.env.DB_USER || 'NOT SET',
        DB_NAME: process.env.DB_NAME || 'NOT SET',
        DB_PORT: process.env.DB_PORT || 'NOT SET',
        DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT SET',
    });
});

module.exports = app;
