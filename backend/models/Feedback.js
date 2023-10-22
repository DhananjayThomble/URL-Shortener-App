const feedbackSchema = new mongoose.Schema({
    message: String,
    rating: Number,
  });

const Feedback = mongoose.model('Feedback', feedbackSchema);

// Middleware to parse JSON data


export default Feedback;