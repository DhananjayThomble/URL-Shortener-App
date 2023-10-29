import { check } from 'express-validator';
export const validateUrl = [check('url').isURL().withMessage('Invalid URL')];

export const validateShortId = [
  check('short').isLength({ min: 10, max: 10 }).withMessage('Invalid URL'),
];
