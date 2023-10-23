import Router from "express";

import { isApiAuthenticated } from "../middlewares/authMiddleware.js";

import { login } from "../controllers/authControllers/login.controller.js"
import { signup } from "../controllers/authControllers/signup.controller.js"
import { forgotPassword } from "../controllers/authControllers/forgotPassword.controller.js"
import { resetPassword } from "../controllers/authControllers/resetPassword.controller.js"
import { verifyEmail } from "../controllers/authControllers/verifyEmail.controller.js"
import { validateLogin, validateSignup, forgetPasswordValidator } from '../validators/AuthValidators.js';
import { validationErrorHandler } from '../middlewares/ValidatorErrorHandler.js';

import { validateFeedback } from "../validators/FeedbackValidator.js";
import { submitFeedback } from "../controllers/FeedbackControllers/feedback.controller.js";
import { getreviews } from "../controllers/FeedbackControllers/reviews.controller.js";
import { Adminlogin } from "../controllers/Admin/Adminlogin.js"
import { Adminsignup } from "../controllers/Admin/Adminsignup.js"
import { AdminforgotPassword } from "../controllers/Admin/Adminforgot.js"
import { AdminresetPassword } from "../controllers/Admin/AdminresetPassword.js"
import { AdminverifyEmail } from "../controllers/Admin/Admin_verifyEmail.js"
import { deleteReview,deleteAllFeedback } from "../controllers/Admin/Managereviews.js"
import { isAdmin } from "../middlewares/isAdmin.js";

import { changeEmail } from "../controllers/CurrentUserController/changeEmail.controller.js";
import { getCurrentUser } from "../controllers/CurrentUserController/getCurrentUser.controller.js";
import { changeName } from "../controllers/CurrentUserController/changeName.controller.js";
import { validateEmail } from "../validators/AuthValidators.js";
import { validateName } from "../validators/AuthValidators.js";



const router = Router();
router.post("/login", validateLogin, validationErrorHandler, login);
router.post("/signup", validateSignup, validationErrorHandler, signup);
router.post("/forgot-password", forgetPasswordValidator, validationErrorHandler, forgotPassword);  //For Sending the password reset request
router.post("/reset-password", resetPassword);   // For Reseting the password
router.get("/verify-email", verifyEmail);

/*Feedback Routes*/
router.post("/login/feedback", isApiAuthenticated, validateFeedback, validationErrorHandler, submitFeedback);
router.get("/reviews", isApiAuthenticated, getreviews );
/*Admin Routes*/
router.post("/Admin/login", validateLogin, validationErrorHandler, Adminlogin);
router.post("/Admin/signup", validateSignup, validationErrorHandler, Adminsignup);
router.post("/Admin/forgot-password", forgetPasswordValidator, validationErrorHandler, AdminforgotPassword);  //For Sending the password reset request
router.post("/Admin/reset-password", AdminresetPassword);   // For Reseting the password
router.get("/Admin/verify-email", AdminverifyEmail);
/*Admin Feedback Routes*/
router.get("/Admin/reviews", isApiAuthenticated,isAdmin, getreviews );
router.delete("/Admin/reviews/:_id", isApiAuthenticated,isAdmin, deleteReview );
/*Admin Delete All Feedback*/
router.delete("/Admin/reviews", isApiAuthenticated, isAdmin, deleteAllFeedback);

router.get("/current-user" , getCurrentUser)
router.patch("/change-email" , validateEmail, validationErrorHandler, changeEmail)
router.patch("/change-name" , validateName, validationErrorHandler, changeName)

export default router;

