"use strict";

// Who is signed in: a random token in an HttpOnly, SameSite=Strict cookie,
// looked up in memory. A server restart signs everyone out.
const { randomBytes } = require("crypto");
const users = require("./users");

const COOKIE = "ce_session";
const LIFETIME_MS = 12 * 60 * 60 * 1000;

const logins = new Map(); // token -> { name, expires }

function readToken(req) {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`).exec(req.headers.cookie || "");
  return match ? match[1] : null;
}

// Works for plain upgrade requests too (WebSocket), not only Express ones.
function currentUser(req) {
  const token = readToken(req);
  const login = token && logins.get(token);
  if (!login) return null;
  if (login.expires < Date.now() || !users.exists(login.name)) {
    logins.delete(token);
    return null;
  }
  return login.name;
}

function cookie(value, maxAgeSeconds) {
  // No Secure flag: the demo is plain HTTP over Tailscale, which encrypts
  // the connection itself. Add it if this is ever served over HTTPS.
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function signIn(res, name) {
  for (const [token, login] of logins) if (login.expires < Date.now()) logins.delete(token);
  const token = randomBytes(32).toString("hex");
  logins.set(token, { name, expires: Date.now() + LIFETIME_MS });
  res.setHeader("Set-Cookie", cookie(token, LIFETIME_MS / 1000));
}

function signOut(req, res) {
  const token = readToken(req);
  if (token) logins.delete(token);
  res.setHeader("Set-Cookie", cookie("", 0));
}

// Ends every sign-in for an account, optionally keeping the caller's own.
function revoke(name, keepReq) {
  const keep = keepReq && readToken(keepReq);
  for (const [token, login] of logins) if (login.name === name && token !== keep) logins.delete(token);
}

function requireLogin(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.status(401).json({ error: "Sign in first.", code: "signed_out" });
  next();
}

// Signed in AND past the forced first password change.
function requireUser(req, res, next) {
  requireLogin(req, res, () => {
    if (users.mustChange(req.user)) {
      return res.status(403).json({ error: "Change your temporary password first.", code: "password_change" });
    }
    next();
  });
}

// Slow down password guessing: 5 wrong tries locks that name+address a minute.
const failures = new Map(); // key -> { count, until }
const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;

const throttle = {
  locked(key) {
    const entry = failures.get(key);
    if (entry && entry.until < Date.now()) failures.delete(key);
    return (failures.get(key)?.count || 0) >= MAX_FAILURES;
  },
  fail(key) {
    if (failures.size > 10000) failures.clear();
    const entry = failures.get(key) || { count: 0 };
    failures.set(key, { count: entry.count + 1, until: Date.now() + LOCK_MS });
  },
  clear(key) {
    failures.delete(key);
  },
};

module.exports = { currentUser, signIn, signOut, revoke, requireLogin, requireUser, throttle };
