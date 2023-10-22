
import mongoose from "mongoose";
const feedbackSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference to the User model
    required: true,
  },
  message: String,
    rating: Number,
  });

const Feedback = mongoose.model('Feedback', feedbackSchema);

// Middleware to parse JSON data


export default Feedback;