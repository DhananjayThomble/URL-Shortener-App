import Router from 'express';

const router = Router();

import { isApiAuthenticated } from '../middlewares/authMiddleware.js';
import { isAdmin } from '../middlewares/isAdmin.js';
import { getReviews } from '../controllers/feedbackControllers/reviews.js';
import {
  deleteAllFeedback,
  deleteReview,
} from '../controllers/adminControllers/manageReviews.js';

// Feedback Routes
router.get('/reviews', isApiAuthenticated, isAdmin, getReviews);
router.delete('/reviews/:_id', isApiAuthenticated, isAdmin, deleteReview);
router.delete('/reviews', isApiAuthenticated, isAdmin, deleteAllFeedback);

export default router;
