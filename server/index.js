import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import Razorpay from "razorpay";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { PrismaPg } from "@prisma/adapter-pg";
import { OAuth2Client } from "google-auth-library";

const app = express();
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter }).$extends(withAccelerate());

const port = Number(process.env.PORT || 8787);
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
const razorpayPlanId = process.env.RAZORPAY_PLAN_ID;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const guestCookieName = "bulkcertify_guest_id";
const guestTrialLimit = 1;
const accountMonthlyTrialLimit = 2;
const subscriptionAmountSettingKey = "SUBSCRIPTION_AMOUNT_INR";
const subscriptionPlansSettingKey = "SUBSCRIPTION_PLANS_V1";
const primarySubscriptionPlanId = "plan-pro-monthly";
const defaultSubscriptionAmountInr = Math.max(1, Number(process.env.SUBSCRIPTION_AMOUNT_INR || 9) || 9);
const defaultSubscriptionCurrency = String(process.env.SUBSCRIPTION_CURRENCY || "INR").trim().toUpperCase();
const supportedSubscriptionCurrencies = String(
  process.env.SUBSCRIPTION_SUPPORTED_CURRENCIES || "INR,USD,EUR,GBP,AUD,CAD,SGD,AED"
)
  .split(",")
  .map((value) => String(value || "").trim().toUpperCase())
  .filter(Boolean);
const countryToCurrencyMap = {
  IN: "INR",
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  AU: "AUD",
  SG: "SGD",
  AE: "AED",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  PT: "EUR",
  IE: "EUR",
  BE: "EUR",
};
const runtimeSettingsCache = new Map();

const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret,
    })
  : null;

const googleOAuthClient = googleClientId && googleClientSecret
  ? new OAuth2Client({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
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

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
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

function isAdminUser(user) {
  if (!user) return false;
  return !!(user.isAdmin || user.email === adminEmail);
}

function getMonthWindowStart(referenceDate = new Date()) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
}

async function getUserMonthlyConsumedCount(userId) {
  if (!userId) return 0;
  const monthStart = getMonthWindowStart();
  return prisma.activityLog.count({
    where: {
      userId,
      action: "USER_USAGE_CONSUMED",
      createdAt: { gte: monthStart },
    },
  });
}

async function getUserMonthlyRemainingUses(user) {
  if (!user || isAdminUser(user) || isActiveSubscriber(user)) {
    return accountMonthlyTrialLimit;
  }

  const consumedThisMonth = await getUserMonthlyConsumedCount(user.id);
  return Math.max(accountMonthlyTrialLimit - consumedThisMonth, 0);
}

function toAccountPayload(user) {
  const subscribed = isActiveSubscriber(user);
  const isAdmin = isAdminUser(user);
  return {
    email: user.email,
    isAdmin,
    trialUsageCount: user.trialUsageCount,
    isSubscribed: isAdmin ? true : subscribed,
    subscriptionStartDate: user.subscriptionStartDate,
    subscriptionEndDate: user.subscriptionEndDate,
    subscriptionId: user.subscriptionId,
    canGenerate: isAdmin || subscribed || user.trialUsageCount > 0,
  };
}

async function toAccountPayloadWithMonthlyUsage(user) {
  const subscribed = isActiveSubscriber(user);
  const isAdmin = isAdminUser(user);

  if (isAdmin || subscribed) {
    return toAccountPayload(user);
  }

  const trialUsageCount = await getUserMonthlyRemainingUses(user);
  return {
    email: user.email,
    isAdmin: false,
    trialUsageCount,
    isSubscribed: false,
    subscriptionStartDate: user.subscriptionStartDate,
    subscriptionEndDate: user.subscriptionEndDate,
    subscriptionId: user.subscriptionId,
    canGenerate: trialUsageCount > 0,
  };
}

async function findUserByEmail(email) {
  if (!email) return null;
  return prisma.user.findUnique({ where: { email } });
}

async function logActivity(req, payload) {
  try {
    const email = normalizeAuthIdentifier(payload?.email || req.localAuthEmail || "");
    const user = email ? await findUserByEmail(email) : null;

    await prisma.activityLog.create({
      data: {
        userId: user?.id || null,
        action: String(payload?.action || "UNKNOWN"),
        targetType: payload?.targetType ? String(payload.targetType) : null,
        targetId: payload?.targetId ? String(payload.targetId) : null,
        details: payload?.details ?? null,
        ipAddress: getClientIp(req),
      },
    });
  } catch {
    // Logging must never break the request path.
  }
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

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error("Unauthorized");
  }

  // Keep legacy column bounded for compatibility with existing admin views.
  if (!isAdminUser(user) && !isActiveSubscriber(user) && (user.trialUsageCount || 0) > accountMonthlyTrialLimit) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { trialUsageCount: accountMonthlyTrialLimit },
    });
  }

  return user;
}

async function requireAdmin(req, res, next) {
  try {
    if (!adminEmail) {
      return res.status(500).json({ error: "Admin panel is not configured." });
    }

    if (req.localAuthEmail !== adminEmail) {
      return res.status(403).json({ error: "Admin access only." });
    }

    const user = await findUserByEmail(req.localAuthEmail);
    if (!user) {
      return res.status(401).json({ error: "Admin account not found. Please sign up first." });
    }

    req.adminUser = user;
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message || "Admin authorization failed." });
  }
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
  const currency = normalizeCurrencyCode(subscription?.currency || subscription?.notes?.currency || "INR");
  const amountMinor = normalizeAmountMinor(subscription?.notes?.amountMinor, currency);

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
        provider: "RAZORPAY",
        providerSubscriptionId: subscriptionId,
        currency,
        amountMinor,
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
    provider: plan.provider || "RAZORPAY",
    providerSubscriptionId: plan.providerSubscriptionId || plan.subscriptionId,
    currency: plan.currency || "INR",
    amountMinor: plan.amountMinor ?? null,
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

function normalizeCurrencyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "INR";
  return supportedSubscriptionCurrencies.includes(normalized) ? normalized : "INR";
}

function getCurrencyFractionDigits(currency) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "JPY") return 0;
  return 2;
}

function normalizeAmountMinor(value, currency = "INR") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.floor(numeric);
  if (integer < 1 || integer > 1_000_000_000) return null;
  return integer;
}

function toMinorUnits(amountMajor, currency = "INR") {
  const numeric = Number(amountMajor);
  if (!Number.isFinite(numeric)) return null;
  const decimals = getCurrencyFractionDigits(currency);
  const factor = 10 ** decimals;
  const minor = Math.round(numeric * factor);
  return normalizeAmountMinor(minor, currency);
}

function fromMinorUnits(amountMinor, currency = "INR") {
  const minor = normalizeAmountMinor(amountMinor, currency);
  if (!minor) return null;
  const decimals = getCurrencyFractionDigits(currency);
  const factor = 10 ** decimals;
  return minor / factor;
}

function normalizeSubscriptionAmount(value, currency = "INR") {
  const minor = toMinorUnits(value, currency);
  if (!minor) return null;
  return fromMinorUnits(minor, currency);
}

function normalizeSubscriptionAmountInr(value) {
  const amount = normalizeSubscriptionAmount(value, "INR");
  if (amount === null) return null;
  return Math.floor(amount);
}

