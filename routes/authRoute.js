import express from "express";
import User from "../models/UserModel.js";
import passport from "../authentication/passport.js";

const router = express.Router();

router.get("/signup", (req, res) => {
  res.render("signup");
});

router.get("/login", (req, res) => {
  res.render("login");
});

router.post("/signup", (req, res) => {
  const { email, password, re_password } = req.body;
  if (password !== re_password) {
    res.send("Passwords must be same");
    return;
  }
  const user = new User({ email, password });
  user.save((err) => {
    if (err) {
      // handle error
      console.log(err);
    } else {
      req.login(user, (err) => {
        if (err) {
          console.log(err);
          // handle error
        } else {
          res.json({ msg: "Success" });
        }
      });
    }
  });
});

router.get("/test", (req, res) => {
  res.json({ msg: "Yup!" });
});

router.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/auth/test",
    failureRedirect: "/auth/login",
  })
);

router.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

export default router;
