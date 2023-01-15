import { config } from "dotenv";

config();
import express from "express";
import bodyParser from "body-parser";
import cors from "cors"; // allow post req from cross-origin
import mongoose from "mongoose";
import apiUrlRoutes from "./routes/apiUrlRoute.js";
import urlRoutes from "./routes/urlRoute.js";
import authRoutes from "./routes/authRoute.js";
import rateLimit from "express-rate-limit"; // limit req from clients
import session from "express-session";
import passport from "passport";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
// process.cwd() is the current working directory
app.use("/public", express.static(`${process.cwd()}/public`));
app.use(bodyParser.json());
app.use(
  session({
    secret: "thisismysecret",
    cookie: {},
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());
//-----------------------------------DB-------------------------------
mongoose.set("strictQuery", false);

async function main() {
  await mongoose.connect(process.env.DB_URL);
}

main().catch((err) => console.log(err));

const db = mongoose.connection;
db.on("error", console.error.bind(console, "DB connection error!"));
db.once("open", function () {
  console.log("Connected to DB");
});
//-----------------------------------DB END----------------------------

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 15, // limit each IP to 15 requests per windowMs
  message: "Too many requests, please try again later",
  standardHeaders: true,
});

app.use(limiter);
app.use("/api", cors(), apiUrlRoutes);
app.use("/", urlRoutes);
app.use("/auth", authRoutes);
app.set("view engine", "ejs");

app.listen(PORT, function () {
  console.log(`Listening on port ${PORT}`);
});
