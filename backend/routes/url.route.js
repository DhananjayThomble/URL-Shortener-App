import Router from "express";
import { validateUrl } from "../validators/UrlValidators.js";
import { redirectToOriginalUrl } from "../controllers/urlControllers/redirectToOriginalUrl.controller.js";
import { deleteUrl } from "../controllers/urlControllers/deleteUrl.controller.js"
import { getHistory } from "../controllers/urlControllers/getHistory.controller.js"
import { generateShortUrl } from "../controllers/urlControllers/generateShortUrl.controller.js"
import { exportGeneratedUrls } from "../controllers/urlControllers/exportGeneratedUrls.controller.js"
import { isApiAuthenticated } from "../middlewares/authMiddleware.js";

const router = Router();

// old route for backward compatibility
router.get("/url/:shortUrl", redirectToOriginalUrl);

//generate short url
router.post("/url", isApiAuthenticated, validateUrl, generateShortUrl);

//get list of shortened urls and number of visits
router.get("/history", isApiAuthenticated, getHistory);

//delete a short url and its associated information from database
router.delete("/delete/:shortUrlId", isApiAuthenticated, deleteUrl);

//export data on generated urls
router.get("/export", isApiAuthenticated, exportGeneratedUrls);

export default router;