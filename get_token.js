const fs = require('fs');
const readline = require('readline');

// Read the credentials from your secrets folder
const credsRaw = fs.readFileSync('./secrets/client_secret_884264005414-661ihl35l2gm48cljv41gcujj4g5t5nb.apps.googleusercontent.com.json', 'utf-8');
const creds = JSON.parse(credsRaw).installed;

const CLIENT_ID = creds.client_id;
const CLIENT_SECRET = creds.client_secret;
const REDIRECT_URI = creds.redirect_uris[0]; // "http://localhost"

// Construct the authorization URL
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `scope=openid%20profile%20email%20https%3A//www.googleapis.com/auth/tasks&` +
  `access_type=offline&` +
  `include_granted_scopes=true&` +
  `response_type=code&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `client_id=${encodeURIComponent(CLIENT_ID)}&` + 
  `prompt=consent`; // prompt=consent forces Google to issue a refresh token

console.log('=== Logseq Google Tasks OAuth Flow ===\n');
console.log('1. Open this URL in your browser and authorize the app:\n');
console.log(authUrl);
console.log('\n2. After granting permission, you will be redirected to localhost (which will likely appear as a "Connection Refused" error page - this is perfectly normal and expected!).');
console.log('3. Copy the ENTIRE URL from your browser address bar and paste it below.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste the full redirect URL here: ', async (urlstr) => {
  try {
    const url = new URL(urlstr.trim());
    const code = url.searchParams.get('code');
    
    if (!code) {
      console.error('\n[Error] Could not find auth "code" parameter in the URL.');
      process.exit(1);
    }
    
    console.log('\nExchanging code for tokens...');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    
    const data = await response.json();
    if (data.error) {
      console.error('Error exchanging token:', data);
    } else {
      console.log('\n=== SUCCESS ===');
      console.log('Refresh Token:', data.refresh_token);
      console.log('\nIMPORTANT: Paste this Refresh Token into your Logseq plugin settings.');
    }
  } catch (err) {
    console.error('\n[Error] Make sure you pasted the full URL correctly. Error details:', err.message);
  }
  rl.close();
});
