# Google OAuth API Endpoints

## Endpoints Added

### 1. GET `/api/auth/google/init`
**Purpose:** Initialize Google OAuth by providing the client ID to the frontend

**Request:**
```bash
GET /api/auth/google/init
```

**Response (Success - 200):**
```json
{
  "clientId": "your_google_client_id.apps.googleusercontent.com"
}
```

**Response (Error - 400):**
```json
{
  "error": "Google OAuth is not configured."
}
```

**Usage in Frontend:**
```javascript
const res = await fetch("/api/auth/google/init");
const { clientId } = await res.json();
```

---

### 2. POST `/api/auth/google/verify`
**Purpose:** Verify Google ID token and authenticate or create a user

**Request:**
```bash
POST /api/auth/google/verify
Content-Type: application/json

{
  "token": "google_id_token_from_frontend"
}
```

**Parameters:**
- `token` (required, string): Google ID token from the Google Sign-In response

**Response (Success - 200):**
```json
{
  "account": {
    "email": "user@gmail.com",
    "isAdmin": false,
    "trialUsageCount": 2,
    "isSubscribed": false,
    "subscriptionStartDate": null,
    "subscriptionEndDate": null,
    "subscriptionId": null,
    "canGenerate": true
  }
}
```

**Response (Error - 400):**
```json
{
  "error": "Google OAuth is not configured."
}
```

**Response (Error - 401):**
```json
{
  "error": "Invalid token."
}
```

**Response (Error - 500):**
```json
{
  "error": "Google authentication failed."
}
```

**Usage in Frontend:**
```javascript
const credentialResponse = {
  credential: "google_id_token"
};

const res = await fetch("/api/auth/google/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: credentialResponse.credential })
});

const { account } = await res.json();
// account contains user information and subscription status
```

---

## Integration Flow

```
1. Frontend loads Google Client ID
   ↓
2. User clicks "Sign in with Google"
   ↓
3. Google API returns ID token
   ↓
4. Frontend sends token to /api/auth/google/verify
   ↓
5. Backend verifies token signature and authenticity
   ↓
6. Backend checks if user exists
   ├─ New user: Create new account with OAuth marker
   └─ Existing user: Update authentication method
   ↓
7. Backend returns user account information
   ↓
8. Frontend stores email in localStorage
   ↓
9. User is logged in and redirected
```

---

## Activity Logging

The following activities are logged in `activityLog` table:

### New User Sign-up
```
Action: AUTH_OAUTH_SIGNUP
Details: {
  "provider": "GOOGLE",
  "googleId": "unique_google_id",
  "name": "User Name"
}
```

### Legacy User Upgraded
```
Action: AUTH_OAUTH_UPGRADED
Details: {
  "provider": "GOOGLE",
  "googleId": "unique_google_id",
  "name": "User Name"
}
```

### Existing User Login
```
Action: AUTH_OAUTH_LOGIN
Details: {
  "provider": "GOOGLE",
  "googleId": "unique_google_id"
}
```

---

## Environment Variables Required

```env
# Google OAuth Credentials
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret

# Already existing, but required for OAuth to work
FRONTEND_URL=http://localhost:5173
PORT=8787
```

---

## Security Considerations

1. **Token Verification**: Tokens are verified on the backend using Google's official library
2. **No Password Needed**: OAuth users have `passwordHash` set to `"oauth-google"` (not usable for password login)
3. **HTTPS Recommended**: Use HTTPS in production for secure token transmission
4. **Client Secret**: Never expose `GOOGLE_CLIENT_SECRET` to the frontend
5. **Same-Site Cookies**: Session cookies use SameSite=Lax for CSRF protection

---

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "Google OAuth is not configured" | Missing `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` | Set environment variables in `.env` |
| "Invalid token" | Token signature verification failed | Check Client ID matches Google Cloud credentials |
| "Email not found in token" | Google token doesn't contain email | Ensure proper OAuth scope (email is default) |
| "Google authentication failed" | Server error during verification | Check server logs, restart application |

---

## Testing

### Using cURL
```bash
# Get Client ID
curl http://localhost:8787/api/auth/google/init

# Verify token (you need a real token from Google)
curl -X POST http://localhost:8787/api/auth/google/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "actual_google_id_token"}'
```

### Using Frontend
```javascript
// In browser console on login page
// Google Sign-In will be available automatically
// Click the Google Sign-In button to test
```

---

## Backward Compatibility

- Existing username/password authentication remains unchanged
- OAuth is an alternative login method
- Users can have accounts via both methods (linked by email)
- All existing functionality (subscriptions, admin panels) works with OAuth users
