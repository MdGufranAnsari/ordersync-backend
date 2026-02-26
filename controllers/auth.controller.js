const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

const SALT_ROUNDS = 10;

// POST /api/auth/register
const register = async (req, res) => {
    try {
        const { name, phone, password, role } = req.body;

        if (!name || !phone || !password || !role) {
            return res.status(400).json({ message: 'name, phone, password, and role are required.' });
        }

        // Check if phone already exists
        const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'User with this phone number already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const id = uuidv4();

        await pool.query(
            'INSERT INTO users (id, name, phone, password, role) VALUES (?, ?, ?, ?, ?)',
            [id, name, phone, hashedPassword, role]
        );

        return res.status(201).json({
            message: 'User registered successfully.',
            user: { id, name, phone, role },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// POST /api/auth/login
const login = async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ message: 'phone and password are required.' });
        }

        const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        const user = rows[0];

        if (!user) {
            return res.status(400).json({ message: 'Invalid phone number or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid phone number or password.' });
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        return res.status(200).json({ message: 'Login successful.', token });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

module.exports = { register, login };
