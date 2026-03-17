const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    ride: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ride',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    method: {
        type: String,
        enum: ['razorpay', 'wallet'],
        required: true
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    status: {
        type: String,
        enum: ['created', 'paid', 'failed', 'refunded'],
        default: 'created'
    }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
