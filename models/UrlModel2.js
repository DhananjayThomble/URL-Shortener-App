import mongoose from "mongoose";

const urlSchema2 = new mongoose.Schema({
  userId: {
    type: String,
  },

  urlArray: {
    type: Array,
  },
});

const UrlModel2 = new mongoose.model("url_collection", urlSchema2);

export default UrlModel2;