function detectCountryCode(req) {
  const rawCountry =
    req.headers["x-country-code"] ||
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.body?.countryCode ||
    "";

  const countryCode = String(rawCountry || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(countryCode) ? countryCode : "IN";
}

function resolveCurrencyForRequest(req, explicitCurrency) {
  const normalizedExplicit = String(explicitCurrency || "").trim().toUpperCase();
  if (normalizedExplicit && supportedSubscriptionCurrencies.includes(normalizedExplicit)) {
    return normalizedExplicit;
  }

  const countryCode = detectCountryCode(req);
  const mapped = countryToCurrencyMap[countryCode];
  if (mapped && supportedSubscriptionCurrencies.includes(mapped)) {
    return mapped;
  }

  const fallbackCurrency = normalizeCurrencyCode(defaultSubscriptionCurrency);
  if (supportedSubscriptionCurrencies.includes(fallbackCurrency)) {
    return fallbackCurrency;
  }

  return "INR";
}

function getAppSettingDelegate() {
  const delegate = prisma?.appSetting;
  if (!delegate) return null;
  if (typeof delegate.findUnique !== "function") return null;
  if (typeof delegate.upsert !== "function") return null;
  return delegate;
}

function getAdminSettingDelegate() {
  const delegate = prisma?.adminSetting;
  if (!delegate) return null;
  if (typeof delegate.findUnique !== "function") return null;
  if (typeof delegate.upsert !== "function") return null;
  return delegate;
}

function getAdminPlanDelegate() {
  const delegate = prisma?.adminPlan;
  if (!delegate) return null;
  if (typeof delegate.findMany !== "function") return null;
  if (typeof delegate.create !== "function") return null;
  if (typeof delegate.update !== "function") return null;
  if (typeof delegate.upsert !== "function") return null;
  if (typeof delegate.deleteMany !== "function") return null;
  return delegate;
}

function normalizePlanFeatures(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const deduped = [];
  for (const feature of source) {
    const normalized = String(feature || "").trim();
    if (!normalized) continue;
    if (!deduped.includes(normalized)) deduped.push(normalized);
  }
  return deduped.slice(0, 12);
}

function normalizeBillingCycle(value) {
  const cycle = String(value || "monthly").trim().toUpperCase();
  if (cycle === "YEARLY" || cycle === "QUARTERLY") return cycle;
  return "MONTHLY";
}

function buildDefaultPlans(amountInr) {
  const currency = normalizeCurrencyCode(defaultSubscriptionCurrency);
  const amountMinor = toMinorUnits(amountInr, currency) || toMinorUnits(defaultSubscriptionAmountInr, "INR") || 900;
  const amount = fromMinorUnits(amountMinor, currency) || amountInr;
  return [
    {
      id: "plan-pro-monthly",
      name: "Pro Plan",
      description: "Unlimited certificate generations with all export formats.",
      prices: {
        [currency]: Math.floor(amount),
      },
      provider: "RAZORPAY",
      providerPlanId: null,
      countryScope: null,
      billingCycle: "MONTHLY",
      isActive: true,
      sortOrder: 1,
      features: ["Unlimited generation runs", "DOCX, PDF, and JPG export", "Priority support"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

/**
 * Normalizes incoming plan data to ensure the database receives correctly formatted values.
 * Parses the incoming `prices` JSON dictionary and validates amounts, keeping only valid currencies.
 * Provides backwards compatibility for legacy endpoints by dynamically resolving 
 * single currency fields into the `prices` dictionary.
 */
function normalizePlanInput(input, fallbackAmountInr) {
  const name = String(input?.name || "").trim();
  if (!name) return null;

  let prices = {};
  if (input?.prices && typeof input.prices === "object") {
    for (const [key, val] of Object.entries(input.prices)) {
      const c = normalizeCurrencyCode(key);
      const v = Number(val);
      if (Number.isFinite(v) && v > 0) {
        prices[c] = v;
      }
    }
  }

  if (Object.keys(prices).length === 0) {
    const currency = normalizeCurrencyCode(input?.currency || defaultSubscriptionCurrency);
    let amountMinor = normalizeAmountMinor(input?.amountMinor, currency);
    if (!amountMinor) {
      const fallbackAmount =
        input?.amount ??
        (currency === "INR" ? input?.priceInr : null) ??
        (currency === "INR" ? fallbackAmountInr : null);
      amountMinor = toMinorUnits(fallbackAmount, currency);
    }
    if (amountMinor) {
      const amountMajor = fromMinorUnits(amountMinor, currency);
      if (amountMajor !== null) {
        prices[currency] = amountMajor;
      }
    }
  }

  return {
    id: String(input?.id || generateDbId()),
    name,
    description: String(input?.description || "").trim().slice(0, 500),
    prices,
    provider: String(input?.provider || "RAZORPAY").trim().toUpperCase() || "RAZORPAY",
    providerPlanId: input?.providerPlanId ? String(input.providerPlanId) : null,
    countryScope: input?.countryScope ? String(input.countryScope).trim().toUpperCase().slice(0, 2) : null,
    billingCycle: normalizeBillingCycle(input?.billingCycle),
    isActive: input?.isActive !== false,
    sortOrder: Number.isFinite(Number(input?.sortOrder)) ? Math.max(0, Math.floor(Number(input.sortOrder))) : 0,
    features: normalizePlanFeatures(input?.features),
    createdAt: String(input?.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
}

function sortPlans(plans) {
  return [...plans].sort((a, b) => {
    const aOrder = Number(a?.sortOrder || 0);
    const bOrder = Number(b?.sortOrder || 0);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

async function getSubscriptionPlans({ includeInactive = false } = {}) {
  const fallbackAmountInr = await getSubscriptionAmountInr();

  const parsePlans = (rawValue) => {
    try {
      const parsed = JSON.parse(String(rawValue || "[]"));
      if (!Array.isArray(parsed)) return [];

      const normalized = parsed
        .map((entry) => normalizePlanInput(entry, fallbackAmountInr))
        .filter(Boolean);

      return normalized.length ? normalized : buildDefaultPlans(fallbackAmountInr);
    } catch {
      return buildDefaultPlans(fallbackAmountInr);
    }
  };

  const cached = runtimeSettingsCache.get(subscriptionPlansSettingKey);
  if (cached) {
    const plans = parsePlans(cached);
    return includeInactive ? sortPlans(plans) : sortPlans(plans.filter((plan) => plan.isActive));
  }

  const adminPlan = getAdminPlanDelegate();
  if (adminPlan) {
    const rows = await adminPlan.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    if (rows.length) {
      return sortPlans(
        rows
          .map((row) =>
            normalizePlanInput(
              {
                id: row.id,
                name: row.name,
                description: row.description,
                prices: row.prices,
                provider: row.provider,
                providerPlanId: row.providerPlanId,
                countryScope: row.countryScope,
                billingCycle: row.billingCycle,
                isActive: row.isActive,
                sortOrder: row.sortOrder,
                features: Array.isArray(row.features) ? row.features : [],
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              },
              fallbackAmountInr
            )
          )
          .filter(Boolean)
      );
    }
  }

  const appSetting = getAppSettingDelegate();
  if (!appSetting) {
    const defaults = buildDefaultPlans(fallbackAmountInr);
    return includeInactive ? defaults : defaults.filter((plan) => plan.isActive);
  }

  const setting = await appSetting.findUnique({
    where: { key: subscriptionPlansSettingKey },
    select: { value: true },
  });

  if (setting?.value) {
    runtimeSettingsCache.set(subscriptionPlansSettingKey, setting.value);
  }

  const plans = parsePlans(setting?.value);
  return includeInactive ? sortPlans(plans) : sortPlans(plans.filter((plan) => plan.isActive));
}

async function setSubscriptionPlans(plans) {
  const normalizedPlans = sortPlans(
    plans
      .map((entry) => normalizePlanInput(entry, defaultSubscriptionAmountInr))
      .filter(Boolean)
  );

  if (!normalizedPlans.length) {
    throw new Error("At least one valid plan is required.");
  }

  const serialized = JSON.stringify(normalizedPlans);
  runtimeSettingsCache.set(subscriptionPlansSettingKey, serialized);

  const adminPlan = getAdminPlanDelegate();
  if (adminPlan) {
    const keepIds = normalizedPlans.map((plan) => plan.id);

    await prisma.$transaction(async (tx) => {
      await tx.adminPlan.deleteMany({
        where: {
          id: {
            notIn: keepIds,
          },
        },
      });

      for (const plan of normalizedPlans) {
        await tx.adminPlan.upsert({
          where: { id: plan.id },
          create: {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            prices: plan.prices,
            provider: plan.provider,
            providerPlanId: plan.providerPlanId,
            countryScope: plan.countryScope,
            billingCycle: plan.billingCycle,
            isActive: plan.isActive,
            sortOrder: plan.sortOrder,
            features: plan.features,
          },
          update: {
            name: plan.name,
            description: plan.description,
            prices: plan.prices,
            provider: plan.provider,
            providerPlanId: plan.providerPlanId,
            countryScope: plan.countryScope,
            billingCycle: plan.billingCycle,
            isActive: plan.isActive,
            sortOrder: plan.sortOrder,
            features: plan.features,
          },
        });
      }
    });
  }

  const appSetting = getAppSettingDelegate();
  if (appSetting) {
    await appSetting.upsert({
      where: { key: subscriptionPlansSettingKey },
      create: { key: subscriptionPlansSettingKey, value: serialized },
      update: { value: serialized },
    });
  }

  const firstActive = normalizedPlans.find((plan) => plan.isActive);
  if (firstActive?.prices?.INR) {
    await setSubscriptionAmountInr(firstActive.prices.INR);
  }

  return normalizedPlans;
}

async function getSubscriptionAmountInr() {
  const fromCache = normalizeSubscriptionAmountInr(runtimeSettingsCache.get(subscriptionAmountSettingKey));
  if (fromCache) return fromCache;

  const adminSetting = getAdminSettingDelegate();
  if (adminSetting) {
    const adminStored = await adminSetting.findUnique({
      where: { key: subscriptionAmountSettingKey },
      select: { value: true },
    });

    const fromAdminSetting = normalizeSubscriptionAmountInr(adminStored?.value);
    if (fromAdminSetting) {
      runtimeSettingsCache.set(subscriptionAmountSettingKey, String(fromAdminSetting));
      return fromAdminSetting;
    }
  }

  const appSetting = getAppSettingDelegate();
  if (!appSetting) {
    return defaultSubscriptionAmountInr;
  }

  const setting = await appSetting.findUnique({
    where: { key: subscriptionAmountSettingKey },
    select: { value: true },
  });

  const fromDb = normalizeSubscriptionAmountInr(setting?.value);
  if (fromDb) {
    runtimeSettingsCache.set(subscriptionAmountSettingKey, String(fromDb));
  }
  return fromDb || defaultSubscriptionAmountInr;
}

async function syncPrimarySubscriptionPlan(amountInr) {
  const adminPlan = getAdminPlanDelegate();
  if (!adminPlan) {
    return null;
  }

  const defaultPlan = buildDefaultPlans(amountInr)[0];
  const existing = await adminPlan.findUnique({
    where: { id: primarySubscriptionPlanId },
  });

  let prices = existing?.prices || defaultPlan.prices || {};
  if (typeof prices !== 'object') prices = {};
  prices.INR = amountInr;

  const nextPlan = {
    ...defaultPlan,
    ...(existing || {}),
    id: primarySubscriptionPlanId,
    prices,
    provider: String(existing?.provider || defaultPlan.provider || "RAZORPAY").toUpperCase(),
  };

  await adminPlan.upsert({
    where: { id: primarySubscriptionPlanId },
    create: {
      id: primarySubscriptionPlanId,
      name: nextPlan.name,
      description: nextPlan.description,
      prices: nextPlan.prices,
      provider: nextPlan.provider,
      providerPlanId: nextPlan.providerPlanId,
      countryScope: nextPlan.countryScope,
      billingCycle: nextPlan.billingCycle,
      isActive: nextPlan.isActive,
      sortOrder: nextPlan.sortOrder,
      features: nextPlan.features,
    },
    update: {
      name: nextPlan.name,
      description: nextPlan.description,
      prices: nextPlan.prices,
      provider: nextPlan.provider,
      providerPlanId: nextPlan.providerPlanId,
      countryScope: nextPlan.countryScope,
      billingCycle: nextPlan.billingCycle,
      isActive: nextPlan.isActive,
      sortOrder: nextPlan.sortOrder,
      features: nextPlan.features,
    },
  });

  return nextPlan;
}

async function setSubscriptionAmountInr(amountInr) {
  runtimeSettingsCache.set(subscriptionAmountSettingKey, String(amountInr));

  await syncPrimarySubscriptionPlan(amountInr);

  const adminSetting = getAdminSettingDelegate();
  if (adminSetting) {
    await adminSetting.upsert({
      where: { key: subscriptionAmountSettingKey },
      create: {
        key: subscriptionAmountSettingKey,
        value: String(amountInr),
      },
      update: {
        value: String(amountInr),
      },
    });
  }

  const appSetting = getAppSettingDelegate();
  if (!appSetting) {
    return {
      key: subscriptionAmountSettingKey,
      value: String(amountInr),
    };
  }

  return appSetting.upsert({
    where: { key: subscriptionAmountSettingKey },
    create: {
      key: subscriptionAmountSettingKey,
      value: String(amountInr),
    },
    update: {
      value: String(amountInr),
    },
  });
}

async function getOrCreateRazorpayPlanIdForPricing({ amountMinor, currency }) {
  if (!razorpay) {
    throw new Error("Razorpay checkout is not configured.");
  }

  const normalizedCurrency = normalizeCurrencyCode(currency);
  const normalizedAmountMinor = normalizeAmountMinor(amountMinor, normalizedCurrency);
  if (!normalizedAmountMinor) {
    throw new Error("Invalid subscription amount.");
  }

  const planCacheKey = `RAZORPAY_PLAN_ID_${normalizedCurrency}_${normalizedAmountMinor}`;
  const cachedPlanFromMemory = runtimeSettingsCache.get(planCacheKey);
  if (cachedPlanFromMemory) {
    return cachedPlanFromMemory;
  }

  const adminSetting = getAdminSettingDelegate();
  if (adminSetting) {
    const cachedPlanFromAdminSetting = await adminSetting.findUnique({
      where: { key: planCacheKey },
      select: { value: true },
    });
    if (cachedPlanFromAdminSetting?.value) {
      runtimeSettingsCache.set(planCacheKey, cachedPlanFromAdminSetting.value);
      return cachedPlanFromAdminSetting.value;
    }
  }

  const appSetting = getAppSettingDelegate();
  if (!appSetting && razorpayPlanId) {
    return razorpayPlanId;
  }

  const cachedPlan = appSetting
    ? await appSetting.findUnique({
        where: { key: planCacheKey },
        select: { value: true },
      })
    : null;

  if (cachedPlan?.value) {
    runtimeSettingsCache.set(planCacheKey, cachedPlan.value);
    return cachedPlan.value;
  }

  const plan = await razorpay.plans.create({
    period: "monthly",
    interval: 1,
    item: {
      name: `Cert/Gen Pro ${normalizedCurrency} ${fromMinorUnits(normalizedAmountMinor, normalizedCurrency)}`,
      amount: normalizedAmountMinor,
      currency: normalizedCurrency,
      description: "Monthly certificate generator subscription",
    },
    notes: {
      amountMinor: String(normalizedAmountMinor),
      currency: normalizedCurrency,
      source: "bulkcertify-admin-setting",
    },
  });

  const createdPlanId = String(plan.id);
  runtimeSettingsCache.set(planCacheKey, createdPlanId);

  if (adminSetting) {
    await adminSetting.upsert({
      where: { key: planCacheKey },
      create: {
        key: planCacheKey,
        value: createdPlanId,
      },
      update: {
        value: createdPlanId,
      },
    });
  }

  if (appSetting) {
    await appSetting.upsert({
      where: { key: planCacheKey },
      create: {
        key: planCacheKey,
        value: createdPlanId,
      },
      update: {
        value: createdPlanId,
      },
    });
  }

  return createdPlanId;
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
  let usage = await prisma.guestUsage.upsert({
    where: { cookieId },
    create: { id: generateDbId(), cookieId, remainingUses: guestTrialLimit },
    update: {},
  });

  // Normalize legacy guest trial counts so guests never exceed the trial limit.
  if ((usage.remainingUses || 0) > guestTrialLimit) {
    usage = await prisma.guestUsage.update({
      where: { id: usage.id },
      data: { remainingUses: guestTrialLimit },
    });
  }

  return usage;
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

app.get("/api/subscription-settings", async (_req, res) => {
  try {
    const amountInr = await getSubscriptionAmountInr();
    const currency = "INR";
    const amountMinor = toMinorUnits(amountInr, currency);
    return res.json({
      amount: amountInr,
      amountMinor,
      amountInr,
      currency,
      supportedCurrencies: supportedSubscriptionCurrencies,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load subscription settings." });
  }
});

app.get("/api/plans", async (_req, res) => {
  try {
    const plans = await getSubscriptionPlans({ includeInactive: false });
    return res.json({ plans });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load plans." });
  }
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
      const isLegacyPlaceholder =
        !existing.passwordHash || existing.passwordHash === "legacy-missing-password";

      if (!isLegacyPlaceholder) {
        return res.status(409).json({ error: "User already exists. Please log in." });
      }

      const upgradedUser = await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hashPassword(password),
          isAdmin: existing.isAdmin || identifier === adminEmail,
        },
      });

      await logActivity(req, {
        action: "AUTH_LEGACY_PASSWORD_SET",
        email: upgradedUser.email,
        targetType: "USER",
        targetId: upgradedUser.id,
      });

      return res.status(200).json({ account: await toAccountPayloadWithMonthlyUsage(upgradedUser) });
    }

    const user = await prisma.user.create({
      data: {
        id: generateDbId(),
        email: identifier,
        passwordHash: hashPassword(password),
        isAdmin: identifier === adminEmail,
        trialUsageCount: accountMonthlyTrialLimit,
        isSubscribed: false,
      },
    });

    await logActivity(req, {
      action: "AUTH_SIGNUP",
      email: user.email,
      targetType: "USER",
      targetId: user.id,
      details: { isAdmin: user.isAdmin },
    });

    return res.status(201).json({ account: await toAccountPayloadWithMonthlyUsage(user) });
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
    if (user && (!user.passwordHash || user.passwordHash === "legacy-missing-password")) {
      await logActivity(req, {
        action: "AUTH_LOGIN_FAILED",
        email: identifier,
        targetType: "USER",
        details: { reason: "LEGACY_PASSWORD_NEEDS_RESET" },
      });
      return res.status(401).json({
        error: "This account needs a password reset. Use Sign Up once with the same username to set your password.",
      });
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      await logActivity(req, {
        action: "AUTH_LOGIN_FAILED",
        email: identifier,
        targetType: "USER",
        details: { reason: "INVALID_CREDENTIALS" },
      });
      return res.status(401).json({ error: "Incorrect login password." });
    }

    await logActivity(req, {
      action: "AUTH_LOGIN_SUCCESS",
      email: user.email,
      targetType: "USER",
      targetId: user.id,
    });

    return res.json({ account: await toAccountPayloadWithMonthlyUsage(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not log in." });
  }
});

// Google OAuth endpoints
app.get("/api/auth/google/init", (_req, res) => {
  try {
    if (!googleClientId) {
      return res.status(400).json({ error: "Google OAuth is not configured." });
    }
    return res.json({ clientId: googleClientId });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not initialize Google auth." });
  }
});

app.post("/api/auth/google/verify", async (req, res) => {
  try {
    if (!googleOAuthClient) {
      return res.status(400).json({ error: "Google OAuth is not configured." });
    }

    const token = String(req.body?.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "Token is required." });
    }

    // Verify the token
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: token,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ error: "Invalid token." });
    }

    const email = String(payload.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Email not found in token." });
    }

    const googleId = String(payload.sub || "");
    const name = String(payload.name || "");

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Create new user with OAuth login
      user = await prisma.user.create({
        data: {
          id: generateDbId(),
          email,
          passwordHash: "oauth-google",
          isAdmin: email === adminEmail,
          trialUsageCount: accountMonthlyTrialLimit,
          isSubscribed: false,
        },
      });

      await logActivity(req, {
        action: "AUTH_OAUTH_SIGNUP",
        email: user.email,
        targetType: "USER",
        targetId: user.id,
        details: { provider: "GOOGLE", googleId, name },
      });
    } else if (user.passwordHash === "legacy-missing-password" || !user.passwordHash) {
      // Upgrade legacy user to OAuth
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: "oauth-google" },
      });

      await logActivity(req, {
        action: "AUTH_OAUTH_UPGRADED",
        email: user.email,
        targetType: "USER",
        targetId: user.id,
        details: { provider: "GOOGLE", googleId, name },
      });
    } else {
      await logActivity(req, {
        action: "AUTH_OAUTH_LOGIN",
        email: user.email,
        targetType: "USER",
        targetId: user.id,
        details: { provider: "GOOGLE", googleId },
      });
    }

    return res.json({ account: await toAccountPayloadWithMonthlyUsage(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Google authentication failed." });
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
        message: `Your ${guestTrialLimit} free guest use${guestTrialLimit === 1 ? "" : "s"} is finished. Please sign in to continue.`,
      });
    }

    const refreshed = await prisma.guestUsage.findUnique({ where: { id: usage.id } });
    await logActivity(req, {
      action: "GUEST_USAGE_CONSUMED",
      targetType: "GUEST",
      targetId: usage.id,
      details: {
        remainingUses: refreshed?.remainingUses ?? 0,
      },
    });
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
    res.json(await toAccountPayloadWithMonthlyUsage(user));
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load account." });
  }
});

app.get("/api/profile", requireLocalAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req);
    const subscribed = isActiveSubscriber(user);
    const trialUsageCount = await getUserMonthlyRemainingUses(user);

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
        trialUsageCount,
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

    if (isAdminUser(user)) {
      return res.json({
        allowed: true,
        trialUsageCount: user.trialUsageCount,
        isSubscribed: true,
        isAdmin: true,
        canGenerate: true,
      });
    }

    if (isActiveSubscriber(user)) {
      return res.json({
        allowed: true,
        trialUsageCount: user.trialUsageCount,
        isSubscribed: true,
        isAdmin: false,
        canGenerate: true,
      });
    }

    const consumedThisMonth = await getUserMonthlyConsumedCount(user.id);
    const remainingBeforeConsume = Math.max(accountMonthlyTrialLimit - consumedThisMonth, 0);

    if (remainingBeforeConsume <= 0) {
      return res.status(402).json({
        allowed: false,
        reason: "TRIAL_EXHAUSTED",
        message: "Your monthly free uses are over. You will get 2 free uses again next month.",
      });
    }

    const remainingAfterConsume = Math.max(remainingBeforeConsume - 1, 0);

    await logActivity(req, {
      action: "USER_USAGE_CONSUMED",
      targetType: "USER",
      targetId: user.id,
      details: {
        trialUsageCount: remainingAfterConsume,
        monthStart: getMonthWindowStart().toISOString(),
      },
    });

    return res.json({
      allowed: true,
      trialUsageCount: remainingAfterConsume,
      isSubscribed: false,
      isAdmin: false,
      canGenerate: remainingAfterConsume > 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not validate usage." });
  }
});

/**
 * POST /api/razorpay/create-subscription
 * Endpoint to initiate a checkout flow with Razorpay.
 * It resolves the requested currency, verifies if the plan has a valid price
 * for that currency in its `prices` configuration, generates a Razorpay plan
 * (if needed), and creates a subscription linked to the user.
 */
app.post("/api/razorpay/create-subscription", requireLocalAuth, async (req, res) => {
  if (!razorpay || !razorpayKeyId) {
    return res.status(500).json({ error: "Razorpay checkout is not configured." });
  }

  try {
    const user = await getOrCreateUser(req);
    const requestedPlanId = String(req.body?.planId || "").trim();
    const countryCode = detectCountryCode(req);
    let currency = resolveCurrencyForRequest(req, req.body?.currency);
    let amountMinor = null;
    let selectedPlan = null;
    const activePlans = await getSubscriptionPlans({ includeInactive: false });

    if (requestedPlanId) {
      selectedPlan = activePlans.find((plan) => plan.id === requestedPlanId);
      if (!selectedPlan) {
        return res.status(400).json({ error: "Selected plan is not available." });
      }
      currency = normalizeCurrencyCode(req.body?.currency || currency);
      const planAmountMajor = selectedPlan.prices?.[currency];
      if (planAmountMajor) {
        amountMinor = toMinorUnits(planAmountMajor, currency);
      }
    } else {
      amountMinor = normalizeAmountMinor(req.body?.amountMinor, currency);

      if (!amountMinor) {
        const requestedAmountMajor = req.body?.amount;
        amountMinor = toMinorUnits(requestedAmountMajor, currency);
      }

      if (!amountMinor && currency === "INR") {
        const requestedAmountInr = normalizeSubscriptionAmountInr(req.body?.amountInr);
        if (requestedAmountInr) {
          amountMinor = toMinorUnits(requestedAmountInr, "INR");
        }
      }

      if (!amountMinor) {
        const planForCurrency = activePlans.find((plan) => Boolean(plan.prices?.[currency]));
        if (planForCurrency) {
          selectedPlan = planForCurrency;
          amountMinor = toMinorUnits(planForCurrency.prices[currency], currency);
        }
      }

      if (!amountMinor && currency === "INR") {
        const amountInr = await getSubscriptionAmountInr();
        amountMinor = toMinorUnits(amountInr, "INR");
      }
    }

    if (!amountMinor) {
      return res.status(400).json({ error: "A valid amount is required for the selected currency." });
    }

    const amount = fromMinorUnits(amountMinor, currency);
    let planId = await getOrCreateRazorpayPlanIdForPricing({ amountMinor, currency });
    if (!planId && razorpayPlanId) {
      planId = razorpayPlanId;
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 120,
      customer_notify: 1,
      notes: {
        email: user.email,
        userId: user.id,
        amountMinor: String(amountMinor),
        currency,
        countryCode,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionId: String(subscription.id),
        isSubscribed: false,
      },
    });

    await logActivity(req, {
      action: "SUBSCRIPTION_CREATED",
      targetType: "SUBSCRIPTION",
      targetId: String(subscription.id),
      details: { userId: user.id },
    });

    return res.json({
      keyId: razorpayKeyId,
      subscriptionId: String(subscription.id),
      provider: "RAZORPAY",
      countryCode,
      currency,
      amountMinor,
      amount,
      amountInr: currency === "INR" && amount !== null ? Math.floor(amount) : null,
      planId: requestedPlanId || null,
      planCurrency: selectedPlan?.currency || null,
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

    await logActivity(req, {
      action: "PAYMENT_VERIFIED",
      email: user.email,
      targetType: "SUBSCRIPTION",
      targetId: String(subscriptionId),
      details: { paymentId: String(paymentId) },
    });

    return res.json({
      account: {
        email: refreshed?.email || user.email,
        trialUsageCount: refreshed?.trialUsageCount ?? accountMonthlyTrialLimit,
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

app.get("/api/admin/overview", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const [totalUsers, activeSubscribers, totalGuests] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          isSubscribed: true,
          OR: [
            { subscriptionEndDate: null },
            { subscriptionEndDate: { gt: new Date() } },
          ],
        },
      }),
      prisma.guestUsage.count(),
    ]);

    const [totalUserTrialConsumed, totalGuestTrialConsumed] = await Promise.all([
      prisma.activityLog.count({ where: { action: "USER_USAGE_CONSUMED" } }),
      prisma.activityLog.count({ where: { action: "GUEST_USAGE_CONSUMED" } }),
    ]);

    const totalPayments = await prisma.planHistory.count();
    const activePlans = await prisma.planHistory.count({ where: { status: "ACTIVE" } });

    return res.json({
      overview: {
        totalUsers,
        activeSubscribers,
        totalGuests,
        totalPayments,
        activePlans,
        subscriptionAmountInr: await getSubscriptionAmountInr(),
        totalGenerations: totalUserTrialConsumed + totalGuestTrialConsumed,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load admin overview." });
  }
});

app.get("/api/admin/subscription-settings", requireLocalAuth, requireAdmin, async (_req, res) => {
  try {
    const amountInr = await getSubscriptionAmountInr();
    const currency = "INR";
    const amountMinor = toMinorUnits(amountInr, currency);
    return res.json({
      amount: amountInr,
      amountMinor,
      amountInr,
      currency,
      supportedCurrencies: supportedSubscriptionCurrencies,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load subscription settings." });
  }
});

app.patch("/api/admin/subscription-settings", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const nextAmountInr = normalizeSubscriptionAmountInr(req.body?.amountInr);
    if (!nextAmountInr) {
      return res.status(400).json({ error: "Amount must be an integer between 1 and 1000000 INR." });
    }

    const previousAmountInr = await getSubscriptionAmountInr();
    await setSubscriptionAmountInr(nextAmountInr);

    await logActivity(req, {
      action: "ADMIN_SUBSCRIPTION_AMOUNT_UPDATED",
      email: req.localAuthEmail,
      targetType: "SUBSCRIPTION_SETTING",
      targetId: subscriptionAmountSettingKey,
      details: {
        previousAmountInr,
        nextAmountInr,
      },
    });

    return res.json({
      amount: nextAmountInr,
      amountMinor: toMinorUnits(nextAmountInr, "INR"),
      amountInr: nextAmountInr,
      currency: "INR",
      supportedCurrencies: supportedSubscriptionCurrencies,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not update subscription settings." });
  }
});

app.get("/api/admin/plans", requireLocalAuth, requireAdmin, async (_req, res) => {
  try {
    const plans = await getSubscriptionPlans({ includeInactive: true });
    return res.json({ plans });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load plans." });
  }
});

app.post("/api/admin/plans", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const existingPlans = await getSubscriptionPlans({ includeInactive: true });
    const fallbackAmount = await getSubscriptionAmountInr();
    const plan = normalizePlanInput(req.body || {}, fallbackAmount);

    if (!plan) {
      return res.status(400).json({ error: "Plan name and valid amount are required." });
    }

    const updatedPlans = await setSubscriptionPlans([...existingPlans, plan]);

    await logActivity(req, {
      action: "ADMIN_PLAN_CREATED",
      email: req.localAuthEmail,
      targetType: "PLAN",
      targetId: plan.id,
      details: {
        name: plan.name,
        priceInr: plan.priceInr,
        currency: plan.currency,
        amountMinor: plan.amountMinor,
      },
    });

    return res.status(201).json({ plans: updatedPlans, plan });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not create plan." });
  }
});

app.patch("/api/admin/plans/:id", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const planId = String(req.params.id || "").trim();
    if (!planId) {
      return res.status(400).json({ error: "Plan id is required." });
    }

    const existingPlans = await getSubscriptionPlans({ includeInactive: true });
    const existingPlan = existingPlans.find((entry) => entry.id === planId);
    if (!existingPlan) {
      return res.status(404).json({ error: "Plan not found." });
    }

    const merged = normalizePlanInput({ ...existingPlan, ...(req.body || {}), id: planId, createdAt: existingPlan.createdAt }, existingPlan.priceInr);
    if (!merged) {
      return res.status(400).json({ error: "Invalid plan payload." });
    }

    const nextPlans = existingPlans.map((entry) => (entry.id === planId ? merged : entry));
    const updatedPlans = await setSubscriptionPlans(nextPlans);

    await logActivity(req, {
      action: "ADMIN_PLAN_UPDATED",
      email: req.localAuthEmail,
      targetType: "PLAN",
      targetId: planId,
      details: {
        name: merged.name,
        priceInr: merged.priceInr,
        currency: merged.currency,
        amountMinor: merged.amountMinor,
        isActive: merged.isActive,
      },
    });

    return res.json({ plans: updatedPlans, plan: merged });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not update plan." });
  }
});

app.delete("/api/admin/plans/:id", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const planId = String(req.params.id || "").trim();
    if (!planId) {
      return res.status(400).json({ error: "Plan id is required." });
    }

    const existingPlans = await getSubscriptionPlans({ includeInactive: true });
    const target = existingPlans.find((entry) => entry.id === planId);
    if (!target) {
      return res.status(404).json({ error: "Plan not found." });
    }

    const nextPlans = existingPlans.filter((entry) => entry.id !== planId);
    if (!nextPlans.length) {
      return res.status(400).json({ error: "At least one plan must remain." });
    }

    const updatedPlans = await setSubscriptionPlans(nextPlans);

    await logActivity(req, {
      action: "ADMIN_PLAN_DELETED",
      email: req.localAuthEmail,
      targetType: "PLAN",
      targetId: planId,
      details: { name: target.name },
    });

    return res.json({ plans: updatedPlans });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not delete plan." });
  }
});

