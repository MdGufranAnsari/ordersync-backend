const pool = require('../db');

// GET /api/users/sellers
const getSellers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, phone, profile_image FROM users WHERE role = 'seller'"
    );
    return res.status(200).json({ sellers: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error.', error: error.message });
  }
};

module.exports = { getSellers };
