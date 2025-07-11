// User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  password: {
    type: String,
    required: [
      function () {
        return !this.googleId; // Password required only if googleId is not set
      },
      'Please provide a password'
    ],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't return password in queries by default
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allows null values while maintaining uniqueness
  },
  role: {
    type: String,
    enum: ['student'],
    default: 'student'
  },
  stripeCustomerId: {
    type: String,
    default: null
  },
  subscriptionId: {
    type: String,
    default: null
  },
  subscriptionStatus: {
    type: String,
    default: null
  },
  subscriptionStartDate: {
    type: Date,
    default: null
  },
  subscriptionEndDate: {
    type: Date,
    default: null
  },
  plan: {
    type: String,
    enum: ['free', 'pro', 'premium'],
    default: 'free'
  },
  aiUsageCount: {
    type: Number,
    default: 0
  },
  aiUsageLimit: {
    type: Number,
    default: 5 // Puedes ajustar según el plan
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Encrypt password using bcrypt before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next(); // Skip hashing if no password is provided (e.g., Google auth)
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Plan user
UserSchema.statics.getLimitsByPlan = function (plan) {
  const limits = {
    free: {
      aiUsageLimit: 5,
      uploadLimit: 5,
      agentLimit: 5
    },
    pro: {
      aiUsageLimit: 50,
      uploadLimit: 50,
      agentLimit: 20
    },
    premium: {
      aiUsageLimit: 100,
      uploadLimit: 100,
      agentLimit: 50
    }
  };

  return limits[plan] || limits.free;
};
// Sign JWT and return
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRE }
  );
};

// Match user entered password to hashed password in database
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);