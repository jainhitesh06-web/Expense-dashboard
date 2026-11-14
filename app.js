/* Shared code for the Summary and Add pages. Talks to the private data repo through the GitHub API. */
const App = (() => {
  const LS = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const inr2 = n => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthLabel = k => MN[+k.slice(5) - 1] + " " + k.slice(0, 4);
  const monthShort = k => MN[+k.slice(5) - 1].slice(0, 3);
  const p2 = n => String(n).padStart(2, "0");
  const localDate = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const nowIso = () => { const d = new Date(); return `${localDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  const title = s => { s = String(s || ""); if (s === s.toUpperCase()) s = s.toLowerCase(); return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1)); };
  const oneLine = v => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim();
  const b64 = str => { let bin = ""; new TextEncoder().encode(str).forEach(b => bin += String.fromCharCode(b)); return btoa(bin); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MODES = ["UPI", "Credit Card", "Debit Card", "Card", "Cash", "NetBanking", "Auto-debit", "ATM", "Wallet", "Other"];

  const state = { RAW: [], TAX: [] };
  const cfg = () => ({ repo: LS.get("repo") || "jainhitesh06-web/Expense-tracker", branch: LS.get("branch") || "main", token: LS.get("token") || "" });

  /* ---------- category look ---------- */
  const catMeta = name => state.TAX.find(c => c.name === name);
  const catIcon = name => (catMeta(name) && catMeta(name).icon) || (name === "Uncategorized" ? "❓" : "🏷️");
  const catColor = name => {
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `var(--c${(h % 8) + 1})`;
  };
  const payName = r => {
    const base = r.merchant ? title(r.merchant) : r.subcategory;
    const route = (r.from || r.to) ? `${base}: ${r.from || "?"} → ${r.to || "?"}` : base;
    return route;
  };

  /* ---------- GitHub API ---------- */
  const url = path => { const c = cfg(); return `https://api.github.com/repos/${c.repo}/contents/${path}`; };
  const hdr = extra => ({ Authorization: "Bearer " + cfg().token, ...extra });
  async function getJson(path, optional) {
    const r = await fetch(`${url(path)}?ref=${encodeURIComponent(cfg().branch)}`,
      { headers: hdr({ Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
    if (r.status === 404 && optional) return null;
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403
      ? "GitHub didn't accept the token. Check it has Contents: Read and write on this repo."
      : r.status === 404 ? "I can't find the data. Check the repository name and branch." : "GitHub error " + r.status);
    return r.json();
  }
  async function load() {
    state.RAW = await getJson("data/expenses.json");
    const t = await getJson("data/taxonomy.json", true);
    state.TAX = (t && t.categories) || [];
  }
  async function putInbox(prefix, text, message) {
    const path = `inbox/${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`;
    const r = await fetch(url(path), {
      method: "PUT", headers: hdr({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
      body: JSON.stringify({ message, content: b64(text), branch: cfg().branch }) });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 || r.status === 404
      ? "Couldn't save. The token needs Contents: Read and write on this repo." : "Couldn't save (GitHub " + r.status + ").");
    return path;
  }
  // The workflow deletes the inbox file once it has handled it.
  async function waitProcessed(path, tries = 30) {
    for (let i = 0; i < tries; i++) {
      await sleep(3000);
      try {
        const g = await fetch(`${url(path)}?ref=${encodeURIComponent(cfg().branch)}`,
          { headers: hdr({ Accept: "application/vnd.github+json" }), cache: "no-store" });
        if (g.status === 404) return true;
      } catch (e) { /* keep waiting */ }
    }
    return false;
  }
  async function addText(text) {
    const before = new Set(state.RAW.map(r => r.id));
    const path = await putInbox("add", `sender: dashboard\nreceived: ${nowIso()}\n---\n${text}\n`, "add payment");
    if (!(await waitProcessed(path))) return { status: "slow" };
    await load();
    const fresh = state.RAW.filter(r => !before.has(r.id));
    return fresh.length ? { status: "ok", rec: fresh[fresh.length - 1] } : { status: "skipped" };
  }
  async function sendEdit(id, fields) {
    const lines = ["sender: dashboard", `received: ${nowIso()}`, "edit: " + id]
      .concat(Object.entries(fields).map(([k, v]) => `${k}: ${oneLine(v)}`));
    const path = await putInbox("z-edit", lines.join("\n") + "\n---\n\n", "edit payment");
    if (!(await waitProcessed(path))) return { status: "slow" };
    await load();
    return { status: "ok" };
  }

  /* ---------- connect screen ---------- */
  function connect(msg) {
    return new Promise(resolve => {
      const c = cfg();
      const ov = document.createElement("div"); ov.className = "overlay";
      ov.innerHTML = `<div class="panel"><h2>Connect your data</h2>
        <p class="muted">Paste a GitHub token with <b>Contents: Read and write</b> on your expense repo. It stays in this browser only.</p>
        <div class="grid"><div class="full"><label for="cRepo">Repository</label><input id="cRepo" value="${esc(c.repo)}" autocapitalize="none" autocorrect="off"></div>
        <div><label for="cBranch">Branch</label><input id="cBranch" value="${esc(c.branch)}" autocapitalize="none"></div>
        <div><label for="cToken">Token</label><input id="cToken" type="password" placeholder="${c.token ? "(unchanged)" : "github_pat_…"}" autocapitalize="none" autocorrect="off"></div></div>
        <p id="cErr" class="stat err">${esc(msg || "")}</p>
        <div class="rowbtns"><button class="primary" id="cSave">Connect</button></div></div>`;
      document.body.appendChild(ov);
      $("#cSave", ov).onclick = () => {
        LS.set("repo", $("#cRepo", ov).value.trim()); LS.set("branch", $("#cBranch", ov).value.trim() || "main");
        const t = $("#cToken", ov).value.trim(); if (t) LS.set("token", t);
        ov.remove(); resolve();
      };
    });
  }
  async function start() {
    for (;;) {
      if (!cfg().token) { await connect(); continue; }
      try { await load(); return; } catch (e) { await connect(e.message); }
    }
  }

  /* ---------- edit sheet ---------- */
  let sheetEl = null, EDIT = null, catTouched = false, onDone = null;
  const NEW = "__new__";
  function ensureSheet() {
    if (sheetEl) return sheetEl;
    sheetEl = document.createElement("div"); sheetEl.className = "overlay"; sheetEl.hidden = true;
    sheetEl.innerHTML = `<div class="panel" role="dialog" aria-modal="true">
      <h2 id="sTitle">Edit payment</h2>
      <div id="sHint" class="notice" hidden></div>
      <div class="grid">
        <div class="full"><label id="sNameL" for="sName">Name</label><input id="sName" autocapitalize="words"></div>
        <div><label for="sCat">Category</label><select id="sCat"></select><input id="sCatNew" placeholder="New category name" hidden style="margin-top:8px"></div>
        <div><label for="sSub">Subcategory</label><select id="sSub"></select><input id="sSubNew" placeholder="New subcategory name" hidden style="margin-top:8px"></div>
        <div><label for="sAmt">Amount ₹</label><input id="sAmt" type="number" inputmode="decimal" min="0" step="0.01"></div>
        <div><label for="sDate">Date</label><input id="sDate" type="date"></div>
      </div>
      <details class="more"><summary>More details</summary>
        <div class="grid">
          <div><label for="sMode">Paid with</label><select id="sMode"></select></div>
          <div class="full" id="sNoteW"><label for="sNote">Note</label><input id="sNote"></div>
          <div id="sFromW" hidden><label for="sFrom">From</label><input id="sFrom"></div>
          <div id="sToW" hidden><label for="sTo">To</label><input id="sTo"></div>
        </div></details>
      <label class="chk"><input type="checkbox" id="sRemember" checked> Remember this for next time</label>
      <details class="orig"><summary>Original message</summary><pre id="sSms"></pre></details>
      <p id="sStat" class="stat" role="status"></p>
      <div class="rowbtns"><button class="primary" id="sSave">Save</button><button id="sCancel">Cancel</button><button class="danger" id="sDelete">Delete</button></div>
    </div>`;
    document.body.appendChild(sheetEl);
    const q = s => $(s, sheetEl);
    q("#sCat").onchange = () => { catTouched = true; q("#sCatNew").hidden = q("#sCat").value !== NEW; fillSubs(q("#sCat").value === NEW ? "" : q("#sCat").value, ""); };
    q("#sSub").onchange = () => { catTouched = true; q("#sSubNew").hidden = q("#sSub").value !== NEW; };
    q("#sCancel").onclick = close;
    sheetEl.addEventListener("click", e => { if (e.target === sheetEl) close(); });
    q("#sSave").onclick = save;
    q("#sDelete").onclick = async () => {
      if (!confirm("Delete this payment?")) return;
      const id = EDIT.id;
      const res = await run(() => sendEdit(id, { delete: "true" }), "Deleting");
      if (res) { close(); if (onDone) onDone(null, { deleted: true }); }
    };
    return sheetEl;
  }
  function fillSubs(cat, cur) {
    const q = s => $(s, sheetEl);
    const entry = state.TAX.find(c => c.name === cat);
    let subs = entry ? entry.subs.slice() : [];
    if (cur && !subs.includes(cur)) subs.unshift(cur);
    if (!subs.length) subs = ["Other"];
    q("#sSub").innerHTML = subs.map(s => `<option>${esc(s)}</option>`).join("") + `<option value="${NEW}">＋ New subcategory…</option>`;
    if (cur) q("#sSub").value = cur;
    q("#sSubNew").hidden = true;
    const travel = cat === "Travel";
    q("#sFromW").hidden = q("#sToW").hidden = !travel;
  }
  function open(rec, opts = {}) {
    ensureSheet(); EDIT = rec; catTouched = false; onDone = opts.onDone || null;
    const q = s => $(s, sheetEl);
    const review = !!rec.review;
    q("#sTitle").textContent = review ? "What was this payment?" : "Edit payment";
    q("#sNameL").textContent = review ? "Who or what was it for? (for example: Snabbit, maid, Gaurav plumber)" : "Name";
    const hint = q("#sHint");
    hint.hidden = !review;
    hint.textContent = "I couldn't tell what this is. Type a few words and I'll file it, or pick a category below.";
    q("#sName").value = rec.merchant || "";
    const cats = state.TAX.map(c => c.name);
    if (!cats.includes(rec.category)) cats.push(rec.category);
    q("#sCat").innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join("") + `<option value="${NEW}">＋ New category…</option>`;
    q("#sCat").value = rec.category; q("#sCatNew").hidden = true; q("#sCatNew").value = ""; q("#sSubNew").value = "";
    fillSubs(rec.category, rec.subcategory);
    q("#sAmt").value = rec.amount; q("#sDate").value = rec.date;
    const modes = MODES.includes(rec.mode) ? MODES : MODES.concat(rec.mode);
    q("#sMode").innerHTML = modes.map(m => `<option>${esc(m)}</option>`).join(""); q("#sMode").value = rec.mode;
    q("#sNote").value = rec.note || ""; q("#sFrom").value = rec.from || ""; q("#sTo").value = rec.to || "";
    q("#sRemember").checked = true;
    q("#sSms").textContent = rec.sms || "(typed by hand)";
    q("#sStat").textContent = ""; q("#sStat").className = "stat";
    q("#sSave").disabled = q("#sDelete").disabled = false;
    sheetEl.hidden = false; setTimeout(() => q("#sName").focus(), 50);
  }
  function close() { if (sheetEl) sheetEl.hidden = true; EDIT = null; }
  async function run(fn, msg) {
    const q = s => $(s, sheetEl);
    q("#sSave").disabled = q("#sDelete").disabled = true; q("#sStat").className = "stat"; q("#sStat").textContent = msg + " (about 20 seconds)";
    let res;
    try { res = await fn(); } catch (e) {
      q("#sSave").disabled = q("#sDelete").disabled = false; q("#sStat").className = "stat err"; q("#sStat").textContent = e.message; return null;
    }
    if (res.status === "slow") {
      q("#sSave").disabled = q("#sDelete").disabled = false; q("#sStat").className = "stat err";
      q("#sStat").textContent = "Saved, but the update is taking longer than usual. Reload in a minute."; return null;
    }
    return res;
  }
  async function save() {
    const q = s => $(s, sheetEl);
    const amt = parseFloat(q("#sAmt").value);
    if (!(amt > 0)) { q("#sStat").className = "stat err"; q("#sStat").textContent = "Enter an amount above zero."; return; }
    const name = q("#sName").value.trim();
    const catVal = q("#sCat").value === NEW ? q("#sCatNew").value.trim() : q("#sCat").value;
    const subVal = q("#sSub").value === NEW ? q("#sSubNew").value.trim() : q("#sSub").value;
    if (catTouched && !catVal) { q("#sStat").className = "stat err"; q("#sStat").textContent = "Type a name for the new category."; return; }
    const travel = catVal === "Travel";
    const fields = { amount: amt, date: q("#sDate").value || EDIT.date, mode: q("#sMode").value,
      from: travel ? q("#sFrom").value : "", to: travel ? q("#sTo").value : "", note: q("#sNote").value,
      remember: q("#sRemember").checked && !!name };
    const typedWords = !catTouched && name && name !== (EDIT.merchant || "");
    if (typedWords) fields.describe = name;
    else { fields.category = catVal; fields.subcategory = subVal || "Other"; fields.merchant = name; }
    const id = EDIT.id, rec0 = EDIT;
    const res = await run(() => sendEdit(id, fields), "Saving");
    if (!res) return;
    const updated = state.RAW.find(r => r.id === id);
    if (typedWords && updated && updated.review) {
      EDIT = updated; catTouched = false;
      q("#sSave").disabled = q("#sDelete").disabled = false;
      q("#sHint").hidden = false; q("#sHint").textContent = `I still don't know what "${name}" is. Pick a category below and I'll remember it.`;
      q("#sStat").className = "stat"; q("#sStat").textContent = "";
      if (onDone) onDone(updated, { partial: true });
      return;
    }
    close(); if (onDone) onDone(updated || rec0, {});
  }

  /* ---------- nav ---------- */
  function nav(active) {
    const n = document.createElement("nav"); n.className = "tabs";
    n.innerHTML = `<a href="index.html" class="${active === "summary" ? "on" : ""}">Summary</a><a href="add.html" class="${active === "add" ? "on" : ""}">＋ Add</a>`;
    document.body.appendChild(n);
  }

  return { state, $, esc, inr, inr2, monthLabel, monthShort, localDate, title, catIcon, catColor, payName, MN,
    start, load, addText, sendEdit, connect, nav, Sheet: { open, close }, debits: () => state.RAW.filter(r => r.type === "debit" && r.date && !r.duplicate_of),
    dups: () => state.RAW.filter(r => r.duplicate_of),
    original: r => state.RAW.find(o => o.id === r.duplicate_of),
    resolveDuplicate: (id, keep) => sendEdit(id, keep ? { keep: "true" } : { delete: "true" }) };
})();
