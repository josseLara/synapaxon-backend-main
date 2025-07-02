const express = require('express')
const router = express.Router()
const stripe = require('stripe')(process.env.STRIPE_KEY)
const { protect } = require('../middleware/authMiddleware')
const User = require('../models/User')

// Objeto para almacenar los IDs de precios
const stripeProducts = {
  free: null,
  pro: null,
  premium: null
}

// Verificar y crear productos en Stripe al iniciar
async function initializeStripeProducts() {
  try {
    // 1. Verificar si los productos ya existen
    const existingProducts = await stripe.products.list({ limit: 100 })
    const existingPrices = await stripe.prices.list({ limit: 100 })

    // 2. Crear productos faltantes
    // Producto Free (solo para referencia, no tiene precio)
    let freeProduct = existingProducts.data.find(p => p.name === 'Plan Free')
    if (!freeProduct) {
      freeProduct = await stripe.products.create({
        name: 'Plan Free',
        description: 'Ideal para estudiantes que recién comienzan',
      })
    }
    stripeProducts.free = freeProduct.id

    // Producto Pro
    let proProduct = existingProducts.data.find(p => p.name === 'Plan Pro')
    if (!proProduct) {
      proProduct = await stripe.products.create({
        name: 'Plan Pro',
        description: 'Para estudiantes serios que necesitan más recursos',
      })
    }

    // Precio Pro
    let proPrice = existingPrices.data.find(
      p => p.product === proProduct.id && p.recurring?.interval === 'month'
    )
    if (!proPrice) {
      proPrice = await stripe.prices.create({
        product: proProduct.id,
        unit_amount: 900, // $9.99
        currency: 'usd',
        recurring: { interval: 'month' },
      })
    }
    stripeProducts.pro = proPrice.id

    // Producto Premium
    let premiumProduct = existingProducts.data.find(p => p.name === 'Plan Premium')
    if (!premiumProduct) {
      premiumProduct = await stripe.products.create({
        name: 'Plan Premium',
        description: 'Para profesionales que necesitan máximo rendimiento',
      })
    }

    // Precio Premium
    let premiumPrice = existingPrices.data.find(
      p => p.product === premiumProduct.id && p.recurring?.interval === 'month'
    )
    if (!premiumPrice) {
      premiumPrice = await stripe.prices.create({
        product: premiumProduct.id,
        unit_amount: 2900, // $19.99
        currency: 'usd',
        recurring: { interval: 'month' },
      })
    }
    stripeProducts.premium = premiumPrice.id

    console.log('Stripe products initialized successfully')
  } catch (error) {
    console.error('Error initializing Stripe products:', error)
    throw error
  }
}

// Inicializar productos al cargar el módulo
initializeStripeProducts().catch(err => {
  console.error('Failed to initialize Stripe products:', err)
})

// Obtener el precio ID basado en el plan
async function getPriceId(planId) {
  // Usamos nuestro objeto cacheado
  if (planId === 'pro' && stripeProducts.pro) {
    return stripeProducts.pro
  }
  if (planId === 'premium' && stripeProducts.premium) {
    return stripeProducts.premium
  }
  throw new Error('Price not found for plan: ' + planId)
}

// Crear sesión de checkout
router.post('/checkout', protect, async (req, res) => {
  try {
    const { planId } = req.body

    // Validar planId
    if (!['pro', 'premium'].includes(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' })
    }

    const user = await User.findById(req.user.id)

    // Crear customer en Stripe si no existe
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() }
      })
      user.stripeCustomerId = customer.id
      await user.save()
    }

    // Cancelar todas las suscripciones activas primero
    const activeSubscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'active'
    })

    for (const sub of activeSubscriptions.data) {
      await stripe.subscriptions.cancel(sub.id)
    }

    const priceId = await getPriceId(planId)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      customer: user.stripeCustomerId,
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?canceled=true`,
      metadata: { planId }
    })

    res.json({ sessionId: session.id })
  } catch (error) {
    console.error('Checkout error:', error)
    res.status(500).json({
      error: error.message,
      details: error.response?.data || error.stack
    })
  }
})

router.post('/switch-to-free', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    if (!user.stripeCustomerId) {
      // Si no tiene customer en Stripe, simplemente actualizamos a free
      user.plan = 'free'
      user.subscriptionStatus = null
      await user.save()
      return res.json({ success: true })
    }

    // Cancelar todas las suscripciones activas
    const activeSubscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'active'
    })

    for (const sub of activeSubscriptions.data) {
      await stripe.subscriptions.cancel(sub.id)
    }

    // Actualizar usuario a plan free
    user.plan = 'free'
    user.aiUsageLimit = 5 // Asignar límite de uso para el plan free
    user.subscriptionStatus = null
    await user.save()

    res.json({ success: true })
  } catch (error) {
    console.error('Switch to free error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Webhook para manejar eventos de Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']
  const endpointSecret = process.env.STRIPE_WEBHOOK || "";
  let event;

  try {
    // Verificar la firma del webhook con el cuerpo RAW
    event = stripe.webhooks.constructEvent(
      req.body, // Asegúrate de convertir a string
      sig,
      endpointSecret
    );
  } catch (err) {
    console.error('Webhook error:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object)
      break
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object)
      break
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object)
      break
    default:
      console.log(`Unhandled event type ${event.type}`)
  }

  res.json({ received: true })
})

// Resto de las funciones helper (handleCheckoutCompleted, handleSubscriptionDeleted, etc.)
async function handleCheckoutCompleted(session) {
  const customerId = session.customer
  const planId = session.metadata.planId

  const user = await User.findOne({ stripeCustomerId: customerId })
  if (!user) return

  user.plan = planId
  user.aiUsageLimit = planId === 'pro' ? 50 : planId === 'premium' ? 100 : 5; // Ejemplo de límites
  user.subscriptionStatus = 'active'
  await user.save()
}

async function handleSubscriptionDeleted(subscription) {
  const user = await User.findOne({ stripeCustomerId: subscription.customer })
  if (!user) return

  user.plan = 'free'
  user.subscriptionStatus = null
  await user.save()
}

async function handlePaymentSucceeded(invoice) {
  // Puedes enviar un email de confirmación aquí
}

async function handlePaymentFailed(invoice) {
  const user = await User.findOne({ stripeCustomerId: invoice.customer })
  if (!user) return

  // Enviar notificación al usuario
}

async function handleSubscriptionUpdated(subscription) {
  const user = await User.findOne({ stripeCustomerId: subscription.customer });
  if (!user) return;

  await user.save();
}

// Obtener suscripción actual
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    // Si el usuario no tiene plan, asignar free por defecto
    if (!user.plan) {
      user.plan = 'free'
      await user.save()
    }

    res.json({
      subscription: {
        plan: user.plan,
        status: user.subscriptionStatus || 'active'
      }
    })
  } catch (error) {
    console.error('Get subscription error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Cancelar suscripción
router.delete('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No active subscription' })
    }

    // Obtener la suscripción activa
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'active',
      limit: 1
    })

    if (subscriptions.data.length === 0) {
      return res.status(400).json({ error: 'No active subscription' })
    }

    // Cancelar en Stripe (al final del periodo de facturación)
    await stripe.subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true
    })

    // Actualizar usuario
    user.subscriptionStatus = 'canceled'
    await user.save()

    res.json({
      success: true,
      message: 'Subscription will be canceled at the end of the billing period'
    })
  } catch (error) {
    console.error('Cancel subscription error:', error)
    res.status(500).json({ error: error.message })
  }
})

module.exports = router