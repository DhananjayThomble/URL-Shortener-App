// Route for submitting feedback
import {  validationResult } from 'express-validator';
import Feedback from '../../models/Feedback.js'
import User from "../../models/UserModel.js";
export const submitFeedback = async (req, res) => {
  try {
    // Implement validation using express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    //search for userid which is refering to user model to extract email and name from user model
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Destructure name and email from user
    const { name, email } = user;
    // Destructure data from the request body
   
    const { message, rating } = req.body;

   
    

    // Create a new feedback instance with email, username, message, and rating
    const feedback = new Feedback({ name ,email,  message, rating });
    await feedback.save();

    return res.status(200).send('Feedback submitted successfully.');
  } catch (error) {
    console.error(error);
    return res.status(500).send('Feedback submission failed.');
  }
};
