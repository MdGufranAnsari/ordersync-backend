const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const fs = require('fs');
const path = require('path');

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
            {
                userId: user.id,
                name: user.name,
                phone: user.phone,
                role: user.role,
                accountStatus: user.account_status,
                profileImage: user.profile_image
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        return res.status(200).json({ message: 'Login successful.', token });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// GET /api/auth/me
const getMe = async (req, res) => {
    try {
        const userId = req.user.userId;
        const [rows] = await pool.query('SELECT id, name, phone, role, account_status, profile_image FROM users WHERE id = ?', [userId]);
        const user = rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        return res.status(200).json({ user });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

// POST /api/auth/profile-image
const uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided.' });
        }

        const userId = req.user.userId;
        const imageUrl = `/uploads/${req.file.filename}`;

        // Get old image to delete it
        const [rows] = await pool.query('SELECT profile_image FROM users WHERE id = ?', [userId]);
        const oldImage = rows[0]?.profile_image;

        // Update database
        await pool.query('UPDATE users SET profile_image = ? WHERE id = ?', [imageUrl, userId]);

        // Delete old image file if it exists
        if (oldImage) {
            const oldImagePath = path.join(__dirname, '..', oldImage);
            fs.unlink(oldImagePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.error('Failed to delete old profile image:', err);
                }
            });
        }

        return res.status(200).json({
            message: 'Profile image updated successfully.',
            profileImage: imageUrl
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
};

module.exports = { register, login, getMe, uploadProfileImage };
