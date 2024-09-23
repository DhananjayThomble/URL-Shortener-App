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
import {
  redirectToOriginalUrl,
  redirectViaCustomBackHalf,
} from './controllers/urlControllers/redirectToURL.js';
import { validateShortId } from './validators/urlValidator.js';
import { validationErrorHandler } from './middlewares/ValidatorErrorHandler.js';
import userAuthRoute from './routes/userAuth.route.js';
import adminAuthRoute from './routes/adminAuth.route.js';
import urlRoute from './routes/url.route.js';
import admin from './routes/admin.route.js';
import domainRoutes from './routes/domain.route.js';
import initCustomDomainJobs from './jobs/customDomainJobs.js';

// cors configuration, allowing only snapurl.in domain and subdomains in production
const isProduction = process.env.NODE_ENV === 'production';
// const isProduction = true;
const corsOptions = {
  origin: function (origin, callback) {
    if (isProduction) {
      // allow all subdomains of snapurl.in in production
      if (origin && /\.snapurl\.in$/.test(origin)) {
        callback(null, true);
      } else {
        console.error(`CORS Error: Request from origin ${origin} is not allowed`);
        callback(new Error('Only requests from snapurl.in subdomains are allowed.'));
      }
    } else {
      // allow all origins in non-production environments
      callback(null, true);
    }
  },
  optionsSuccessStatus: 200,
};

app.use('/api', cors(corsOptions), urlRoute);
app.use('/auth', cors(corsOptions), userAuthRoute);
app.use('/admin/auth', cors(corsOptions), adminAuthRoute);
app.use('/admin', cors(corsOptions), admin);
app.use('/domain', cors(corsOptions), domainRoutes);

// for accessing short url
app.get(
  '/u/:short',
  validateShortId,
  validationErrorHandler,
  redirectToOriginalUrl,
);

app.get('/r/:backHalf', redirectViaCustomBackHalf);

// goto /doc to see api documentation
app.get('/', (req, res) => {
  res.send(`Please goto <a href='/doc'>/doc</a> to see api documentation`);
});

// global error handler
app.use((err, req, res, next) => {
  if (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  } else {
    next();
  }
});

app.listen(PORT, function () {
  console.log(`Listening on port ${PORT}`);
});

// -------------------AWS Cloudwatch Logs-------------------
import winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';

// Configure Winston logger
const logger = winston.createLogger({
  transports: [
    isProduction
      ? new WinstonCloudWatch({
          logGroupName: 'snapurl',
          logStreamName: 'express-server',
          awsRegion: 'ap-south-1',
          jsonMessage: true,
          awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
          awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        })
      : new winston.transports.Console({
          format: winston.format.simple(),
        }),
  ],
});

logger.level = 'debug';
logger.on('error', (err) => {
  console.error('Error in Winston CloudWatch logger:', err);
});

// override console.log and console.error
console.log = function (...args) {
  logger.info(args.join(' '));
};

console.error = function (...args) {
  logger.error(args.join(' '));
};

initCustomDomainJobs();

export { app };
