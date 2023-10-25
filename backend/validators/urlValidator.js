import { check } from 'express-validator';
export const validateUrl = [check('url').isURL().withMessage('Invalid URL')];
