import passport from 'passport';
import LocalStrategy from 'passport-local';
import User from '../models/UserModel.js';

// Configure the local strategy for passport
passport.use(
  new LocalStrategy(
    { usernameField: 'email' }, // use the email field as the username
    (email, password, done) => {
      // Find the user with the given email
      User.findOne({ email: email }, (err, user) => {
        if (err) {
          return done(err);
        }
        if (!user) {
          return done(null, false, { message: 'Incorrect email.' });
        }
        // Check if the password is correct
        user.comparePassword(password, (err, isMatch) => {
          if (err) {
            return done(err);
          }
          if (!isMatch) {
            return done(null, false, { message: 'Incorrect password.' });
          }
          return done(null, user);
        });
      });
    },
  ),
);

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

export default passport;
