require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.disable("x-powered-by");

function getRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

app.use((req, _res, next) => {
  req.id = req.headers["x-request-id"] || getRequestId();
  next();
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});

// JSON body parsing (10kb limit)
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// CORS: configured via ALLOWED_ORIGINS env var (comma-separated) or dev fallback
const rawOrigins = process.env.ALLOWED_ORIGINS || "";
const prodOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const defaultProdOrigins = [
  "https://gemstonediamond.com",
  "https://www.gemstonediamond.com",
];

const allowedOrigins =
  prodOrigins.length > 0
    ? prodOrigins
    : process.env.NODE_ENV === "production"
      ? defaultProdOrigins
      : [
          "http://localhost:3000",
          "http://localhost:5000",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:5000",
        ];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / server-to-server
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // allow any localhost in dev
      if (
        process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return cb(null, true);
      }
      return cb(new Error("CORS_NOT_ALLOWED"));
    },
    credentials: true,
  })
);

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function deleteUploadedFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return;
  for (const f of files) {
    if (!f || !f.path) continue;
    fs.unlink(f.path, () => {});
  }
}

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "application/pdf",
];

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${unique}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

function getAdminTokenFromRequest(req) {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const x = req.headers["x-admin-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return "";
}

function requireAdmin(_req, _res, next) {
  return next();
}

function asString(v, maxLen) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function isValidEmail(email) {
  if (!email) return false;
  const s = String(email).trim();
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function saveSubmission(kind, payload) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const filePath = path.join(DATA_DIR, `${kind}.jsonl`);
    const line = JSON.stringify(payload) + "\n";
    fs.appendFile(filePath, line, (err) => {
      if (err) {
        console.error(`Error saving ${kind} submission:`, err);
      }
    });
  } catch (err) {
    console.error(`Unexpected error preparing to save ${kind} submission:`, err);
  }
}

