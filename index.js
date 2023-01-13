import { config } from "dotenv";

config();
import express from "express";
import bodyParser from "body-parser";
import cors from "cors"; // allow post req from cross-origin
import mongoose from "mongoose";
import rateLimit from "express-rate-limit"; // limit req from clients

const app = express();
const PORT = process.env.PORT || 3000;
import apiUrlRoutes from "./routes/apiUrlRoute.js";
import urlRoutes from "./routes/urlRoute.js";

app.use(bodyParser.urlencoded({ extended: false }));
// process.cwd() is the current working directory
app.use("/public", express.static(`${process.cwd()}/public`));
app.use(bodyParser.json());
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
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // limit each IP to 15 requests per windowMs
  message: "Too many requests, please try again later",
  standardHeaders: true,
});

app.use("/api", limiter);
app.use("/api", cors(), apiUrlRoutes);
app.use("/", urlRoutes);

app.listen(PORT, function () {
  console.log(`Listening on port ${PORT}`);
});
