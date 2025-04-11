import express from 'express';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import open from 'open'; // ✅ make sure this is installed
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/auth/callback'; // This must match Google Console
const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

export default function (api) {

    let loggedInUser = null;
api.get('/auth/status', (req, res) => {
  res.json({ loggedIn: !!req.session.user, user: req.session.user });
});

    
api.use(express.static(path.join(__dirname, '../res/UI')));

// Route to login page
api.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../res/UI/login.html'));
});


// Default route (homepage)
api.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../res/UI/index.html'));
});

  // Step 1: Redirect user to Google login
  api.get('/auth/google', async (req, res) => {
    const url = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['profile', 'email'],
    });

    // Open in default browser
    await open(url);

    res.send('Login in browser started. Please check your browser.');
  });

  api.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
  
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
  
      const ticket = await oAuth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: CLIENT_ID,
      });
  
      const payload = ticket.getPayload();
  
      // ✅ Save minimal safe user info into session
      req.session.user = {
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
      };
  
      console.log('✅ Logged in user:', req.session.user);
  
      // Redirect user back to app (instead of closing)
      res.redirect('/');
  
    } catch (err) {
      console.error('❌ Login failed:', err);
      res.status(500).send('Login failed');
    }
  });
  
}
