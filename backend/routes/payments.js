const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const Payment = require('../models/Payment');
const Wallet = require('../models/Wallet');

// Use Razorpay only if keys are present
let razorpay = null;
try {
    const Razorpay = require('razorpay');
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_KEY_ID !== 'rzp_test_placeholder') {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }
} catch (e) {
    console.log('Razorpay not configured. Using simulated payments.');
}

// @route POST /api/payments/create-order
// @desc  Create a Razorpay order
router.post('/create-order', auth, async (req, res) => {
    try {
        const { amount, rideId } = req.body; // amount in rupees
        const amountPaise = Math.round(amount * 100);

        if (razorpay) {
            const order = await razorpay.orders.create({
                amount: amountPaise,
                currency: 'INR',
                receipt: `ride_${rideId}_${Date.now()}`
            });

            const payment = new Payment({
                user: req.user.id,
                ride: rideId,
                amount,
                method: 'razorpay',
                razorpayOrderId: order.id,
                status: 'created'
            });
            await payment.save();

            res.json({
                orderId: order.id,
                amount: amountPaise,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID
            });
        } else {
            // Simulated payment for testing without Razorpay keys
            res.json({
                orderId: `sim_order_${Date.now()}`,
                amount: amountPaise,
                currency: 'INR',
                keyId: 'test_mode',
                simulated: true
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Could not create payment order' });
    }
});

// @route POST /api/payments/verify
// @desc  Verify Razorpay payment signature
router.post('/verify', auth, async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, rideId, amount, simulated } = req.body;

        if (simulated) {
            // Simulated success — add to wallet credits
            let wallet = await Wallet.findOne({ user: req.user.id });
            if (!wallet) wallet = new Wallet({ user: req.user.id, balance: 0 });
            wallet.transactions.push({
                type: 'credit',
                amount,
                description: 'Simulated Razorpay top-up'
            });
            wallet.balance += amount;
            await wallet.save();
            return res.json({ verified: true, simulated: true });
        }

        if (razorpay) {
            const body = razorpayOrderId + '|' + razorpayPaymentId;
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(body)
                .digest('hex');

            if (expectedSignature !== razorpaySignature) {
                return res.status(400).json({ msg: 'Payment verification failed' });
            }
        }

        // Update payment record
        await Payment.findOneAndUpdate(
            { razorpayOrderId },
            { razorpayPaymentId, razorpaySignature, status: 'paid' }
        );

        res.json({ verified: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Verification error' });
    }
});

module.exports = router;
