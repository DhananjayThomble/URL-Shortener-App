import mongoose from 'mongoose';

const LinkInBioPageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  pageTitle: {
    type: String,
    required: true,
  },
  links: [
    {
      title: String,
      url: String,
      description: String,
    },
  ],
});

const LinkInBioPage = mongoose.model('LinkInBioPage', LinkInBioPageSchema);

export default LinkInBioPage;
