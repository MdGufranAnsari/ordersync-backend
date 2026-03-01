require("dotenv").config();

const app = require('./app');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Initialize Socket.io
const socket = require('./socket');
socket.init(server);

console.log("JWT_SECRET:", process.env.JWT_SECRET);
