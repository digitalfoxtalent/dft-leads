// The one piece of browser code in the Ecosystem's board pages: click a cell to edit it, as on monday.
// Served from our own address (/assets/eco-board.js), so the strict Content-Security-Policy only has to allow
// script from 'self'. It never builds HTML from what the user typed: it sends the value to the server, and the
// server (which escapes everything) replies with the cell's new HTML.

export const BOARD_JS = String.raw`(function () {
  var root = document.querySelector("[data-eco-board]");
  if (!root) return;
  var B = root.getAttribute("data-b"), K = root.getAttribute("data-k"), ED = !!K; // K only on boards this person can edit
  var COLS = {};
  try { COLS = JSON.parse(document.getElementById("eco-cols").textContent); } catch (e) {}
  var open = null;

  function toast(msg, bad) {
    var t = document.getElementById("eco-toast");
    if (!t) { t = document.createElement("div"); t.id = "eco-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.className = bad ? "show bad" : "show";
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = ""; }, bad ? 7000 : 2200);
  }
  function close() { if (!open) return; open.pop.remove(); document.removeEventListener("mousedown", outside, true); open = null; }
  function outside(e) { if (open && !open.pop.contains(e.target)) { var o = open; if (o.commitOnBlur) o.commitOnBlur(); else close(); } }
  function place(pop, td, wide) {
    var r = td.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - (wide || 200) - 16)) + "px";
    pop.style.top = (window.scrollY + r.bottom + 4) + "px";
    document.body.appendChild(pop);
  }

  function save(td, value) {
    var tr = td.closest("tr");
    td.classList.add("saving");
    fetch("/boards/" + B + "/items/" + tr.getAttribute("data-i") + "/cell", {
      method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ k: K, c: td.getAttribute("data-c"), f: td.getAttribute("data-f"), v: value })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (typeof d.html === "string") td.innerHTML = d.html;
      if (typeof d.f === "string") td.setAttribute("data-f", d.f);
      if (typeof d.v === "string") td.setAttribute("data-v", d.v);
      toast(d.message || (d.ok ? "Saved" : "Not saved"), !d.ok);
    }).catch(function () {
      toast("Could not reach the Ecosystem. Check the item in monday before trying again.", true);
    }).then(function () { td.classList.remove("saving"); });
  }

  function statusPicker(td, col) {
    var pop = document.createElement("div"); pop.className = "pop";
    var box = document.createElement("div"); box.className = "opts";
    (col.l || []).forEach(function (l) {
      var b = document.createElement("button"); b.type = "button"; b.className = "opt"; b.textContent = l[0]; b.style.background = l[1];
      b.addEventListener("click", function () { close(); if (l[0] !== td.getAttribute("data-v")) save(td, l[0]); });
      box.appendChild(b);
    });
    var c = document.createElement("button"); c.type = "button"; c.className = "opt clear"; c.textContent = "Clear";
    c.addEventListener("click", function () { close(); if (td.getAttribute("data-v")) save(td, ""); });
    box.appendChild(c); pop.appendChild(box);
    place(pop, td, 200);
    open = { pop: pop, td: td };
    setTimeout(function () { document.addEventListener("mousedown", outside, true); }, 0);
  }

  function inputEditor(td, type) {
    var pop = document.createElement("div"); pop.className = "pop";
    var long = type === "long_text";
    var el = document.createElement(long ? "textarea" : "input");
    if (!long) el.type = type === "date" ? "date" : type === "numbers" ? "text" : type === "email" ? "email" : type === "link" ? "url" : "text";
    if (type === "numbers") el.setAttribute("inputmode", "decimal");
    el.value = td.getAttribute("data-v") || "";
    pop.appendChild(el);
    var start = el.value;
    function commit() { var v = el.value; close(); if (v !== start) save(td, v); }
    if (long) {
      var acts = document.createElement("div"); acts.className = "acts";
      var cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "Cancel";
      var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn primary"; ok.textContent = "Save";
      cancel.addEventListener("click", close); ok.addEventListener("click", commit);
      acts.appendChild(cancel); acts.appendChild(ok); pop.appendChild(acts);
    } else {
      el.style.width = Math.max(td.getBoundingClientRect().width, 220) + "px";
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { e.stopPropagation(); close(); } });
    }
    if (long) el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); });
    place(pop, td, long ? 360 : 240);
    open = { pop: pop, td: td, commitOnBlur: long ? null : commit };
    setTimeout(function () { document.addEventListener("mousedown", outside, true); }, 0);
    el.focus(); if (!long && el.select) el.select();
  }

  // ---------- the item side panel, as on monday: click an item to see its updates and fields ----------
  var panel = null, cur = null, drafts = {}; // an unsent update is kept per item until it is posted
  function keepDraft() {
    if (!panel || !cur) return;
    var ta = panel.querySelector("form[data-eco-post] textarea");
    if (ta && !ta.disabled) { if (ta.value.trim()) drafts[cur] = ta.value; else delete drafts[cur]; }
  }
  function shell() {
    if (panel) return panel;
    panel = document.createElement("aside"); panel.id = "eco-panel"; panel.setAttribute("aria-label", "Item");
    var x = document.createElement("button"); x.type = "button"; x.className = "pn-x"; x.setAttribute("aria-label", "Close"); x.textContent = "\u00d7";
    x.addEventListener("click", closePanel);
    var body = document.createElement("div"); body.className = "pn-body";
    panel.appendChild(x); panel.appendChild(body); document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tab]"); if (!t) return;
      panel.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("on", b === t); });
      panel.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== t.getAttribute("data-tab"); });
    });
    panel.addEventListener("submit", function (e) {
      var f = e.target.closest("form[data-eco-post]"); if (!f) return;
      e.preventDefault(); postUpdate(f);
    });
    panel.addEventListener("change", function (e) {
      var sel = e.target.closest("select[data-eco-move]"); if (sel && ED) moveTo(sel);
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.closest("form[data-eco-post]")) { e.preventDefault(); postUpdate(e.target.closest("form")); }
    });
    return panel;
  }
  function markRow(id) {
    root.querySelectorAll("tr.sel, .kcard.sel").forEach(function (r) { r.classList.remove("sel"); });
    if (id) root.querySelectorAll('tr[data-i="' + id + '"], .kcard[data-i="' + id + '"]').forEach(function (r) { r.classList.add("sel"); });
  }
  function openPanel(id, tab) {
    if (!/^\d{1,19}$/.test(id)) return;
    var p = shell(), body = p.querySelector(".pn-body");
    keepDraft(); cur = id; markRow(id);
    body.textContent = "Loading...";
    p.classList.add("open");
    try { history.replaceState(null, "", "#item-" + id); } catch (e) {}
    fetch("/boards/" + B + "/items/" + id + "/panel", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
      if (cur !== id) return;
      if (d.ok && typeof d.html === "string") { body.innerHTML = d.html; if (tab === "f") { var t = body.querySelector('[data-tab="f"]'); if (t) t.click(); } var ta = body.querySelector("form[data-eco-post] textarea"); if (ta) { ta.value = drafts[id] || ""; if (tab !== "f") ta.focus(); } }
      else body.textContent = d.message || "This item is not available.";
    }).catch(function () { if (cur === id) body.textContent = "Could not reach the Ecosystem. Try again in a moment."; });
  }
  function closePanel() {
    if (!panel || !panel.classList.contains("open")) return false;
    keepDraft(); panel.classList.remove("open"); cur = null; markRow(null);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    return true;
  }
  function groupCount(det) {
    if (!det) return; var n = det.querySelectorAll("tbody tr[data-i]").length, sp = det.querySelector(".gn");
    if (sp) sp.textContent = n + (n === 1 ? " item" : " items");
  }
  function send(path, body) {
    return fetch("/boards/" + B + path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  // Move an item to another group (the group menu at the top of the side panel).
  function moveTo(sel) {
    var id = cur, from = sel.getAttribute("data-f"), to = sel.value;
    if (!id || to === from) return;
    sel.disabled = true;
    send("/items/" + id + "/move", { k: K, g: to, f: from }).then(function (d) {
      if (typeof d.g === "string" && (d.ok || d.g !== from)) { // moved, or monday says it is somewhere else now
        sel.value = d.g;
        sel.setAttribute("data-f", d.g);
        var tr = root.querySelector('tr[data-i="' + id + '"]'), det = root.querySelector('details.group[data-g="' + CSS.escape(d.g) + '"]');
        if (tr) {
          var old = tr.closest("details.group");
          if (det) { var tb = det.querySelector("tbody"); tb.insertBefore(tr, tb.querySelector("tr.add")); det.open = true; groupCount(det); }
          else tr.remove();
          groupCount(old);
          var lab = sel.closest(".mv"); if (lab && det) lab.style.setProperty("--gc", det.style.getPropertyValue("--gc"));
        }
      } else sel.value = from;
      toast(d.message || (d.ok ? "Moved" : "Not moved"), !d.ok);
    }).catch(function () { sel.value = from; toast("Could not reach the Ecosystem. Check the item in monday before trying again.", true); })
      .then(function () { sel.disabled = false; });
  }
  // Person / Filter / Sort menus: one open at a time, closed by clicking elsewhere or Escape.
  document.addEventListener("click", function (e) {
    var mine = e.target.closest("details.menu");
    document.querySelectorAll("details.menu[open]").forEach(function (d) { if (d !== mine) d.open = false; });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") document.querySelectorAll("details.menu[open]").forEach(function (d) { d.open = false; }); });
  // Kanban: drag a card to another column to change its status (same checked save as clicking the status cell).
  var kb = root.querySelector(".kanban[data-kc]"), dragging = null;
  function laneCount(l) { if (l) l.querySelector("header span").textContent = String(l.querySelectorAll(".kcard").length); }
  if (kb && ED) {
    kb.addEventListener("dragstart", function (e) {
      var c = e.target.closest(".kcard"); if (!c || c.classList.contains("saving")) { e.preventDefault(); return; }
      dragging = c; c.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.getAttribute("data-i"));
    });
    kb.addEventListener("dragend", function () {
      if (dragging) dragging.classList.remove("drag"); dragging = null;
      kb.querySelectorAll(".lane.over").forEach(function (l) { l.classList.remove("over"); });
    });
    kb.addEventListener("dragover", function (e) {
      var l = e.target.closest(".lane"); if (!l || !dragging) return;
      e.preventDefault();
      kb.querySelectorAll(".lane.over").forEach(function (x) { if (x !== l) x.classList.remove("over"); }); l.classList.add("over");
    });
    kb.addEventListener("drop", function (e) {
      var l = e.target.closest(".lane"); if (!l || !dragging) return;
      e.preventDefault(); l.classList.remove("over");
      var c = dragging, from = c.closest(".lane"), id = c.getAttribute("data-i");
      if (from === l) return;
      l.querySelector(".cards-k").appendChild(c); laneCount(from); laneCount(l); c.classList.add("saving");
      send("/items/" + id + "/cell", { k: K, c: kb.getAttribute("data-kc"), f: c.getAttribute("data-f"), v: l.getAttribute("data-v") }).then(function (d) {
        if (typeof d.f === "string") c.setAttribute("data-f", d.f);
        if (!d.ok) { // put the card where monday says it is
          var home = typeof d.v === "string" ? kb.querySelector('.lane[data-v="' + CSS.escape(d.v) + '"]') : null;
          (home || from).querySelector(".cards-k").appendChild(c); laneCount(from); laneCount(l); laneCount(home);
        }
        toast(d.message || (d.ok ? "Saved" : "Not saved"), !d.ok);
      }).catch(function () {
        from.querySelector(".cards-k").appendChild(c); laneCount(from); laneCount(l);
        toast("Could not reach the Ecosystem. Check the item in monday before trying again.", true);
      }).then(function () { c.classList.remove("saving"); });
    });
  }
  // "+ Add item" at the bottom of each group: Enter adds it to monday and draws the new row; focus stays for the next one.
  root.addEventListener("submit", function (e) {
    var f = e.target.closest("form[data-eco-add]"); if (!f) return;
    e.preventDefault();
    var inp = f.querySelector("input"), name = inp.value.trim();
    if (!ED || !name || inp.disabled) return;
    inp.disabled = true;
    send("/items/new", { k: K, g: f.getAttribute("data-g"), name: name }).then(function (d) {
      if (d.ok && typeof d.html === "string") { f.closest("tr").insertAdjacentHTML("beforebegin", d.html); inp.value = ""; groupCount(f.closest("details.group")); }
      toast(d.message || (d.ok ? "Added" : "Not added"), !d.ok);
    }).catch(function () { toast("Could not reach the Ecosystem. Check the board in monday before adding it again.", true); })
      .then(function () { inp.disabled = false; inp.focus(); });
  });
  function postUpdate(f) {
    var ta = f.querySelector("textarea"), btn = f.querySelector("button[type=submit]"), id = cur;
    var text = ta.value; if (!text.trim() || !id) return;
    btn.disabled = true; ta.disabled = true;
    fetch("/boards/" + B + "/items/" + id + "/update", {
      method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: K, t: text })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (cur === id && typeof d.html === "string") {
        var list = panel.querySelector(".upd-list"); if (list) list.innerHTML = d.html;
        var n = panel.querySelector('[data-tab="u"] .n'); if (n && typeof d.count === "number") n.textContent = String(d.count);
      }
      var ub = root.querySelector('tr[data-i="' + id + '"] .ub');
      if (ub && typeof d.count === "number" && d.count > 0) { ub.classList.add("has"); var sp = ub.querySelector("span"); if (!sp) { sp = document.createElement("span"); ub.appendChild(sp); } sp.textContent = d.count >= 10 ? "10+" : String(d.count); }
      if (d.ok) { delete drafts[id]; ta.value = ""; }
      toast(d.message || (d.ok ? "Posted" : "Not posted"), !d.ok);
    }).catch(function () {
      toast("Could not reach the Ecosystem. Check the item in monday before posting again.", true);
    }).then(function () { btn.disabled = false; ta.disabled = false; });
  }
  root.addEventListener("click", function (e) {
    var nm = e.target.closest("td.nm, .kcard");
    if (!nm || !root.contains(nm) || e.target.closest(".ren") || e.target.closest("tr.add")) return;
    if (e.target.closest("a") && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return; // new tab still opens the full page
    if (nm.classList.contains("kcard") && e.target.closest(".kf a")) return;                           // links on a card still open
    e.preventDefault();
    close();
    openPanel((nm.closest("tr") || nm).getAttribute("data-i"));
  });
  document.addEventListener("mousedown", function (e) {
    if (!panel || !panel.classList.contains("open") || open) return;
    var t = e.target;
    if (panel.contains(t) || t.closest("td.nm") || t.closest(".kcard") || t.closest("#eco-toast")) return;
    closePanel();
  });
  var h = /^#item-(\d{1,19})$/.exec(location.hash); if (h) openPanel(h[1]);

  root.addEventListener("click", function (e) {
    if (!ED) return;
    var td = e.target.closest("td[data-c]");
    if (!td || !root.contains(td)) return;
    var t = td.getAttribute("data-t");
    if (t === "name" && !e.target.closest(".ren")) return;        // the name opens the item; Rename edits it
    if (t !== "name" && e.target.closest("a")) return;             // links in cells still open
    if (td.classList.contains("saving")) return;
    e.preventDefault();
    close();
    if (t === "long") { location.href = td.getAttribute("data-href"); return; }
    var col = COLS[td.getAttribute("data-c")] || { t: t };
    if (t === "status") return statusPicker(td, col);
    if (t === "checkbox") return save(td, td.getAttribute("data-v") ? "" : "true");
    inputEditor(td, t);
  });
  document.addEventListener("keydown", function (e) { if (e.key !== "Escape") return; if (open) close(); else closePanel(); });
})();
`;