app.get("/api/admin/activities", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const activities = await prisma.activityLog.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { email: true },
        },
      },
    });

    return res.json({
      activities: activities.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorEmail: entry.user?.email || null,
        targetType: entry.targetType,
        targetId: entry.targetId,
        details: entry.details,
        ipAddress: entry.ipAddress,
        createdAt: entry.createdAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load activity logs." });
  }
});

app.get("/api/admin/clients", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const users = await prisma.user.findMany({
      where: search
        ? {
            email: { contains: search },
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        trialUsageCount: true,
        isSubscribed: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        createdAt: true,
      },
    });

    return res.json({ clients: users });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load clients." });
  }
});

app.patch("/api/admin/clients/:id", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    if (!userId) {
      return res.status(400).json({ error: "Client id is required." });
    }

    const payload = {};
    if (typeof req.body?.trialUsageCount === "number") {
      payload.trialUsageCount = Math.max(0, Math.min(1000, Math.floor(req.body.trialUsageCount)));
    }
    if (typeof req.body?.isSubscribed === "boolean") {
      payload.isSubscribed = req.body.isSubscribed;
      if (!req.body.isSubscribed) {
        payload.subscriptionEndDate = null;
      }
    }

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: payload,
      select: {
        id: true,
        email: true,
        isAdmin: true,
        trialUsageCount: true,
        isSubscribed: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        createdAt: true,
      },
    });

    await logActivity(req, {
      action: "ADMIN_CLIENT_UPDATED",
      email: req.localAuthEmail,
      targetType: "USER",
      targetId: userId,
      details: payload,
    });

    return res.json({ client: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not update client." });
  }
});

