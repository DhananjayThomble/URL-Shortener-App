import Router from "express";

import {
  validateLogin,
  validateSignup,
  login,
  signup,
} from "../controllers/auth.controller.js";

const router = Router();
router.post("/login", validateLogin, login);

router.post("/signup", validateSignup, signup);

export default router;
