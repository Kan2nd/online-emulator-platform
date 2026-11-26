"use strict";

// Player accounts, kept in one JSON file. Only session-manager mounts its
// folder: emulator containers see the saves, never the password hashes.
const fs = require("fs");
const path = require("path");
const { randomBytes, randomInt, scrypt, timingSafeEqual } = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(scrypt);
const DATA_DIR = process.env.DATA_DIR || "/data/app";
const FILE = path.join(DATA_DIR, "users.json");

// The account name is also the player's save folder, so the same rule applies.
const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A damaged file must stop the server, not be silently replaced by an empty one.
function load() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, "utf8"))));
  } catch (err) {
    if (err.code === "ENOENT") return new Map();
    throw new Error(`could not read ${FILE}: ${err.message}`);
  }
}

const users = load();

// Write-then-rename, so a crash mid-write cannot truncate the account list.
function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(users), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = await scryptAsync(password, salt, 32);
  return { salt, hash: hash.toString("hex") };
}

// No 0/O or 1/l/I: the admin reads this out or copies it by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const temporaryPassword = () => Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const exists = (name) => users.has(name);
const mustChange = (name) => Boolean(users.get(name)?.mustChange);

function list() {
  return [...users.entries()]
    .map(([name, u]) => ({ name, mustChange: u.mustChange, createdAt: u.createdAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Returns the temporary password; it is only ever shown this once.
async function create(name) {
  if (!NAME.test(String(name || ""))) {
    throw new AccountError(400, "Account names are 1–32 letters, digits, - or _.");
  }
  const password = temporaryPassword();
  const secret = await hashPassword(password);
  // Checked after the await so two concurrent requests cannot both pass.
  if ([...users.keys()].some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw new AccountError(409, `There is already an account called ${name}.`);
  }
  users.set(name, { ...secret, mustChange: true, createdAt: new Date().toISOString() });
  persist();
  return password;
}

async function resetPassword(name) {
  if (!users.has(name)) throw new AccountError(404, "No such account.");
  const password = temporaryPassword();
  const secret = await hashPassword(password);
  const user = users.get(name);
  if (!user) throw new AccountError(404, "No such account.");
  users.set(name, { ...user, ...secret, mustChange: true });
  persist();
  return password;
}

// Save files are left in place; deleting an account only removes the login.
function remove(name) {
  if (!users.delete(name)) throw new AccountError(404, "No such account.");
  persist();
}

// Unknown names are hashed too, so response time doesn't reveal who exists.
async function verify(name, password) {
  const user = users.get(name);
  const given = typeof password === "string" && password.length <= MAX_PASSWORD ? password : "";
  const { hash } = await hashPassword(given, user ? user.salt : "0".repeat(32));
  return Boolean(user) && timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"));
}

async function changePassword(name, current, next) {
  if (!(await verify(name, current))) throw new AccountError(400, "Your current password is wrong.");
  if (typeof next !== "string" || next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) {
    throw new AccountError(400, `Use a password of ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`);
  }
  if (next === current) throw new AccountError(400, "Choose a password different from the current one.");
  const secret = await hashPassword(next);
  const user = users.get(name);
  if (!user) throw new AccountError(404, "No such account.");
  users.set(name, { ...user, ...secret, mustChange: false });
  persist();
}

module.exports = { AccountError, exists, mustChange, list, create, resetPassword, remove, verify, changePassword };
