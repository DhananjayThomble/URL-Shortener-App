import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const saltRounds = 10; // Affects the performance and password security level

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },

  password: {
    type: String,
    required: true,
  },

  name: {
    type: String,
    required: true,
  },

  isEmailVerified: {
    type: Boolean,
    default: false, // Initially, the email is not verified
  },
});

// Hash the password before saving
UserSchema.pre('save', function (next) {
  const user = this;
  if (!user.isModified('password')) return next();

  bcrypt.genSalt(saltRounds, function (err, salt) {
    if (err) return next(err);

    bcrypt.hash(user.password, salt, (err, hash) => {
      if (err) return next(err);

      user.password = hash;
      next();
    });
  });
});

// Compare the password
UserSchema.methods.comparePassword = function (password, callback) {
  bcrypt.compare(password, this.password, (err, isMatch) => {
    if (err) return callback(err);
    callback(null, isMatch);
  });
};

// Add a reference to the LinkInBioPage model
UserSchema.virtual('linkInBioPage', {
  ref: 'LinkInBioPage',
  localField: '_id',
  foreignField: 'userId',
  justOne: true,
});

const User = mongoose.model('User', UserSchema);

export default User;
