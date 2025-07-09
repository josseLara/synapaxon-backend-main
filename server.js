// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const passport = require('./config/passport');
const config = require('./config/config');
const connectDB = require('./config/db');
const errorHandler = require('./utils/errorHandler');
const resetLimitIa = require('./utils/resetAiUsage');

// Import routes
const authRoutes = require('./routes/auth');
const questionRoutes = require('./routes/questions');
const testRoutes = require('./routes/tests');
const uploadRoutes = require('./routes/uploads');
const studentQuestionRoutes = require('./routes/studentQuestions');
const apiAiRoutes = require('./routes/aiRoutes')
const subscriptionRoutes = require('./routes/subscriptionRoutes')
const app = express();

// Connect to database
connectDB();

// Middleware
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://synapaxon-frontend.onrender.com',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8000',
      'https://synapaxon-backend.onrender.com',
      'https://synapaxon-frontend-main.vercel.app',
      'https://synapaxon-backend-main.vercel.app',
      'http://synapaxon.com',
      'https://synapaxon.com',
      'http://synapaxon-backend-sigma.vercel.app',
      'https://synapaxon-backend-sigma.vercel.app',
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};


app.use(cors(corsOptions));
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
require('./config/passport'); // Load Passport configuration

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/student-questions', studentQuestionRoutes);
app.use('/api/ai', apiAiRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
app.use(errorHandler);

const PORT = config.PORT || 9000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app; // For testing purposes