function readSubmissions(kind) {
  const filePath = path.join(DATA_DIR, `${kind}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.error(`Error parsing ${kind} submission line:`, err);
        return null;
      }
    })
    .filter(Boolean);
}

// serve uploaded media
app.use("/uploads", express.static(UPLOAD_DIR));

// Simple health check to verify server is running
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// New dedicated API for custom diamond requests
app.post("/api/custom-diamond", (req, res) => {
  const {
    name,
    email,
    shape,
    carat,
    color,
    clarity,
    cutGrade,
    certification,
    budget,
    targetDate,
    settingStyle,
    notes,
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({
      message: "Missing required fields: name and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "diamond",
    name: asString(name, 120),
    email: asString(email, 254),
    shape: asString(shape, 60),
    carat: asString(carat, 40),
    color: asString(color, 40),
    clarity: asString(clarity, 40),
    cutGrade: asString(cutGrade, 40),
    certification: asString(certification, 80),
    budget: asString(budget, 80),
    targetDate: asString(targetDate, 40),
    settingStyle: asString(settingStyle, 80),
    notes: asString(notes, 2000),
    submittedAt: new Date().toISOString(),
  };

  console.log("Custom diamond submission:", submission);
  saveSubmission("custom-diamond", submission);

  return res.status(200).json({
    message: "Custom diamond request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/custom-diamond", (req, res) => {
  try {
    const items = readSubmissions("custom-diamond");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading custom diamond submissions:", err);
    return res
      .status(500)
      .json({ message: "Failed to load diamond data", requestId: req.id });
  }
});

// New APIs for custom jewelry (GET + POST)
app.post("/api/custom-jewelry", (req, res) => {
  const {
    name,
    email,
    phone,
    jewelryType,
    budgetRange,
    targetDate,
    preferredMetal,
    stoneType,
    stoneShape,
    ringSize,
    stylePreference,
    referenceLinks,
    engravingText,
    message,
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({
      message: "Missing required fields: name and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "jewelry",
    name: asString(name, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    jewelryType: asString(jewelryType, 80),
    budgetRange: asString(budgetRange, 80),
    targetDate: asString(targetDate, 40),
    preferredMetal: asString(preferredMetal, 60),
    stoneType: asString(stoneType, 60),
    stoneShape: asString(stoneShape, 60),
    ringSize: asString(ringSize, 20),
    stylePreference: asString(stylePreference, 200),
    referenceLinks: asString(referenceLinks, 2000),
    engravingText: asString(engravingText, 200),
    message: asString(message, 2000),
    submittedAt: new Date().toISOString(),
  };

  console.log("Custom jewelry submission:", submission);
  saveSubmission("custom-jewelry", submission);

  return res.status(200).json({
    message: "Custom jewelry request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/custom-jewelry", (req, res) => {
  try {
    const items = readSubmissions("custom-jewelry");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading custom jewelry submissions:", err);
    return res
      .status(500)
      .json({ message: "Failed to load jewelry data", requestId: req.id });
  }
});

// Request page: manufacturing
app.post("/api/request/manufacturing", upload.array("media", 4), (req, res) => {
  const {
    storeName,
    contactName,
    email,
    phone,
    jewelryType,
    metal,
    ringSize,
    details,
  } = req.body || {};

  const media =
    (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    })) || [];

  if (!storeName || !email) {
    deleteUploadedFiles(req.files);
    return res.status(400).json({
      message: "Missing required fields: storeName and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    deleteUploadedFiles(req.files);
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "manufacturing",
    storeName: asString(storeName, 160),
    contactName: asString(contactName, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    jewelryType: asString(jewelryType, 80),
    metal: asString(metal, 60),
    ringSize: asString(ringSize, 20),
    details: asString(details, 4000),
    media,
    submittedAt: new Date().toISOString(),
  };

  console.log("Manufacturing request submission:", submission);
  saveSubmission("request-manufacturing", submission);

  return res.status(200).json({
    message: "Manufacturing request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/request/manufacturing", (req, res) => {
  try {
    const items = readSubmissions("request-manufacturing");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading manufacturing requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load manufacturing requests", requestId: req.id });
  }
});

// Request page: diamond
app.post("/api/request/diamond", upload.array("media", 4), (req, res) => {
  const {
    storeName,
    contactName,
    email,
    phone,
    shape,
    caratRange,
    certification,
    details,
  } = req.body || {};

  const media =
    (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    })) || [];

  if (!storeName || !email) {
    deleteUploadedFiles(req.files);
    return res.status(400).json({
      message: "Missing required fields: storeName and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    deleteUploadedFiles(req.files);
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "diamond",
    storeName: asString(storeName, 160),
    contactName: asString(contactName, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    shape: asString(shape, 80),
    caratRange: asString(caratRange, 60),
    certification: asString(certification, 80),
    details: asString(details, 4000),
    media,
    submittedAt: new Date().toISOString(),
  };

  console.log("Diamond request submission:", submission);
  saveSubmission("request-diamond", submission);

  return res.status(200).json({
    message: "Diamond request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/request/diamond", (req, res) => {
  try {
    const items = readSubmissions("request-diamond");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading diamond requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load diamond requests", requestId: req.id });
  }
});

// Request page: gemstone
app.post("/api/request/gemstone", upload.array("media", 4), (req, res) => {
  const {
    storeName,
    contactName,
    email,
    phone,
    stone,
    cut,
    details,
  } = req.body || {};

  const media =
    (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    })) || [];

  if (!storeName || !email) {
    deleteUploadedFiles(req.files);
    return res.status(400).json({
      message: "Missing required fields: storeName and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    deleteUploadedFiles(req.files);
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "gemstone",
    storeName: asString(storeName, 160),
    contactName: asString(contactName, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    stone: asString(stone, 80),
    cut: asString(cut, 80),
    details: asString(details, 4000),
    media,
    submittedAt: new Date().toISOString(),
  };

  console.log("Gemstone request submission:", submission);
  saveSubmission("request-gemstone", submission);

  return res.status(200).json({
    message: "Gemstone request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/request/gemstone", (req, res) => {
  try {
    const items = readSubmissions("request-gemstone");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading gemstone requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load gemstone requests", requestId: req.id });
  }
});

// Request page: cutting
app.post("/api/request/cutting", upload.array("media", 4), (req, res) => {
  const {
    storeName,
    contactName,
    email,
    phone,
    shape,
    dimensions,
    details,
  } = req.body || {};

  const media =
    (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    })) || [];

  if (!storeName || !email) {
    deleteUploadedFiles(req.files);
    return res.status(400).json({
      message: "Missing required fields: storeName and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    deleteUploadedFiles(req.files);
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "cutting",
    storeName: asString(storeName, 160),
    contactName: asString(contactName, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    shape: asString(shape, 80),
    dimensions: asString(dimensions, 120),
    details: asString(details, 4000),
    media,
    submittedAt: new Date().toISOString(),
  };

  console.log("Cutting request submission:", submission);
  saveSubmission("request-cutting", submission);

  return res.status(200).json({
    message: "Cutting request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/request/cutting", (req, res) => {
  try {
    const items = readSubmissions("request-cutting");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading cutting requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load cutting requests", requestId: req.id });
  }
});

// Request page: design access
app.post("/api/request/design", upload.array("media", 4), (req, res) => {
  const {
    storeName,
    contactName,
    email,
    phone,
    websiteUrl,
    platform,
    notes,
  } = req.body || {};

  const media =
    (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    })) || [];

  if (!storeName || !email) {
    deleteUploadedFiles(req.files);
    return res.status(400).json({
      message: "Missing required fields: storeName and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    deleteUploadedFiles(req.files);
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "design",
    storeName: asString(storeName, 160),
    contactName: asString(contactName, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    websiteUrl: asString(websiteUrl, 300),
    platform: asString(platform, 80),
    notes: asString(notes, 4000),
    media,
    submittedAt: new Date().toISOString(),
  };

  console.log("Design access request submission:", submission);
  saveSubmission("request-design", submission);

  return res.status(200).json({
    message: "Design access request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/request/design", (req, res) => {
  try {
    const items = readSubmissions("request-design");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading design requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load design requests", requestId: req.id });
  }
});

// Request page: retail support
app.post("/api/request/retail", upload.array("media", 4), (req, res) => {
  const {
    storeName,
    contactName,
    email,
    phone,
    services,
    startMonth,
    notes,
  } = req.body || {};

  const media =
    (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    })) || [];

  if (!storeName || !email) {
    deleteUploadedFiles(req.files);
    return res.status(400).json({
      message: "Missing required fields: storeName and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    deleteUploadedFiles(req.files);
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    type: "retail",
    storeName: asString(storeName, 160),
    contactName: asString(contactName, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    services: asString(services, 2000),
    startMonth: asString(startMonth, 40),
    notes: asString(notes, 4000),
    media,
    submittedAt: new Date().toISOString(),
  };

  console.log("Retail support request submission:", submission);
  saveSubmission("request-retail", submission);

  return res.status(200).json({
    message: "Retail support request received",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.get("/api/request/retail", (req, res) => {
  try {
    const items = readSubmissions("request-retail");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading retail requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load retail requests", requestId: req.id });
  }
});

// Aggregate endpoint for admin UI
app.get("/api/requests", (req, res) => {
  try {
    const manufacturing = readSubmissions("request-manufacturing");
    const diamond = readSubmissions("request-diamond");
    const gemstone = readSubmissions("request-gemstone");
    const cutting = readSubmissions("request-cutting");
    const design = readSubmissions("request-design");
    const retail = readSubmissions("request-retail");

    return res.status(200).json({
      manufacturing,
      diamond,
      gemstone,
      cutting,
      design,
      retail,
      requestId: req.id,
    });
  } catch (err) {
    console.error("Error reading admin requests:", err);
    return res
      .status(500)
      .json({ message: "Failed to load requests", requestId: req.id });
  }
});

app.get("/api/contact", (req, res) => {
  try {
    const items = readSubmissions("contact");
    return res.status(200).json({ items, requestId: req.id });
  } catch (err) {
    console.error("Error reading contact submissions:", err);
    return res
      .status(500)
      .json({ message: "Failed to load contact data", requestId: req.id });
  }
});

app.post("/api/contact", (req, res) => {
  const { name, email, phone, message, inquiryType, ...rest } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({
      message: "Missing required fields: name and email are required.",
      requestId: req.id,
    });
  }
  if (!isValidEmail(email)) {
    return res
      .status(400)
      .json({ message: "Invalid email address.", requestId: req.id });
  }

  const submission = {
    name: asString(name, 120),
    email: asString(email, 254),
    phone: asString(phone, 60),
    inquiryType: asString(inquiryType || "general", 40),
    message: asString(message || rest.notes || "", 4000),
    data: rest,
    submittedAt: new Date().toISOString(),
  };

  console.log("Contact form submission:", submission);
  saveSubmission("contact", submission);

  return res.status(200).json({
    message: "Contact form received successfully",
    submittedAt: submission.submittedAt,
    requestId: req.id,
  });
});

app.use((req, res) => {
  res.status(404).json({ message: "Not found", requestId: req.id });
});

// Central error handler (CORS, multer, etc)
app.use((err, req, res, _next) => {
  const requestId = req && req.id ? req.id : undefined;

  if (err && err.message === "CORS_NOT_ALLOWED") {
    return res
      .status(403)
      .json({ message: "CORS origin not allowed", requestId });
  }

  if (err && err instanceof multer.MulterError) {
    deleteUploadedFiles(req.files);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `File too large. Max is ${MAX_FILE_SIZE_MB}MB`,
        requestId,
      });
    }
    return res
      .status(400)
      .json({ message: `Upload error: ${err.code}`, requestId });
  }

  if (err && typeof err.message === "string" && err.message.startsWith("File type not allowed:")) {
    deleteUploadedFiles(req.files);
    return res.status(415).json({ message: err.message, requestId });
  }

  deleteUploadedFiles(req.files);
  console.error("Unhandled error:", err);
  return res.status(500).json({ message: "Internal server error", requestId });
});

const PORT = parseInt(process.env.PORT || "4000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(
    `[${new Date().toISOString()}] Backend listening on http://${HOST}:${PORT} (env: ${process.env.NODE_ENV || "development"})`
  );
});

function shutdown(signal) {
  console.log(`[${new Date().toISOString()}] Received ${signal}; shutting down...`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

