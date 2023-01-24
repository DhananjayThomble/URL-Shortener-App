import mongoose from "mongoose";
import bcrypt from "bcrypt";

const saltRounds = 10; // affect the performance and password security level

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
});

// Hash pass before saving
UserSchema.pre("save", function (next) {
  console.log("schema: ", this);
  const user = this;
  if (!user.isModified("password")) return next(); //todo: look at this

  bcrypt.genSalt(saltRounds, function (err, salt) {
    if (err) return next(err);

    bcrypt.hash(user.password, salt, (err, hash) => {
      if (err) return next(err);

      user.password = hash;
      next();
    });
  });
});

//  compare the pass
UserSchema.methods.comparePassword = function (password, result) {
  bcrypt.compare(password, this.password, (err, isMatched) => {
    if (err) return result(err);

    result(null, isMatched);
  });
};

const User = mongoose.model("User", UserSchema);

export default User;
