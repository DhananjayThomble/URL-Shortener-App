import mongoose from "mongoose";

const urlSchema2 = new mongoose.Schema({
  userId: {
    type: String,
  },

  urlArray: [
    {
      shortUrl : { type : String },
      originalUrl : { type : String },
      VisitCount : { 
        type : Number,
        default : 0
      }
    }
  ]
});

const UrlModel2 = new mongoose.model("url_collection", urlSchema2);

export default UrlModel2;
