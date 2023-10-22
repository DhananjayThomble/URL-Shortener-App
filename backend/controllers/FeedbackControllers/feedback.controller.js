// Route for submitting feedback
import {  validationResult } from 'express-validator';
import Feedback from '../../models/Feedback.js'

export const submitFeedback = async (req, res) => {
  try {
    // Implement validation using express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    console.log('req.user:', req.user);
    const  userId = req.user._id;
    // Destructure data from the request body
   
    const { message, rating } = req.body;

    // Get user's email and username from their login credentials
    

    // Create a new feedback instance with email, username, message, and rating
    const feedback = new Feedback({ userId,  message, rating });
    await feedback.save();

    return res.status(200).send('Feedback submitted successfully.');
  } catch (error) {
    console.error(error);
    return res.status(500).send('Feedback submission failed.');
  }
};
