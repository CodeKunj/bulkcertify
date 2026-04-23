# BulkCertify

Bulk certificate generator with:

- Temporary local email/password placeholder auth
- 3-use free trial for guests tracked in PostgreSQL
- 3-use free trial for signed-in users tracked in PostgreSQL
- Razorpay subscription billing
- Server-side usage enforcement APIs
- DOCX/PDF/JPG export

## Stack

- Frontend: Vite + React
- Auth: local placeholder email/password flow
- Backend: Express
- DB: PostgreSQL + Prisma
- Billing: Razorpay

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template and fill values:

```bash
cp .env.example .env
```

3. Generate Prisma client and sync DB:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Start frontend + backend together:

```bash
npm run dev
```

Frontend runs on `http://localhost:5173` and backend on `http://localhost:8787`.

The current auth flow is a development placeholder: sign in with any email and any non-empty password, and the app stores that email locally for account and billing actions.

## Razorpay Webhook

Point Razorpay webhook endpoint to:

```text
http://localhost:8787/api/razorpay/webhook
```

Listen for events:

- `subscription.activated`
- `subscription.charged`
- `subscription.cancelled`
- `subscription.completed`
- `payment.captured`

## Trial + Access Rules

Server logic enforces:

- Allow guest generation while `guest.remainingUses > 0`
- After guest uses end, prompt sign in
- For signed-in users: allow if `trialUsageCount > 0`
- Allow if `isSubscribed === true` and subscription is active
- Otherwise block and prompt upgrade

Usage is consumed by `POST /api/usage/consume` before each generation run.