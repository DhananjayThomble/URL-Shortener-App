import Router from "express";

import {
  login,
  signup,
  forgotPassword,
  resetPassword
} from "../controllers/auth.controller.js";
import { validateLogin, validateSignup } from '../validators/AuthValidators.js';
import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';


const router = Router();
router.post("/login", validateLogin, validationErrorHandler, login);
router.post("/signup", validateSignup,validationErrorHandler, signup);
router.post("/forgot-password",forgotPassword);  //For Sending the password reset request
router.post("/reset-password",resetPassword);   // For Reseting the password

export default router;
