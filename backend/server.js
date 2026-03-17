const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST']
    }
});

// Make io accessible in routes via req.app.get('io')
app.set('io', io);

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000'
}));
app.use(express.json());

// Global Request Logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};
connectDB();

// ===== REST ROUTES =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/payments', require('./routes/payments'));

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'Server is running', socketio: true }));

// ===== SOCKET.IO REAL-TIME =====
const jwt = require('jsonwebtoken');

io.use((socket, next) => {
    // Authenticate socket connection via token
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
        let t = token.startsWith('Bearer ') ? token.slice(7) : token;
        const decoded = jwt.verify(t, process.env.JWT_SECRET);
        socket.user = decoded.user;
        next();
    } catch (e) {
        next(new Error('Authentication error'));
    }
});

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.user.id})`);

    // Join personal room for notifications
    socket.join(socket.user.id);

    // Join a ride's chat room
    socket.on('join_ride', (rideId) => {
        socket.join(rideId);
        console.log(`User ${socket.user.id} joined ride room: ${rideId}`);
    });

    // Leave a ride's chat room
    socket.on('leave_ride', (rideId) => {
        socket.leave(rideId);
    });

    // Chat message — save to DB and broadcast to room
    socket.on('send_message', async ({ rideId, text }) => {
        try {
            const Message = require('./models/Message');
            const Ride = require('./models/Ride');

            const ride = await Ride.findById(rideId);
            if (!ride) return;

            const isDriver = ride.driver.toString() === socket.user.id;
            const isPassenger = ride.passengers.some(p => p.user.toString() === socket.user.id);
            if (!isDriver && !isPassenger) return;

            const message = new Message({ ride: rideId, sender: socket.user.id, text });
            await message.save();
            await message.populate('sender', 'name');

            io.to(rideId).emit('new_message', message);
        } catch (err) {
            console.error('Socket send_message error:', err.message);
        }
    });

    // Typing indicator
    socket.on('typing', ({ rideId, userName }) => {
        socket.to(rideId).emit('user_typing', { userName });
    });

    socket.on('stop_typing', ({ rideId }) => {
        socket.to(rideId).emit('user_stop_typing');
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server started on port ${PORT} with Socket.io`));
