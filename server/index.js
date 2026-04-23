import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import Razorpay from "razorpay";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

const port = Number(process.env.PORT || 8787);
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
const razorpayPlanId = process.env.RAZORPAY_PLAN_ID;
const guestCookieName = "bulkcertify_guest_id";

const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret,
    })
  : null;

function generateDbId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const random = Math.random().toString(36).slice(2, 10);
  return `${year}${month}${day}-${random}`;
}

function isActiveSubscriber(user) {
  if (!user?.isSubscribed) return false;
  if (!user.subscriptionEndDate) return true;
  return new Date(user.subscriptionEndDate).getTime() > Date.now();
}

function getSafeEmail(req, fallbackId = "local-user") {
  const bodyEmail = req.body?.email;
  if (typeof bodyEmail === "string" && bodyEmail.length > 0) return bodyEmail;

  const headerEmail = req.headers["x-user-email"];
  if (typeof headerEmail === "string" && headerEmail.length > 0) return headerEmail;

  return `${fallbackId}@local.invalid`;
}

function getLocalAuthEmail(req) {
  const email = getSafeEmail(req, "").trim().toLowerCase();
  return email || null;
}

function normalizeAuthIdentifier(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(hash, "hex");
  if (expectedBuffer.length !== derived.length) return false;

  return timingSafeEqual(expectedBuffer, derived);
}

function toAccountPayload(user) {
  const subscribed = isActiveSubscriber(user);
  return {
    email: user.email,
    trialUsageCount: user.trialUsageCount,
    isSubscribed: subscribed,
    subscriptionStartDate: user.subscriptionStartDate,
    subscriptionEndDate: user.subscriptionEndDate,
    subscriptionId: user.subscriptionId,
    canGenerate: subscribed || user.trialUsageCount > 0,
  };
}

function requireLocalAuth(req, res, next) {
  const email = getLocalAuthEmail(req);
  if (!email) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }

  req.localAuthEmail = email;
  return next();
}

async function getOrCreateUser(req) {
  const email = getLocalAuthEmail(req);
  if (!email) {
    throw new Error("Unauthorized");
  }

  return prisma.user.upsert({
    where: { email },
    create: {
      id: generateDbId(),
      email,
      trialUsageCount: 3,
      isSubscribed: false,
    },
    update: {
      email,
    },
  });
}

function toDateFromEpoch(value) {
  if (value === undefined || value === null || value === "") return null;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;

  return new Date(numericValue > 1e12 ? numericValue : numericValue * 1000);
}

function getSubscriptionEndDate(subscription) {
  return (
    toDateFromEpoch(subscription?.current_end) ||
    toDateFromEpoch(subscription?.current_period_end) ||
    toDateFromEpoch(subscription?.end_at) ||
    toDateFromEpoch(subscription?.ended_at) ||
    null
  );
}

function getSubscriptionStartDate(subscription) {
  return (
    toDateFromEpoch(subscription?.current_start) ||
    toDateFromEpoch(subscription?.start_at) ||
    toDateFromEpoch(subscription?.created_at) ||
    null
  );
}

function isActiveRazorpaySubscription(subscription) {
  const status = String(subscription?.status || "").toLowerCase();
  return status === "active" || status === "authenticated";
}

async function updateUserBySubscription(subscription) {
  const subscriptionId = String(subscription?.id || "");
  if (!subscriptionId) return;

  const isSubscribed = isActiveRazorpaySubscription(subscription);
  const subscriptionStartDate = getSubscriptionStartDate(subscription);
  const subscriptionEndDate = getSubscriptionEndDate(subscription);

  const users = await prisma.user.findMany({
    where: { subscriptionId },
    select: { id: true },
  });

  if (!users.length) return;

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isSubscribed,
        subscriptionId,
        subscriptionStartDate,
        subscriptionEndDate,
      },
    });

    await prisma.planHistory.create({
      data: {
        id: generateDbId(),
        userId: user.id,
        planName: "Pro Plan",
        billingCycle: "Monthly",
        status: isSubscribed ? "ACTIVE" : "INACTIVE",
        subscriptionId,
        subscriptionStartDate,
        subscriptionEndDate,
      },
    });
  }
}

