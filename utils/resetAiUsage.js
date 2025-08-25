const mongoose = require('mongoose');
const cron = require('node-cron');
const User = require('../models/User');
const config = require('../config/config');

async function resetDailyCounters() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await User.updateMany(
      {},
      { $set: { aiUsageCount: 0 } }
    );

    console.log(`[${new Date().toISOString()}] Reset AI counters for ${result.modifiedCount} users`);
  } catch (error) {
    console.error('Error resetting counters:', error);
  } finally {
    await mongoose.disconnect();
  }
}

function startResetCron() {
  console.log('Initializing daily AI usage reset cron...');
  cron.schedule('0 0 * * *', () => {
    console.log(`[${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}] Running daily reset...`);
    resetDailyCounters();
  }, {
    timezone: 'America/New_York' // Ajusta según la zona del cliente
  });
}

// resetDailyCounters()
module.exports = startResetCron;
