const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Ride = require('../models/Ride');
const Wallet = require('../models/Wallet');
const User = require('../models/User');

// @route GET /api/rides
// @desc  Search available rides
router.get('/', async (req, res) => {
    try {
        const { from, to, date } = req.query;
        let query = { status: { $in: ['open', 'full'] } };

        if (from) query.from = { $regex: from, $options: 'i' };
        if (to) query.to = { $regex: to, $options: 'i' };
        if (date) query.date = date;

        const rides = await Ride.find(query)
            .populate('driver', 'name phone vehicle rating')
            .sort({ date: 1, time: 1 })
            .limit(50);

        res.json(rides);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route GET /api/rides/my
// @desc  Get logged-in user's rides
router.get('/my', auth, async (req, res) => {
    try {
        const asDriver = await Ride.find({ driver: req.user.id })
            .populate('passengers.user', 'name phone')
            .sort({ createdAt: -1 });

        const asPassenger = await Ride.find({ 'passengers.user': req.user.id })
            .populate('driver', 'name phone vehicle')
            .sort({ createdAt: -1 });

        res.json({ asDriver, asPassenger });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route GET /api/rides/:id
// @desc  Get a single ride
router.get('/:id', async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.id)
            .populate('driver', 'name phone vehicle')
            .populate('passengers.user', 'name phone');
        if (!ride) return res.status(404).json({ msg: 'Ride not found' });
        res.json(ride);
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route POST /api/rides
// @desc  Create / offer a ride (driver only)
router.post('/', auth, async (req, res) => {
    try {
        const { from, to, fromCoords, toCoords, date, time, totalSeats, fare, notes, vehicle } = req.body;

        const ride = new Ride({
            driver: req.user.id,
            from, to, fromCoords, toCoords,
            date, time,
            totalSeats,
            availableSeats: totalSeats,
            fare,
            notes,
            vehicle
        });

        await ride.save();
        await ride.populate('driver', 'name phone vehicle');

        // Emit socket event to all connected clients
        const io = req.app.get('io');
        if (io) io.emit('new_ride', ride);

        res.json(ride);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route POST /api/rides/:id/book
// @desc  Book a seat on a ride
router.post('/:id/book', auth, async (req, res) => {
    try {
        const { seats = 1, paymentMethod } = req.body;
        const ride = await Ride.findById(req.params.id);

        if (!ride) return res.status(404).json({ msg: 'Ride not found' });
        if (ride.status === 'cancelled') return res.status(400).json({ msg: 'Ride is cancelled' });
        if (ride.availableSeats < seats) return res.status(400).json({ msg: 'Not enough seats available' });

        // Check if user already booked
        const alreadyBooked = ride.passengers.find(p => p.user.toString() === req.user.id);
        if (alreadyBooked) return res.status(400).json({ msg: 'You already booked this ride' });

        // Driver can't book own ride
        if (ride.driver.toString() === req.user.id) {
            return res.status(400).json({ msg: 'You cannot book your own ride' });
        }

        const totalFare = ride.fare * seats;

        // If paying by wallet
        if (paymentMethod === 'wallet') {
            let wallet = await Wallet.findOne({ user: req.user.id });
            if (!wallet) return res.status(400).json({ msg: 'Wallet not found. Please add funds first.' });
            if (wallet.balance < totalFare) {
                return res.status(400).json({ msg: `Insufficient wallet balance. Need ₹${totalFare}, have ₹${wallet.balance}` });
            }
            wallet.balance -= totalFare;
            wallet.transactions.push({
                type: 'debit',
                amount: totalFare,
                description: `Ride payment: ${ride.from} → ${ride.to}`,
                ride: ride._id
            });
            await wallet.save();

            // Credit driver wallet
            let driverWallet = await Wallet.findOne({ user: ride.driver });
            if (!driverWallet) {
                driverWallet = new Wallet({ user: ride.driver, balance: 0 });
            }
            driverWallet.balance += totalFare;
            driverWallet.transactions.push({
                type: 'credit',
                amount: totalFare,
                description: `Ride earnings: ${ride.from} → ${ride.to}`,
                ride: ride._id
            });
            await driverWallet.save();
        }

        ride.passengers.push({
            user: req.user.id,
            seats,
            paymentStatus: paymentMethod === 'wallet' ? 'wallet' : 'pending'
        });
        ride.availableSeats -= seats;
        if (ride.availableSeats === 0) ride.status = 'full';

        await ride.save();
        await ride.populate('driver', 'name phone vehicle');
        await ride.populate('passengers.user', 'name phone');

        const io = req.app.get('io');
        if (io) {
            // Notify specific ride room
            io.to(ride._id.toString()).emit('ride_booked', { rideId: ride._id, ride });
            // Notify driver specifically (if they have a personal room)
            io.to(ride.driver._id.toString()).emit('notification', {
                type: 'booking',
                message: `New booking for ride ${ride.from} → ${ride.to}`,
                rideId: ride._id
            });
        }

        res.json(ride);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route PUT /api/rides/:id/status
// @desc  Update ride status (driver only)
router.put('/:id/status', auth, async (req, res) => {
    try {
        const { status } = req.body;
        const ride = await Ride.findById(req.params.id)
            .populate('passengers.user', 'name');
        if (!ride) return res.status(404).json({ msg: 'Ride not found' });
        if (ride.driver.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }

        ride.status = status;
        await ride.save();

        const io = req.app.get('io');
        if (io) {
            io.to(ride._id.toString()).emit('ride_status_changed', { rideId: ride._id, status });
            // Alert passengers
            ride.passengers.forEach(p => {
                io.to(p.user._id.toString()).emit('notification', {
                    type: 'status_update',
                    message: `Ride ${ride.from} → ${ride.to} is now ${status}`,
                    rideId: ride._id
                });
            });
        }

        res.json(ride);
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route DELETE /api/rides/:id
// @desc  Cancel a ride
router.delete('/:id', auth, async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.id);
        if (!ride) return res.status(404).json({ msg: 'Ride not found' });
        if (ride.driver.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'Not authorized' });
        }
        ride.status = 'cancelled';
        await ride.save();
        res.json({ msg: 'Ride cancelled' });
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
});

module.exports = router;
