
import mongoose from "mongoose";
const feedbackSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
      type: String,
      required: true,
    },
  message: String,
    rating: Number,
  });

const Feedback = mongoose.model('Feedback', feedbackSchema);

// Middleware to parse JSON data


export default Feedback;