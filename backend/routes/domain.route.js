import { Router } from 'express';
import { isApiAuthenticated } from '../middlewares/authMiddleware.js';
import { addCustomDomain } from '../controllers/domainControllers/addCustomDomain.js';

const router = Router();

router.use(isApiAuthenticated);

router.post('/add-custom-domain', addCustomDomain);

export default router;
