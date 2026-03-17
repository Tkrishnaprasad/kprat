const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    from: {
        type: String,
        required: true,
        trim: true
    },
    to: {
        type: String,
        required: true,
        trim: true
    },
    fromCoords: {
        lat: Number,
        lng: Number
    },
    toCoords: {
        lat: Number,
        lng: Number
    },
    date: {
        type: String,
        required: true
    },
    time: {
        type: String,
        required: true
    },
    totalSeats: {
        type: Number,
        required: true,
        min: 1,
        max: 8
    },
    availableSeats: {
        type: Number,
        required: true
    },
    fare: {
        type: Number,
        required: true
    },
    vehicle: {
        model: String,
        number: String,
        color: String
    },
    passengers: [
        {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            seats: { type: Number, default: 1 },
            paymentStatus: { type: String, enum: ['pending', 'paid', 'wallet'], default: 'pending' },
            bookedAt: { type: Date, default: Date.now }
        }
    ],
    status: {
        type: String,
        enum: ['open', 'full', 'active', 'completed', 'cancelled'],
        default: 'open'
    },
    notes: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Text index for search
rideSchema.index({ from: 'text', to: 'text' });

module.exports = mongoose.model('Ride', rideSchema);
