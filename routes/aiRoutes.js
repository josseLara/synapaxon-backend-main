const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');

// Ruta GET para validar y actualizar el límite de IA
router.get('/validate-limit-ai', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    // Verificar si ha alcanzado el límite diario
    if (user.aiUsageCount >= user.aiUsageLimit) {
      return res.status(429).json({
        success: false,
        error: `Has alcanzado tu límite diario de uso de IA (${user.aiUsageLimit}). Por favor actualiza tu plan o intenta nuevamente mañana.`
      });
    }

    // Incrementar el contador de uso
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { aiUsageCount: 1 } },
      { new: true }
    );

    // Devolver la información actualizada
    res.status(200).json({
      success: true,
      data: {
        remainingUses: updatedUser.aiUsageLimit - updatedUser.aiUsageCount,
        currentUses: updatedUser.aiUsageCount,
        limit: updatedUser.aiUsageLimit
      }
    });

  } catch (error) {
    console.error('Error en validate-limit-ai:', error);
    res.status(500).json({
      success: false,
      error: 'Error del servidor al validar el límite de IA'
    });
  }
});

module.exports = router;