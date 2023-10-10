import Router from "express";

import {
  validateUrl,
  redirectToOriginalUrl,
  deleteUrl,
  getHistory,
  generateShortUrl,
  exportGeneratedUrls,
} from "../controllers/url.controller.js";

import { isApiAuthenticated } from "../middlewares/authMiddleware.js";

const router = Router();

// old route for backward compatibility
router.get("/url/:short", redirectToOriginalUrl);

router.post("/url", isApiAuthenticated, validateUrl, generateShortUrl);

router.get("/history", isApiAuthenticated, getHistory);

router.delete("/delete/:id", isApiAuthenticated, deleteUrl);

router.get("/export", isApiAuthenticated, exportGeneratedUrls);

export default router;