app.post("/api/admin/clients/:id/reset-trial", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    const monthStart = getMonthWindowStart();

    await prisma.activityLog.deleteMany({
      where: {
        userId,
        action: "USER_USAGE_CONSUMED",
        createdAt: { gte: monthStart },
      },
    });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { trialUsageCount: accountMonthlyTrialLimit },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        trialUsageCount: true,
        isSubscribed: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        createdAt: true,
      },
    });

    await logActivity(req, {
      action: "ADMIN_CLIENT_TRIAL_RESET",
      email: req.localAuthEmail,
      targetType: "USER",
      targetId: userId,
      details: {
        monthStart: monthStart.toISOString(),
      },
    });

    return res.json({ client: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not reset trial usage." });
  }
});

app.patch("/api/admin/clients/:id/username", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    const username = normalizeAuthIdentifier(req.body?.username || req.body?.email || "");

    if (!userId) {
      return res.status(400).json({ error: "Client id is required." });
    }

    if (!username) {
      return res.status(400).json({ error: "Username is required." });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.status(404).json({ error: "Client not found." });
    }

    if (target.email === adminEmail && username !== adminEmail) {
      return res.status(400).json({
        error: "Admin username must match ADMIN_EMAIL. Update ADMIN_EMAIL first if you want to change it.",
      });
    }

    const duplicate = await prisma.user.findUnique({ where: { email: username } });
    if (duplicate && duplicate.id !== userId) {
      return res.status(409).json({ error: "Username already exists." });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { email: username },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        trialUsageCount: true,
        isSubscribed: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        createdAt: true,
      },
    });

    await logActivity(req, {
      action: "ADMIN_CLIENT_USERNAME_UPDATED",
      email: req.localAuthEmail,
      targetType: "USER",
      targetId: userId,
      details: {
        oldUsername: target.email,
        newUsername: username,
      },
    });

    return res.json({ client: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not update username." });
  }
});

