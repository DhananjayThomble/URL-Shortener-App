import Router from 'express';

const router = Router();

import { redirectToOriginalUrl } from '../controllers/urlControllers/redirectToURL.js';
import { deleteUrl } from '../controllers/urlControllers/deleteUrl.js';
import { getHistory } from '../controllers/urlControllers/getHistory.js';
import { generateShortUrl } from '../controllers/urlControllers/generateShortUrl.js';
import { exportGeneratedUrls } from '../controllers/urlControllers/exportGeneratedUrls.js';
import { generateCustomBackHalf } from '../controllers/urlControllers/generateCustomBackHalf.js';
import { validateUrl } from '../validators/urlValidator.js';

import { isApiAuthenticated } from '../middlewares/authMiddleware.js';
import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';
import {
  getFilteredCategory,
  updateCategory,
} from '../controllers/urlControllers/category.js';

// old route for backward compatibility
router.get('/url/:short', redirectToOriginalUrl);

router.post(
  '/url',
  isApiAuthenticated,
  validateUrl,
  validationErrorHandler,
  generateShortUrl,
);

router.post('/url/custom', isApiAuthenticated, generateCustomBackHalf);

router.get('/history', isApiAuthenticated, getHistory);

router.delete('/delete/:id', isApiAuthenticated, deleteUrl);

router.get('/export', isApiAuthenticated, exportGeneratedUrls);

router.get('/filter/:category', isApiAuthenticated, getFilteredCategory);

router.put('/filter', isApiAuthenticated, updateCategory);

export default router;
