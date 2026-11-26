// Helpers shared by the player page and the admin page.
const $ = (id) => document.getElementById(id);

let toastTimer = null;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function button(text, cls, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn small " + cls;
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// Destructive actions take two clicks on the same button: the first arms
// it ("Confirm reset?"), the second acts. It disarms itself after 4s.
function armThenRun(btn, armedLabel, action) {
  if (btn.classList.contains("armed")) {
    clearTimeout(btn._disarm);
    btn.classList.remove("armed");
    btn.textContent = btn.dataset.label;
    action();
    return;
  }
  btn.dataset.label = btn.textContent;
  btn.classList.add("armed");
  btn.textContent = armedLabel;
  btn._disarm = setTimeout(() => {
    btn.classList.remove("armed");
    btn.textContent = btn.dataset.label;
  }, 4000);
}

const stem = (rom) => rom.replace(/\.[^.]+$/, "");
const consoleOf = (rom) => rom.split(".").pop().toUpperCase();
const consoleName = (rom) => (consoleOf(rom) === "GBA" ? "Game Boy Advance" : "NES");

function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

// Call numbers are assigned per console in title order: GBA·001, NES·002…
function callNumbers(roms) {
  const counters = {};
  const out = {};
  for (const rom of [...roms].sort((a, b) => a.localeCompare(b))) {
    const c = consoleOf(rom);
    counters[c] = (counters[c] || 0) + 1;
    out[rom] = `${c}·${String(counters[c]).padStart(3, "0")}`;
  }
  return out;
}

// A catalogue-style row: optional call number, title, one line of detail, actions.
function row(title, meta, actions = [], call = null) {
  const li = document.createElement("li");
  const text = document.createElement("div");
  text.style.minWidth = "0";
  const name = document.createElement("div");
  name.className = "entry-title";
  name.textContent = title;
  name.title = title;
  const detail = document.createElement("div");
  detail.className = "entry-meta";
  detail.textContent = meta;
  text.append(name, detail);
  if (call) {
    const number = document.createElement("span");
    number.className = "callno";
    number.textContent = call;
    li.className = "entry";
    li.append(number);
  }
  li.append(text);
  if (actions.length) {
    const box = document.createElement("div");
    box.className = "entry-actions";
    box.append(...actions);
    li.append(box);
  }
  return li;
}
