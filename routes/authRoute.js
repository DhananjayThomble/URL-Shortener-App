import express from "express";
import User from "../models/UserModel.js";
import passport from "../authentication/passport.js";

const router = express.Router();

router.get("/signup", (req, res) => {
  res.sendFile(process.cwd() + "/views/signup.html");
});

router.get("/login", (req, res) => {
  res.sendFile(process.cwd() + "/views/login.html");
});

router.post("/signup", (req, res) => {
  const { email, password } = req.body;
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

export default router;
