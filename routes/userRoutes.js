const express = require('express');
const {
  getUsers,
  getUser,
  updateUser,
  processRefund,
  revokeAccess
} = require('../controllers/userController');

const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Set up routes
router
  .route('/')
  .get(protect, getUsers);

router
  .route('/:id')
  .get(protect, getUser)
  .put(protect, updateUser);

router
  .route('/:id/refund')
  .post(protect, processRefund);

router
  .route('/:id/revoke')
  .put(protect, revokeAccess);

module.exports = router;