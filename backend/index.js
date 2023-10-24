import { config } from 'dotenv';

config();
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors'; // allows req from cross-origin
import rateLimit from 'express-rate-limit'; // limit req from clients
import session from 'express-session'; //- manage session for logged in user
import passport from 'passport'; //  for authentication
import swaggerUi from 'swagger-ui-express'; // for api documentation
import Yaml from 'yamljs';
import mongoConnect from './configs/dbConfig.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    cookie: {},
    resave: false,
    saveUninitialized: true,
  }),
);
app.use(passport.initialize());
app.use(passport.session());

app.set('trust proxy', 2);
// app.get("/ip", (request, response) => response.send(request.ip));

// -----------------API DOCS------------------------
const swaggerDocument = Yaml.load('./swagger.yml');
app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

//-----------------------------------DB-------------------------------
await mongoConnect();
//-----------------------------------DB END----------------------------

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // limit each IP to 30 requests per windowMs
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  keyGenerator: function (req) {
    return req.headers['x-forwarded-for'] || req.ip; // for nginx proxy server
  },
});

app.use(limiter); // limit number of req for each client

// -------------------------------- API ROUTES -------------------------------
import { redirectToOriginalUrl } from './controllers/urlControllers/redirectToURL.js';
import userAuthRoute from './routes/userAuth.route.js';
import adminAuthRoute from './routes/adminAuth.route.js';
import urlRoute from './routes/url.route.js';
import admin from './routes/admin.route.js';

app.use('/api', cors(), urlRoute);
app.use('/auth', cors(), userAuthRoute);
app.use('/admin/auth', cors(), adminAuthRoute);
app.use('/admin', cors(), admin);

// for accessing short url
app.get('/u/:short', redirectToOriginalUrl);

// goto /doc to see api documentation
app.get('/', (req, res) => {
  res.send(`Please goto <a href='/doc'>/doc</a> to see api documentation`);
});

app.listen(PORT, function () {
  console.log(`Listening on port ${PORT}`);
});

export { app };
