

// Route for submitting feedback
import { body, validationResult } from 'express-validator';
import Feedback from '../models/Feedback'; // Import your Feedback model
app.use(body);
export const submitFeedback = async (req, res) => {
  try {
    // Implement validation using express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Destructure data from the request body
    const { message, rating } = req.body;

    // Create a new feedback instance and save it to the database
    const feedback = new Feedback({ message, rating });
    await feedback.save();

    return res.status(200).send('Feedback submitted successfully.');
  } catch (error) {
    console.error(error);
    return res.status(500).send('Feedback submission failed.');
  }
};
