const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const Ride = require('../models/Ride');

// @route GET /api/messages/:rideId
// @desc  Get all messages for a ride
router.get('/:rideId', auth, async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.rideId);
        if (!ride) return res.status(404).json({ msg: 'Ride not found' });

        // Only driver or passengers can read messages
        const isDriver = ride.driver.toString() === req.user.id;
        const isPassenger = ride.passengers.some(p => p.user.toString() === req.user.id);
        if (!isDriver && !isPassenger) {
            return res.status(403).json({ msg: 'Not authorised to view this chat' });
        }

        const messages = await Message.find({ ride: req.params.rideId })
            .populate('sender', 'name')
            .sort({ createdAt: 1 });

        res.json(messages);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route POST /api/messages
// @desc  Send a message (also pushed via socket from client)
router.post('/', auth, async (req, res) => {
    try {
        const { rideId, text } = req.body;
        const ride = await Ride.findById(rideId);
        if (!ride) return res.status(404).json({ msg: 'Ride not found' });

        const isDriver = ride.driver.toString() === req.user.id;
        const isPassenger = ride.passengers.some(p => p.user.toString() === req.user.id);
        if (!isDriver && !isPassenger) {
            return res.status(403).json({ msg: 'Not authorised' });
        }

        const message = new Message({ ride: rideId, sender: req.user.id, text });
        await message.save();
        await message.populate('sender', 'name');

        // Emit to the ride room
        const io = req.app.get('io');
        if (io) {
            io.to(rideId).emit('new_message', message);
        }

        res.json(message);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

module.exports = router;
