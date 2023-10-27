import mongoose from 'mongoose';

const urlSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    shortUrl: {
      type: String,
      index: true,
      uniuque: true,
    },
    originalUrl: { type: String },
    category: {
      type: String,
      index: true,
    },
    visitCount: {
      type: Number,
      default: 0,
      index: { order: -1 }, // this will help to get top visited urls, for sorting
    },
    customUrl: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

const UrlModel = new mongoose.model('url_collection', urlSchema);

export default UrlModel;
