import Router from "express";
import { isApiAuthenticated } from "../middlewares/authMiddleware.js";
import { login } from "../controllers/authControllers/login.controller.js"
import { signup } from "../controllers/authControllers/signup.controller.js"
import { forgotPassword } from "../controllers/authControllers/forgotPassword.controller.js"
import { resetPassword } from "../controllers/authControllers/resetPassword.controller.js"
import { verifyEmail } from "../controllers/authControllers/verifyEmail.controller.js"
import { validateLogin, validateSignup, forgetPasswordValidator } from '../validators/AuthValidators.js';
import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';
import { validateFeedback } from "../validators/FeedbackValidator.js";
import { submitFeedback } from "../controllers/FeedbackControllers/feedback.controller.js";
const router = Router();
router.post("/login", validateLogin, validationErrorHandler, login);
router.post("/signup", validateSignup, validationErrorHandler, signup);
router.post("/forgot-password", forgetPasswordValidator, validationErrorHandler, forgotPassword);  //For Sending the password reset request
router.post("/reset-password", resetPassword);   // For Reseting the password
router.get("/verify-email", verifyEmail);
router.post("/login/feedback", isApiAuthenticated, validateFeedback, validationErrorHandler, submitFeedback);

export default router;