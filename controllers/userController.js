const User = require('../models/User');
const stripe = require('stripe')(process.env.STRIPE_KEY);

// @desc    Get all users
// @route   GET /api/auth/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
    try {
        const users = await User.find({}).select('-password');
        res.status(200).json(users);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching users', error: err.message });
    }
};

// @desc    Get single user
// @route   GET /api/auth/users/:id
// @access  Private/Admin
exports.getUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json(user);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching user', error: err.message });
    }
};

// @desc    Update user
// @route   PUT /api/auth/users/:id
// @access  Private/Admin
exports.updateUser = async (req, res) => {
    try {
        const { plan, role, isActive } = req.body;

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { plan, role, isActive },
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(user);
    } catch (err) {
        res.status(500).json({ message: 'Error updating user', error: err.message });
    }
};

// @desc    Process refund for user
// @route   POST /api/auth/users/:id/refund
// @access  Private/Admin
exports.processRefund = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let refundDetails = null;

        if (user.stripeCustomerId) {
            try {
                // 1. Obtener suscripciones activas
                const subscriptions = await stripe.subscriptions.list({
                    customer: user.stripeCustomerId,
                    status: 'active',
                    limit: 1
                });

                if (subscriptions.data.length > 0) {
                    const activeSubscription = subscriptions.data[0];

                    // 2. Cancelar suscripción
                    const canceledSubscription = await stripe.subscriptions.cancel(
                        activeSubscription.id,
                        { invoice_now: true }
                    );

                    // 3. Buscar el último pago (CORRECCIÓN: eliminado el parámetro sort)
                    const invoices = await stripe.invoices.list({
                        customer: user.stripeCustomerId,
                        limit: 1,
                        status: 'paid'
                    });

                    // Ordenar manualmente por fecha de creación si es necesario
                    invoices.data.sort((a, b) => b.created - a.created);

                    if (invoices.data.length > 0) {
                        const latestInvoice = invoices.data[0];
                        const paymentIntent = latestInvoice.payment_intent;

                        if (paymentIntent) {
                            const payment = await stripe.paymentIntents.retrieve(paymentIntent);
                            const paymentDate = new Date(payment.created * 1000);
                            const daysSincePayment = (new Date() - paymentDate) / (1000 * 60 * 60 * 24);

                            if (daysSincePayment <= 30) {
                                const refund = await stripe.refunds.create({
                                    payment_intent: paymentIntent,
                                    reason: 'requested_by_customer'
                                });

                                refundDetails = {
                                    id: refund.id,
                                    amount: refund.amount / 100,
                                    currency: refund.currency,
                                    status: refund.status,
                                    charge: refund.charge
                                };

                                // Esperar y verificar el reembolso
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                const verifiedRefund = await stripe.refunds.retrieve(refund.id);
                                refundDetails.verified_status = verifiedRefund.status;
                            }
                        }
                    }
                }
            } catch (stripeError) {
                console.error('Stripe error:', stripeError);
                return res.status(500).json({
                    message: 'Stripe processing error',
                    error: stripeError.message
                });
            }
        }


        // Calcular monto de reembolso
        let refundAmount = 0;
        if (user.plan === 'premium') refundAmount = 9.99;
        if (user.plan === 'business') refundAmount = 19.99;

        // Actualizar usuario
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            {
                plan: 'free',
                subscriptionId: null,
                subscriptionStatus: null,
                subscriptionStartDate: null,
                subscriptionEndDate: null,
                isActive: true,
                $push: {
                    paymentHistory: {
                        type: 'refund',
                        amount: refundAmount,
                        date: new Date(),
                        status: refundDetails?.status || 'pending',
                        details: refundDetails || 'No refund processed',
                        stripeRefundId: refundDetails?.id
                    }
                }
            },
            { new: true }
        ).select('-password');

        // Respuesta detallada
        res.status(200).json({
            message: refundDetails ? 'Refund processed successfully' : 'Subscription canceled but no refund issued',
            refund: refundDetails,
            user: updatedUser
        });

    } catch (err) {
        console.error('Refund processing error:', err);
        res.status(500).json({
            message: 'Error processing refund',
            error: err.message
        });
    }
};

// @desc    Revoke user access
// @route   PUT /api/auth/users/:id/revoke
// @access  Private/Admin
exports.revokeAccess = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 1. Cancelar la suscripción en Stripe si existe
        if (user.subscriptionId) {
            try {
                await stripe.subscriptions.cancel(user.subscriptionId);
            } catch (stripeErr) {
                console.error('Error canceling Stripe subscription:', stripeErr);
                // No fallamos aquí, seguimos con la revocación
            }
        }

        // 2. Desactivar el usuario y resetear suscripción
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            {
                isActive: false,
                plan: 'free',
                subscriptionId: null,
                subscriptionStatus: 'canceled',
                subscriptionEndDate: new Date()
            },
            { new: true }
        ).select('-password');

        res.status(200).json({
            message: 'User access revoked successfully',
            user: updatedUser
        });
    } catch (err) {
        res.status(500).json({ message: 'Error revoking access', error: err.message });
    }
};