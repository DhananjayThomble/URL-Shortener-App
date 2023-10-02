import mongoose from "mongoose";

// Creating Schema
const urlSchema = new mongoose.Schema({
  shortUrl: String,
  originalUrl: String,
});

// Creating model
export const UrlModel = mongoose.model("url", urlSchema);

export default UrlModel;
