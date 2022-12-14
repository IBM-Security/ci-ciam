require('dotenv').config();

var axios = require('axios');
var qs = require('qs');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');
var bbfn = require('./functions.js');
var hbs =  require('hbs');

// register new function for handlebars
hbs.registerHelper('formatDate', function(badDate) {
  var dMod = new Date(badDate *1000);
  return dMod.toLocaleDateString();
})
hbs.registerHelper('formatState', function(state) {
  var stateOpt = {
    1: "Consent allow",
    2: "Consent deny",
    3: "Opt-in",
    4: "Opt-out",
    5: "Transparent"
  }
  return stateOpt[state];
})
hbs.registerHelper('formatAccessType', function(accessType) {
  if(accessType == "default")
  {
    return "";
  }
  return accessType;
})
hbs.registerHelper('formatAttribute', function(attribute) {
  if(attribute == "")
  {
    return "–";
  }
  else{
    return attribute;
  }
})

// Use Passport with OpenId Connect strategy to
// Authenticate users with IBM Cloud Identity Connect
var passport = require('passport')
var OpenIDStrategy = require('passport-openidconnect').Strategy

var index = require('./routes/index');
var setup = require('./routes/setup');
var profile = require('./routes/profile');
var openaccount = require('./routes/open-account');
var accountclaim = require('./routes/account-claim');
var consent = require('./routes/consent');

let oidcIssuer = process.env.OIDC_ISSUER;
if (!process.env.OIDC_ISSUER || process.env.OIDC_ISSUER == "") {
  oidcIssuer = process.env.OIDC_CI_BASE_URI + "/oauth2";
}

try {
  // Configure the OpenId Connect Strategy
  // with credentials obtained from env details (.env)
  passport.use(new OpenIDStrategy({
      issuer: oidcIssuer,
      clientID: process.env.OIDC_CLIENT_ID, // from .env file
      clientSecret: process.env.OIDC_CLIENT_SECRET, // from .env file
      authorizationURL: oidcIssuer + '/authorize', // this won't change
      userInfoURL: oidcIssuer + '/userinfo', // this won't change
      tokenURL: oidcIssuer + '/token', // this won't change
      callbackURL: process.env.OIDC_REDIRECT_URI, // from .env file
      passReqToCallback: true
    },
    function(req, issuer, claims, acr, idToken, accessToken, params, cb) {
      console.log('issuer:', issuer);
      console.log('claims:', claims);
      console.log('acr:', acr);
      console.log('idtoken:', idToken);
      console.log('accessToken:', accessToken);
      console.log('params:', params);

      req.session.accessToken = accessToken;
      req.session.userId = claims.id;
      req.session.loggedIn = true;
      return cb(null, claims);
  }));
} catch (e) {
  console.log("OIDC initialization failed.",e);
}

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Passport requires session to persist the authentication
// so were using express-session for this example
app.use(session({
  secret: 'secret sause',
  resave: false,
  saveUninitialized: true
}))

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware for checking if a user has been authenticated
// via Passport and IBM OpenId Connect
function checkAuthentication(req, res, next) {
  if (req.isAuthenticated()) {
    next();
  } else {
    req.session.returnTo = req.url
    res.redirect("/");
  }
}

app.use('/', index);
app.use('/setup', setup);
app.use('/app/profile', checkAuthentication, profile);
app.use('/open-account', openaccount);
app.use('/account-claim', accountclaim);
app.use('/app/consent', checkAuthentication, consent);
// Only allow authenticated users to access the /users route
//app.use('/users', checkAuthentication, users);
// Only allow authenticated users to access the /users route

var scopes = "profile email";
if (process.env.SEND_PRIVACY_SCOPES == "true") {
  scopes = scopes + " " + process.env.MARKETING_PURPOSE_ID +
    "/email." + process.env.READ_ACCESS_TYPE +
    " " + process.env.PAPERLESS_PURPOSE_ID +
    "/email." + process.env.READ_ACCESS_TYPE;
}
// Initiates an authentication request with IBM
// The user will be redirect to IBM and once authenticated
// they will be returned to the callback handler below
app.get('/login', passport.authenticate('openidconnect', {
  successReturnToOrRedirect: "/",
  scope: scopes
}));
app.get('/login-linkedin', function(req,_res,next) {
  req.session.nextUrl = "/open-account";
  next();
}, passport.authenticate('openidconnect', {
  successReturnToOrRedirect: "/",
  scope: scopes,
  loginHint: `{"realm":"www.linkedin.com"}`
}));
app.get('/login-google', function(req,_res,next) {
  req.session.nextUrl = "/open-account";
  next();
}, passport.authenticate('openidconnect', {
  successReturnToOrRedirect: "/",
  scope: scopes,
  loginHint: `{"realm":"www.google.com"}`
}));

// Callback handler that IBM will redirect back to
// after successfully authenticating the user
app.get('/oauth/callback', passport.authenticate(
  'openidconnect',
  {
    failureRedirect: '/'
  }),
  function(req,res) {
    let url = '/app/profile';
    if (req.session.nextUrl) {
      url = req.session.nextUrl;
      delete req.session.nextUrl;
    }
    res.redirect(url);
  });

// Destroy both the local session and
// revoke the access_token at IBM
app.get('/logout', function(req, res) {

  var data = {
    'client_id': process.env.OIDC_CLIENT_ID,
    'client_secret': process.env.OIDC_CLIENT_SECRET,
    'token': req.session.accessToken,
    'token_type_hint': 'access_token'
  };

  var options = {
    method: 'post',
    url: oidcIssuer + '/revoke',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: qs.stringify(data)
  };

  axios(options).then(response => {
    console.log('Session Revoked at Verify. Status',response.status);
    req.session.loggedIn = false;
    console.log('process.env.THEME_ID in /logout is: ' + process.env.THEME_ID);
    req.session.loggedIn = false;
    res.redirect(process.env.OIDC_CI_BASE_URI + '/idaas/mtfim/sps/idaas/logout' + '?themeId=' + process.env.THEME_ID);
  });
});



// catch error
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error', {
    message: `An HTTP ${err.status} was returned.`,
    detail: JSON.stringify(err)
  });
});

if (process.env.API_CLIENT_ID && process.env.API_SECRET && process.env.MFAGROUP && process.env.APP_NAME) {
  // Get access token for privileged API access
  bbfn.authorize(process.env.API_CLIENT_ID, process.env.API_SECRET, async function(err, body) {
    if (err) {
      console.log(err);
    } else {
      apiAccessToken = body.access_token;
      // Get the MFA group's id
      var result;
      try {
        result = await bbfn.getGroupID(process.env.MFAGROUP, apiAccessToken);
      } catch (e) {
        console.log("Group lookup failed");
      }

      if (result && result['urn:ietf:params:scim:schemas:extension:ibm:2.0:Group'].groupType == "standard") {
        process.env.MFAGROUPID = result.id;
        console.log(`MFA Group ID is ${process.env.MFAGROUPID}`);
      } else {
        console.log(`Group ${process.env.MFAGROUP} is invalid`);
      }
      // Get the demo app's theme id
      bbfn.getThemeID(process.env.APP_NAME, apiAccessToken, (_err,result) => {
        if (result) {
          process.env.THEME_ID = result;
          console.log(`Theme ID is ${process.env.THEME_ID}`);
        } else {
          console.log(`Failed to set Theme ID`);
        }
      });
    }
  });
}

module.exports = app;
