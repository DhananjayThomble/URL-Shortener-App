import { Router } from 'express';
import { isApiAuthenticated } from '../middlewares/authMiddleware.js';
import { addCustomDomain } from '../controllers/domainControllers/addCustomDomain.js';
import { verifyCustomDomain } from '../controllers/domainControllers/verifyCustomDomain.js';

const router = Router();

router.use(isApiAuthenticated);

router.post('/add-custom-domain', addCustomDomain);
router.get('/verify-custom-domain', verifyCustomDomain);

export default router;
