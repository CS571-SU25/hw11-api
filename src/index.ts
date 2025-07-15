import express, { Express } from 'express';
import cookies from "cookie-parser";

import { CS571Initializer } from '@cs571/api-framework'
import HW11PublicConfig from './model/configs/hw11-public-config';
import HW11SecretConfig from './model/configs/hw11-secret-config';
import { CS571HW11DbConnector } from './services/hw11-db-connector';
import { CS571AICompletionsRoute } from './routes/completions';
import { CS571AICompletionsStreamRoute } from './routes/completions-stream';

console.log("Welcome to HW11 AI!");

const app: Express = express();

app.use(cookies());

// https://github.com/expressjs/express/issues/5275
declare module "express-serve-static-core" {
  export interface CookieOptions {
    partitioned?: boolean;
  }
}

const appBundle = CS571Initializer.init<HW11PublicConfig, HW11SecretConfig>(app, {
  allowNoAuth: [],
  skipAuth: false,
  skipCors: false
});

const db = new CS571HW11DbConnector(appBundle.config);

db.init();

appBundle.router.addRoutes([
  new CS571AICompletionsRoute(db, appBundle.config.PUBLIC_CONFIG, appBundle.config.SECRET_CONFIG),
  new CS571AICompletionsStreamRoute(db, appBundle.config.PUBLIC_CONFIG, appBundle.config.SECRET_CONFIG)
])

app.listen(appBundle.config.PORT, () => {
  console.log(`Running at :${appBundle.config.PORT}`);
});
