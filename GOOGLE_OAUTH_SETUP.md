# Google OAuth Setup Guide

This guide will help you set up Google OAuth for the BulkCertify application.

## Prerequisites

1. A Google Cloud Console project
2. Node.js and npm installed
3. The BulkCertify application running

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown and select "NEW PROJECT"
3. Enter a project name (e.g., "BulkCertify")
4. Click "CREATE"
5. Wait for the project to be created

## Step 2: Enable the Google+ API

1. In the Google Cloud Console, go to "APIs & Services" > "Library"
2. Search for "Google+ API"
3. Click on "Google+ API"
4. Click "ENABLE"

## Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click on "Create Credentials" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen first:
   - Click "Configure Consent Screen"
   - Choose "External" for User type
   - Fill in the required fields:
     - App name: "BulkCertify"
     - User support email: Your email
     - Developer contact: Your email
   - Click "SAVE AND CONTINUE"
   - Skip optional fields and click "SAVE AND CONTINUE"
   - Click "SAVE AND CONTINUE" again
   - Review and click "BACK TO DASHBOARD"
4. Go back to "Credentials" and click "Create Credentials" > "OAuth client ID"
5. Select "Web application"
6. Add the following URIs:
   - **Authorized JavaScript origins:**
     - `http://localhost:5173` (for local development)
     - `https://yourdomain.com` (for production)
   - **Authorized redirect URIs:**
     - `http://localhost:8787/api/auth/google/callback` (optional, for reference)
     - `https://yourdomain.com/api/auth/google/callback` (optional, for production)
7. Click "CREATE"
8. Copy the Client ID and Client Secret

## Step 4: Configure Environment Variables

1. Open or create a `.env` file in the root of your BulkCertify project
2. Add the following variables:

```env
GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

3. Save the file
4. Restart your application

## Step 5: Test Google OAuth

1. Open your application at `http://localhost:5173`
2. Navigate to the login page
3. You should see a "Sign in with Google" button below the username/password form
4. Click the button and follow the Google authentication flow
5. Upon successful authentication, you should be logged in and redirected to the application

## Features

- **User Creation**: If a user logs in with Google for the first time, an account is automatically created
- **Account Linking**: If a user with the same email already exists, they can use Google OAuth to log in to their existing account
- **Secure**: Token verification happens on the backend
- **Monthly Trial**: New Google OAuth users receive the same monthly trial as regular users

## Troubleshooting

### "Google OAuth is not configured" error

- Make sure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in your `.env` file
- Restart the application after updating the environment variables

### Google Sign-In button doesn't appear

- Check that `GOOGLE_CLIENT_ID` is correctly set
- Check the browser console for errors
- Verify that the Google Cloud project is properly configured

### "Invalid token" error on sign-in

- Make sure the `GOOGLE_CLIENT_ID` in the environment matches the one in Google Cloud Console
- Ensure the authorized JavaScript origins include your application's frontend URL
- Check that the token verification endpoint is working correctly

### CORS errors

- Ensure your backend is allowing requests from your frontend URL
- Check the FRONTEND_URL environment variable in your `.env` file

## Production Deployment

1. Update your environment variables with production URLs:
   - Add your production domain to "Authorized JavaScript origins"
   - Add your production domain to "Authorized redirect URIs"

2. Update your `.env` file with production credentials:
   ```env
   GOOGLE_CLIENT_ID=your_production_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_production_google_client_secret
   FRONTEND_URL=https://yourdomain.com
   VITE_API_URL=https://yourdomain.com/api
   ```

3. Redeploy your application

## Security Notes

- Never commit your `.env` file to version control
- Keep your `GOOGLE_CLIENT_SECRET` confidential
- Use HTTPS in production
- Token verification happens server-side for security
- Passwords are stored securely even for OAuth users (as placeholder)

## Support

For more information about Google OAuth, visit:
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Identity Sign-In Documentation](https://developers.google.com/identity/sign-in/web)
