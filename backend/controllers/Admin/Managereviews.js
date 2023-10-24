import Feedback from '../../models/Feedback.js'

export const deleteReview = async (req, res) => {
    const reviewId = req.params;

    try {
        const deletedReview = await Feedback.deleteOne(reviewId);

        if (!deletedReview) {
        
            return res.status(404).json({ error: "Review not found" });
        }
            
        return res.status(200).json({ message: "Review deleted successfully" });
       

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Server error" });
    }
};

 export const deleteAllFeedback = async (req,res) => {
    try {
      const result = await Feedback.deleteMany({});
      if(result)
      {
        res.status(200).json({ message: "All feedback deleted successfully" });
      }
      console.log(`Deleted ${result.deletedCount} documents`);
    } catch (error) {
      console.error(error);
    }
  };