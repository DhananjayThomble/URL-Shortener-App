import Router from 'express';

const router = Router();

import { isApiAuthenticated } from '../middlewares/authMiddleware.js';

import { login } from '../controllers/authControllers/login.js';
import { signup } from '../controllers/authControllers/signup.js';
import { forgotPassword } from '../controllers/authControllers/forgotPassword.js';
import { resetPassword } from '../controllers/authControllers/resetPassword.js';
import { verifyEmail } from '../controllers/authControllers/verifyEmail.js';
import {
  validateLogin,
  validateSignup,
  forgetPasswordValidator,
} from '../validators/authValidators.js';

import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';

import { validateFeedback } from '../validators/feedbackValidator.js';
import { submitFeedback } from '../controllers/feedbackControllers/feedback.js';

import { changeEmail } from '../controllers/authControllers/changeEmail.js';
import { getCurrentUser } from '../controllers/authControllers/getCurrentUser.js';
import { changeName } from '../controllers/authControllers/changeName.js';
import { validateEmail } from '../validators/authValidators.js';
import { validateName } from '../validators/authValidators.js';
import { validateToken } from '../validators/authValidators.js';

// Auth Routes
router.post('/login', validateLogin, validationErrorHandler, login);
router.post('/signup', validateSignup, validationErrorHandler, signup);
router.post(
  '/forgot-password',
  forgetPasswordValidator,
  validationErrorHandler,
  forgotPassword,
); //For Sending the password reset request
router.post('/reset-password', resetPassword); // For Reseting the password
router.get('/verify-email', validateToken, validationErrorHandler, verifyEmail);

// Profile Routes
router.get('/current-user', getCurrentUser);
router.patch(
  '/change-email',
  validateEmail,
  validationErrorHandler,
  changeEmail,
);
router.patch('/change-name', validateName, validationErrorHandler, changeName);

/*Feedback Routes*/
router.post(
  '/feedback',
  isApiAuthenticated,
  validateFeedback,
  validationErrorHandler,
  submitFeedback,
);

export default router;
