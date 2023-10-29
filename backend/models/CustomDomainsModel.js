import mongoose from 'mongoose';

const customDomainSchema = new mongoose.Schema({
  url: {
    type: String,
    required: [true, 'Please provide a valid url value'],
  },
  dnsVerificationCode: {
    type: String,
    default: null,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
});

const CustomDomain = mongoose.model('CustomDomain', customDomainSchema);

export default CustomDomain;
