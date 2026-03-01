const { Server } = require("socket.io");

let io;

module.exports = {
    init: (httpServer) => {
        io = new Server(httpServer, {
            cors: {
                origin: "*",
            },
        });

        console.log('Socket.IO initialized');

        io.on("connection", (socket) => {
            console.log(`[Socket] New client connected: ${socket.id}`);

            // Expect clent to emit 'join_room' with their userId
            socket.on("join_room", (userId) => {
                if (!userId) return;
                const roomName = `room_${userId}`;
                socket.join(roomName);
                console.log(`[Socket] Client ${socket.id} joined room: ${roomName}`);
            });

            socket.on("disconnect", () => {
                console.log(`[Socket] Client disconnected: ${socket.id}`);
            });
        });

        return io;
    },
    getIo: () => {
        if (!io) {
            throw new Error("Socket.io not initialized!");
        }
        return io;
    }
};
