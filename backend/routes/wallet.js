const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Wallet = require('../models/Wallet');

// Helper: get or create wallet
async function getOrCreateWallet(userId) {
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
        wallet = new Wallet({ user: userId, balance: 0, transactions: [] });
        await wallet.save();
    }
    return wallet;
}

// @route GET /api/wallet
// @desc  Get user's wallet
router.get('/', auth, async (req, res) => {
    console.log('GET /api/wallet - Request received');
    try {
        const wallet = await getOrCreateWallet(req.user.id);
        res.json(wallet);
    } catch (err) {
        console.error('GET /api/wallet error:', err);
        res.status(500).json({ msg: 'Server error', error: err.message });
    }
});

// @route POST /api/wallet/add
// @desc  Add funds to wallet (simulated / after Razorpay verify)
router.post('/add', auth, async (req, res) => {
    console.log('POST /api/wallet/add - Request received');
    try {
        const { amount, description } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ msg: 'Invalid amount' });

        const wallet = await getOrCreateWallet(req.user.id);
        wallet.balance += Number(amount);
        wallet.transactions.push({
            type: 'credit',
            amount: Number(amount),
            description: description || 'Wallet top-up'
        });
        await wallet.save();
        res.json(wallet);
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route GET /api/wallet/transactions
// @desc  Get transaction history
router.get('/transactions', auth, async (req, res) => {
    try {
        const wallet = await getOrCreateWallet(req.user.id);
        const sorted = [...wallet.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sorted);
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route POST /api/wallet/withdraw
// @desc  Request a withdrawal to bank account
router.post('/withdraw', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ msg: 'Invalid amount' });

        const wallet = await getOrCreateWallet(req.user.id);
        if (wallet.balance < amount) {
            return res.status(400).json({ msg: 'Insufficient balance for withdrawal' });
        }

        // Logic: Debit the wallet and log a withdrawal transaction
        wallet.balance -= Number(amount);
        wallet.transactions.push({
            type: 'debit',
            amount: Number(amount),
            description: 'Withdrawal to bank account'
        });
        await wallet.save();

        // In a real app, this would trigger an actual bank transfer via a gateway like Razorpay X
        res.json({ msg: 'Withdrawal request processed successfully', wallet });
    } catch (err) {
        console.error('POST /api/wallet/withdraw error:', err);
        res.status(500).json({ msg: 'Server error' });
    }
});

module.exports = router;