function daysRemainingFrom(endDate) {
  if (!endDate) return 0;
  const end = new Date(endDate).getTime();
  const now = Date.now();
  if (end <= now) return 0;
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

function toPlanDto(plan) {
  return {
    id: plan.id,
    planName: plan.planName,
    billingCycle: plan.billingCycle,
    status: plan.status,
    subscriptionId: plan.subscriptionId,
    startDate: plan.subscriptionStartDate,
    endDate: plan.subscriptionEndDate,
    daysRemaining: daysRemainingFrom(plan.subscriptionEndDate),
  };
}

function verifyRazorpaySignature(payload, signature, secret) {
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(String(signature), "hex");
  if (expectedBuffer.length !== signatureBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

function ensureGuestCookie(req, res) {
  let cookieId = req.cookies?.[guestCookieName];
  if (cookieId) return cookieId;

  cookieId = crypto.randomUUID();
  res.cookie(guestCookieName, cookieId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
  return cookieId;
}

async function getOrCreateGuestUsage(req, res) {
  const cookieId = ensureGuestCookie(req, res);
  return prisma.guestUsage.upsert({
    where: { cookieId },
    create: { id: generateDbId(), cookieId, remainingUses: 3 },
    update: {},
  });
}

app.post(
  "/api/razorpay/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!razorpayWebhookSecret) {
      return res.status(500).json({ error: "Razorpay webhook is not configured." });
    }

    const signature = req.headers["x-razorpay-signature"];
    if (!verifyRazorpaySignature(req.body, signature, razorpayWebhookSecret)) {
      return res.status(400).json({ error: "Webhook signature verification failed." });
    }

    try {
      const event = JSON.parse(req.body.toString("utf8"));
      const subscription = event?.payload?.subscription?.entity;
      const payment = event?.payload?.payment?.entity;

      if (subscription?.id) {
        if (event.event === "subscription.cancelled" || event.event === "subscription.completed") {
          await updateUserBySubscription(subscription);
        } else {
          await updateUserBySubscription(subscription);
        }
      } else if (payment?.notes?.subscription_id && (event.event === "payment.captured" || event.event === "payment.authorized")) {
        const resolvedSubscription = await razorpay.subscriptions.fetch(payment.notes.subscription_id);
        await updateUserBySubscription(resolvedSubscription);
      }

      return res.json({ received: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Webhook processing failed." });
    }
  }
);

app.use(cors({
  origin: frontendUrl,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const identifier = normalizeAuthIdentifier(req.body?.email || req.body?.username || "");
    const password = String(req.body?.password || "").trim();

    if (!identifier) {
      return res.status(400).json({ error: "Username is required." });
    }

    if (!password) {
      return res.status(400).json({ error: "Password is required." });
    }

    const existing = await prisma.user.findUnique({ where: { email: identifier } });
    if (existing) {
      return res.status(409).json({ error: "User already exists. Please log in." });
    }

    const user = await prisma.user.create({
      data: {
        id: generateDbId(),
        email: identifier,
        passwordHash: hashPassword(password),
        trialUsageCount: 3,
        isSubscribed: false,
      },
    });

    return res.status(201).json({ account: toAccountPayload(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const identifier = normalizeAuthIdentifier(req.body?.email || req.body?.username || "");
    const password = String(req.body?.password || "");

    if (!identifier || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const user = await prisma.user.findUnique({ where: { email: identifier } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Incorrect login password." });
    }

    return res.json({ account: toAccountPayload(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not log in." });
  }
});

app.get("/api/guest/status", async (req, res) => {
  try {
    const usage = await getOrCreateGuestUsage(req, res);
    res.json({
      remainingUses: usage.remainingUses,
      canGenerate: usage.remainingUses > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not load guest trial status." });
  }
});

app.post("/api/guest/consume", async (req, res) => {
  try {
    const usage = await getOrCreateGuestUsage(req, res);
    const decremented = await prisma.guestUsage.updateMany({
      where: { id: usage.id, remainingUses: { gt: 0 } },
      data: { remainingUses: { decrement: 1 } },
    });

    if (decremented.count === 0) {
      return res.status(402).json({
        allowed: false,
        message: "Your 3 free guest uses are finished. Please sign in to continue.",
      });
    }

    const refreshed = await prisma.guestUsage.findUnique({ where: { id: usage.id } });
    return res.json({
      allowed: true,
      remainingUses: refreshed?.remainingUses ?? 0,
      canGenerate: (refreshed?.remainingUses ?? 0) > 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not validate guest usage." });
  }
});

app.get("/api/me", requireLocalAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req);
    res.json(toAccountPayload(user));
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load account." });
  }
});

app.get("/api/profile", requireLocalAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req);
    const subscribed = isActiveSubscriber(user);

    const plans = await prisma.planHistory.findMany({
      where: { userId: user.id },
      orderBy: [
        { subscriptionStartDate: "desc" },
        { createdAt: "desc" },
      ],
    });

    const currentPlan = plans.find((plan) => plan.status === "ACTIVE") || null;
    const previousPlans = plans
      .filter((plan) => !currentPlan || plan.id !== currentPlan.id)
      .map(toPlanDto);

    return res.json({
      profile: {
        id: user.id,
        email: user.email,
        trialUsageCount: user.trialUsageCount,
        isSubscribed: subscribed,
        currentPlan: currentPlan ? toPlanDto(currentPlan) : null,
        previousPlans,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load profile." });
  }
});

app.post("/api/usage/consume", requireLocalAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req);

    if (isActiveSubscriber(user)) {
      return res.json({
        allowed: true,
        trialUsageCount: user.trialUsageCount,
        isSubscribed: true,
      });
    }

    const decremented = await prisma.user.updateMany({
      where: {
        id: user.id,
        trialUsageCount: { gt: 0 },
      },
      data: {
        trialUsageCount: { decrement: 1 },
      },
    });

    if (decremented.count === 0) {
      return res.status(402).json({
        allowed: false,
        reason: "TRIAL_EXHAUSTED",
        message: "Your free trial is over. Upgrade to continue generating certificates.",
      });
    }

    const refreshed = await prisma.user.findUnique({
      where: { id: user.id },
      select: { trialUsageCount: true, isSubscribed: true },
    });

    return res.json({
      allowed: true,
      trialUsageCount: refreshed?.trialUsageCount ?? 0,
      isSubscribed: refreshed?.isSubscribed ?? false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not validate usage." });
  }
});

app.post("/api/razorpay/create-subscription", requireLocalAuth, async (req, res) => {
  if (!razorpay || !razorpayPlanId || !razorpayKeyId) {
    return res.status(500).json({ error: "Razorpay checkout is not configured." });
  }

  try {
    const user = await getOrCreateUser(req);
    const subscription = await razorpay.subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: 120,
      customer_notify: 1,
      notes: {
        email: user.email,
        userId: user.id,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionId: String(subscription.id),
        isSubscribed: false,
      },
    });

    return res.json({
      keyId: razorpayKeyId,
      subscriptionId: String(subscription.id),
      currency: subscription.currency || "INR",
      email: user.email,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to start Razorpay checkout." });
  }
});

app.post("/api/razorpay/verify-payment", requireLocalAuth, async (req, res) => {
  try {
    const { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature } = req.body || {};

    if (!paymentId || !subscriptionId || !signature) {
      return res.status(400).json({ error: "Missing Razorpay payment details." });
    }

    if (!razorpayKeySecret) {
      return res.status(500).json({ error: "Razorpay verification is not configured." });
    }

    const expectedSignature = createHmac("sha256", razorpayKeySecret)
      .update(`${paymentId}|${subscriptionId}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const signatureBuffer = Buffer.from(String(signature), "hex");
    if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
      return res.status(400).json({ error: "Razorpay signature verification failed." });
    }

    const subscription = razorpay ? await razorpay.subscriptions.fetch(subscriptionId) : null;
    if (subscription) {
      await updateUserBySubscription({ ...subscription, status: "active" });
    }

    const user = await getOrCreateUser(req);
    const refreshed = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        trialUsageCount: true,
        isSubscribed: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        subscriptionId: true,
      },
    });

    return res.json({
      account: {
        email: refreshed?.email || user.email,
        trialUsageCount: refreshed?.trialUsageCount ?? 3,
        isSubscribed: !!refreshed?.isSubscribed,
        subscriptionStartDate: refreshed?.subscriptionStartDate,
        subscriptionEndDate: refreshed?.subscriptionEndDate,
        subscriptionId: refreshed?.subscriptionId,
        canGenerate: true,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to verify Razorpay payment." });
  }
});

app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});
