import Router from 'express';

const router = Router();

import {
  forgetPasswordValidator,
  validateLogin,
  validateSignup,
} from '../validators/authValidators.js';

import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';
import { adminLogin } from '../controllers/adminControllers/adminLogin.js';
import { adminSignup } from '../controllers/adminControllers/adminSignup.js';
import { adminForgotPassword } from '../controllers/adminControllers/adminForgotPassword.js';
import { adminResetPassword } from '../controllers/adminControllers/adminResetPassword.js';
import { adminVerifyEmail } from '../controllers/adminControllers/adminVerifyEmail.js';
import { isApiAuthenticated } from '../middlewares/authMiddleware.js';

// Auth Routes
router.post('/login', validateLogin, validationErrorHandler, adminLogin);
router.post('/signup', validateSignup, validationErrorHandler, adminSignup);
router.post(
  '/forgot-password',
  forgetPasswordValidator,
  validationErrorHandler,
  adminForgotPassword,
); //For Sending the password reset request
router.post('/reset-password', adminResetPassword); // For Reseting the password
router.get('/verify-email', adminVerifyEmail);

export default router;
