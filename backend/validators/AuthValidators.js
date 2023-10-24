import { body } from "express-validator";
import  User  from '../models/UserModel.js';

export const validateLogin = [
    body("email")
        .notEmpty()
        .trim()
        .escape()
        .isEmail()
        .withMessage("Invalid email"),
    body("password")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Password is required"),
];

export const validateSignup = [
    body("name")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Name is required"),
    body("email")
        .notEmpty()
        .trim()
        .escape()
        .isEmail()
        .withMessage("Invalid email format")
        .bail()
        .custom(async (value) => {
            const user = await User.findOne({ email: value });
            if (user) {
                throw new Error("Email already in use");
            }
        }),
    // body("mobileNumber")
    //     .notEmpty()
    //     .trim()
    //     .escape()
    //     .isMobilePhone("en-IN")
    //     .withMessage("Invalid mobile number format")
    //     .bail()
    //     .custom(async (value) => {
    //         const user = await User.findOne({ mobileNumber: value });
    //         if (user) {
    //             throw new Error("Mobile number already in use");
    //         }
    //     }),
    body("password")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Password is required")
        .isLength({ min: 6 })
        .withMessage("Password must be at least 6 characters long")
    // body("confirmPassword")
    //     .notEmpty()
    //     .trim()
    //     .escape()
    //     .withMessage("Confirm password is required")
    //     .bail()
    //     .custom((value, { req }) => {
    //         if (value !== req.body.password) {
    //             throw new Error("Passwords do not match");
    //         }
    //         return true;
    //     }),
];


// validator for the forgot password
export const forgetPasswordValidator=[
    body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Invalid Email Address")
]

export const validateName = [
    body("name")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Name is required")
        .bail()
        .isLength({ min: 3 })
        .withMessage("Name must be at least 3 characters long"),
];

export const validateEmail = [
    body("email")
        .notEmpty()
        .trim()
        .escape()
        .withMessage("Email is required")
        .bail()
        .isEmail()
        .withMessage("Invalid email format")
        .bail()
        .custom(async (value) => {
            const user = await User.findOne({ email: value });
            if (user) {
                throw new Error("Email already in use");
            }
        }),
];


