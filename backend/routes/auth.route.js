import Router from "express";

import {
  login,
  signup,
} from "../controllers/auth.controller.js";
import { validateLogin, validateSignup } from '../validators/AuthValidators.js';
import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';


const router = Router();
router.post("/login", validateLogin, validationErrorHandler, login);

router.post("/signup", validateSignup,validationErrorHandler, signup);

export default router;