app.patch("/api/admin/clients/:id/password", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    const nextPassword = String(req.body?.password || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "Client id is required." });
    }

    if (!nextPassword) {
      return res.status(400).json({ error: "Password is required." });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.status(404).json({ error: "Client not found." });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(nextPassword) },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        trialUsageCount: true,
        isSubscribed: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        createdAt: true,
      },
    });

    await logActivity(req, {
      action: "ADMIN_CLIENT_PASSWORD_UPDATED",
      email: req.localAuthEmail,
      targetType: "USER",
      targetId: userId,
      details: { updatedFor: target.email },
    });

    return res.json({ client: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not update password." });
  }
});

app.delete("/api/admin/clients/:id", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.status(404).json({ error: "Client not found." });
    }
    if (target.email === adminEmail || target.isAdmin) {
      return res.status(400).json({ error: "Admin account cannot be deleted." });
    }

    await prisma.user.delete({ where: { id: userId } });

    await logActivity(req, {
      action: "ADMIN_CLIENT_DELETED",
      email: req.localAuthEmail,
      targetType: "USER",
      targetId: userId,
      details: { deletedEmail: target.email },
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not delete client." });
  }
});

app.get("/api/admin/payments", requireLocalAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const payments = await prisma.planHistory.findMany({
      take: limit,
      orderBy: [
        { createdAt: "desc" },
      ],
      include: {
        user: {
          select: { email: true },
        },
      },
    });

    return res.json({
      payments: payments.map((payment) => ({
        id: payment.id,
        userId: payment.userId,
        userEmail: payment.user?.email || null,
        planName: payment.planName,
        billingCycle: payment.billingCycle,
        status: payment.status,
        subscriptionId: payment.subscriptionId,
        subscriptionStartDate: payment.subscriptionStartDate,
        subscriptionEndDate: payment.subscriptionEndDate,
        createdAt: payment.createdAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load payments." });
  }
});

app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});
