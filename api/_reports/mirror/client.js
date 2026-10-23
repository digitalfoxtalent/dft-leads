// The one piece of browser code in the Ecosystem's board pages: click a cell to edit it, as on monday.
// Served from our own address (/assets/eco-board.js), so the strict Content-Security-Policy only has to allow
// script from 'self'. It never builds HTML from what the user typed: it sends the value to the server, and the
// server (which escapes everything) replies with the cell's new HTML.

export const BOARD_JS = String.raw`(function () {
  var root = document.querySelector("[data-eco-board]");
  if (!root) return;
  var B = root.getAttribute("data-b"), K = root.getAttribute("data-k");
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
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
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
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") close(); });
    }
    if (long) el.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); });
    place(pop, td, long ? 360 : 240);
    open = { pop: pop, td: td, commitOnBlur: long ? null : commit };
    setTimeout(function () { document.addEventListener("mousedown", outside, true); }, 0);
    el.focus(); if (!long && el.select) el.select();
  }

  root.addEventListener("click", function (e) {
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
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  window.addEventListener("resize", close);
})();
`;
