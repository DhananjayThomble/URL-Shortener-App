import { config } from "dotenv";

config();
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import mongoose from "mongoose";

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

app.use("/api", cors(), apiUrlRoutes);
app.use("/", urlRoutes);

app.listen(PORT, function () {
  console.log(`Listening on port ${PORT}`);
});
