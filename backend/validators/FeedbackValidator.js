import { body } from "express-validator";
export const validateFeedback = [
    body("message")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Message is required"),
    body("rating")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Rating is required")
        .isInt({ min: 1, max: 5 })
        .withMessage("Rating must be between 1 and 5")
];
