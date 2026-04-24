const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { DEFAULT_DB_FILE, openDatabase } = require("../db");

function sendPublicFile(response, fileName) {
  response.sendFile(path.join(__dirname, "..", "public", fileName));
}

function createSessionId() {
  return `SESSION-${crypto.randomBytes(24).toString("hex")}`;
}

function createCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production"
  };
}

function getRequestOrigin(request) {
  const origin = request.get("origin");
  if (origin) {
    return origin;
  }

  const referer = request.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isSameOrigin(request) {
  const requestOrigin = getRequestOrigin(request);
  if (!requestOrigin) {
    return false;
  }

  const expectedOrigin = `${request.protocol}://${request.get("host")}`;
  return requestOrigin === expectedOrigin;
}

async function createApp() {
  if (!fs.existsSync(DEFAULT_DB_FILE)) {
    throw new Error(
      `Database file not found at ${DEFAULT_DB_FILE}. Run "npm run init-db" first.`
    );
  }

  const db = openDatabase(DEFAULT_DB_FILE);
  const app = express();
  const csrfTokens = new Map();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use("/css", express.static(path.join(__dirname, "..", "public", "css")));
  app.use("/js", express.static(path.join(__dirname, "..", "public", "js")));

  app.use(async (request, response, next) => {
    try {
      const sessionId = request.cookies.sid;

      if (!sessionId) {
        request.currentUser = null;
        next();
        return;
      }

      const row = await db.get(
        `
          SELECT
            sessions.id AS session_id,
            users.id AS id,
            users.username AS username,
            users.role AS role,
            users.display_name AS display_name
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          WHERE sessions.id = ?
        `,
        [sessionId]
      );

      request.currentUser = row
        ? {
            sessionId: row.session_id,
            id: row.id,
            username: row.username,
            role: row.role,
            displayName: row.display_name
          }
        : null;

      next();
    } catch (error) {
      next(error);
    }
  });

  function requireAuth(request, response, next) {
    if (!request.currentUser) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    next();
  }

  function requireAdmin(request, response, next) {
    if (!request.currentUser) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    if (request.currentUser.role !== "admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    next();
  }

  function requireAuthPage(request, response, next) {
    if (!request.currentUser) {
      response.redirect("/login");
      return;
    }

    next();
  }

  function requireAdminPage(request, response, next) {
    if (!request.currentUser) {
      response.redirect("/login");
      return;
    }

    if (request.currentUser.role !== "admin") {
      response.status(403).send("Forbidden");
      return;
    }

    next();
  }

  function requireSameOrigin(request, response, next) {
    if (!isSameOrigin(request)) {
      response.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }

    next();
  }

  function requireCsrf(request, response, next) {
    if (!request.currentUser) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!isSameOrigin(request)) {
      response.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }

    const expectedToken = csrfTokens.get(request.currentUser.sessionId);
    const providedToken = request.get("x-csrf-token");

    if (!expectedToken || !providedToken || providedToken !== expectedToken) {
      response.status(403).json({ error: "Invalid CSRF token." });
      return;
    }

    next();
  }

  app.get("/", (_request, response) => sendPublicFile(response, "index.html"));
  app.get("/login", (_request, response) => sendPublicFile(response, "login.html"));
  app.get("/notes", requireAuthPage, (_request, response) => sendPublicFile(response, "notes.html"));
  app.get("/settings", requireAuthPage, (_request, response) => sendPublicFile(response, "settings.html"));
  app.get("/admin", requireAdminPage, (_request, response) => sendPublicFile(response, "admin.html"));

  app.get("/api/me", (request, response) => {
    response.json({ user: request.currentUser });
  });

  app.get("/api/csrf-token", requireAuth, (request, response) => {
    let token = csrfTokens.get(request.currentUser.sessionId);

    if (!token) {
      token = createCsrfToken();
      csrfTokens.set(request.currentUser.sessionId, token);
    }

    response.json({ csrfToken: token });
  });

  app.post("/api/login", requireSameOrigin, async (request, response) => {
    const username = String(request.body.username || "").trim();
    const password = String(request.body.password || "");

    const user = await db.get(
      `
        SELECT id, username, role, display_name
        FROM users
        WHERE username = ? AND password = ?
      `,
      [username, password]
    );

    if (!user) {
      response.status(401).json({ error: "Invalid username or password." });
      return;
    }

    const previousSessionId = request.cookies.sid;
    const sessionId = createSessionId();

    if (previousSessionId) {
      await db.run("DELETE FROM sessions WHERE id = ?", [previousSessionId]);
      csrfTokens.delete(previousSessionId);
    }

    await db.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
    await db.run(
      "INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)",
      [sessionId, user.id, new Date().toISOString()]
    );

    csrfTokens.set(sessionId, createCsrfToken());

    response.cookie("sid", sessionId, getCookieOptions());

    response.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name
      }
    });
  });

  app.post("/api/logout", requireAuth, requireCsrf, async (request, response) => {
    const sessionId = request.currentUser.sessionId;

    await db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
    csrfTokens.delete(sessionId);

    response.clearCookie("sid", getCookieOptions());
    response.json({ ok: true });
  });

  app.get("/api/notes", requireAuth, async (request, response) => {
    const search = String(request.query.search || "").trim();
    const likeValue = `%${search}%`;

    const notes = await db.all(
      `
        SELECT
          notes.id,
          notes.owner_id AS ownerId,
          users.username AS ownerUsername,
          notes.title,
          notes.body,
          notes.pinned,
          notes.created_at AS createdAt
        FROM notes
        JOIN users ON users.id = notes.owner_id
        WHERE notes.owner_id = ?
          AND (notes.title LIKE ? OR notes.body LIKE ?)
        ORDER BY notes.pinned DESC, notes.id DESC
      `,
      [request.currentUser.id, likeValue, likeValue]
    );

    response.json({ notes });
  });

  app.post("/api/notes", requireAuth, requireCsrf, async (request, response) => {
    const title = String(request.body.title || "").trim();
    const body = String(request.body.body || "");
    const pinned = request.body.pinned ? 1 : 0;

    const result = await db.run(
      "INSERT INTO notes (owner_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)",
      [request.currentUser.id, title, body, pinned, new Date().toISOString()]
    );

    response.status(201).json({
      ok: true,
      noteId: result.lastID
    });
  });

  app.get("/api/settings", requireAuth, async (request, response) => {
    const settings = await db.get(
      `
        SELECT
          users.id AS userId,
          users.username,
          users.role,
          users.display_name AS displayName,
          settings.status_message AS statusMessage,
          settings.theme,
          settings.email_opt_in AS emailOptIn
        FROM settings
        JOIN users ON users.id = settings.user_id
        WHERE settings.user_id = ?
      `,
      [request.currentUser.id]
    );

    response.json({ settings });
  });

  app.post("/api/settings", requireAuth, requireCsrf, async (request, response) => {
    const displayName = String(request.body.displayName || "").trim();
    const statusMessage = String(request.body.statusMessage || "");
    const requestedTheme = String(request.body.theme || "classic");
    const allowedThemes = new Set(["classic", "dark", "light"]);
    const theme = allowedThemes.has(requestedTheme) ? requestedTheme : "classic";
    const emailOptIn = request.body.emailOptIn ? 1 : 0;

    await db.run("UPDATE users SET display_name = ? WHERE id = ?", [
      displayName,
      request.currentUser.id
    ]);

    await db.run(
      "UPDATE settings SET status_message = ?, theme = ?, email_opt_in = ? WHERE user_id = ?",
      [statusMessage, theme, emailOptIn, request.currentUser.id]
    );

    response.json({ ok: true });
  });

  app.post("/api/settings/toggle-email", requireAuth, requireCsrf, async (request, response) => {
    const enabled = request.body.enabled ? 1 : 0;

    await db.run("UPDATE settings SET email_opt_in = ? WHERE user_id = ?", [
      enabled,
      request.currentUser.id
    ]);

    response.json({
      ok: true,
      userId: request.currentUser.id,
      emailOptIn: enabled
    });
  });

  app.get("/api/admin/users", requireAdmin, async (_request, response) => {
    const users = await db.all(`
      SELECT
        users.id,
        users.username,
        users.role,
        users.display_name AS displayName,
        COUNT(notes.id) AS noteCount
      FROM users
      LEFT JOIN notes ON notes.owner_id = users.id
      GROUP BY users.id, users.username, users.role, users.display_name
      ORDER BY users.id
    `);

    response.json({ users });
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: "Internal server error." });
  });

  return app;
}

module.exports = {
  createApp
};
