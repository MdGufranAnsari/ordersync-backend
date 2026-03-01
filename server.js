require("dotenv").config();

const app = require('./app');
const http = require('http');

const PORT = 5000;

// Create HTTP Server explicitly for Socket.io compliance
const server = http.createServer(app);

// Initialize Socket.io
const socket = require('./socket');
socket.init(server);

// Bind to 0.0.0.0 for Railway networking
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

console.log("JWT_SECRET:", process.env.JWT_SECRET);
