// Small HTML charts: intervals, points and dot strips on a shared value axis.
// Built from elements rather than SVG so labels keep their size on phones.
const DATA = JSON.parse(document.getElementById("data").textContent);
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const num = (v) => v.toLocaleString("en-US");

function node(tag, className, parent, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// Position (in %) of value v on [lo, hi], clamped.
const at = (v, lo, hi) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

function axis(host, lo, hi, step, format, title) {
  const a = node("div", "axis", host);
  a.setAttribute("aria-hidden", "true");
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const t = node("span", "", a, format(v));
    t.style.left = at(v, lo, hi) + "%";
  }
  if (title) node("p", "axis-title", host, title);
}

function row(host, label) {
  const r = node("div", "row", host);
  node("div", "row-label", r, label);
  return node("div", "track", r);
}

function reference(track, v, lo, hi) {
  if (v == null) return;
  node("span", "ref", track).style.left = at(v, lo, hi) + "%";
}

// rows: [{label, lo, hi, kind, text}]
function intervals(host, rows, { lo, hi, step, format, title, ref }) {
  host.replaceChildren();
  for (const r of rows) {
    const track = row(host, r.label);
    reference(track, ref, lo, hi);
    const bar = node("span", "bar " + r.kind, track);
    bar.style.left = at(r.lo, lo, hi) + "%";
    bar.style.width = Math.max(0.4, at(r.hi, lo, hi) - at(r.lo, lo, hi)) + "%";
    const value = node("span", "value", track, r.text);
    const start = at(r.lo, lo, hi), end = at(r.hi, lo, hi);
    // After the bar if there is room, else inside a long bar, else before it.
    if (end <= 72) value.style.left = end + 1.5 + "%";
    else if (end - start > 22) { value.classList.add("inside"); value.style.right = 100 - end + 1 + "%"; }
    else value.style.right = 100 - start + 1 + "%";
  }
  axis(host, lo, hi, step, format, title);
}

// rows: [{label, value, lo, hi, color, text}]
function points(host, rows, { lo, hi, step, format, title, ref }) {
  host.replaceChildren();
  for (const r of rows) {
    const track = row(host, r.label);
    reference(track, ref, lo, hi);
    const w = node("span", "whisker", track);
    w.style.left = at(r.lo, lo, hi) + "%";
    w.style.width = Math.max(0.3, at(r.hi, lo, hi) - at(r.lo, lo, hi)) + "%";
    w.style.background = r.color;
    const p = node("span", "point", track);
    p.style.left = at(r.value, lo, hi) + "%";
    p.style.background = r.color;
    node("span", "value", track, r.text).style.left = at(r.hi, lo, hi) + 1.5 + "%";
  }
  axis(host, lo, hi, step, format, title);
}

// One dot per value, with a shaded expected range.
function dots(host, label, values, band, { lo, hi, step, format, title, ref }) {
  host.replaceChildren();
  const track = row(host, label);
  track.style.height = "48px";
  const b = node("span", "bar band", track);
  b.style.left = at(band[0], lo, hi) + "%";
  b.style.width = at(band[1], lo, hi) - at(band[0], lo, hi) + "%";
  b.style.top = "6px"; b.style.height = "36px";
  reference(track, ref, lo, hi);
  values.forEach((v, i) => {
    const d = node("span", "dot", track);
    d.style.left = at(v, lo, hi) + "%";
    d.style.top = 8 + (i % 5) * 7 + "px";
  });
  axis(host, lo, hi, step, format, title);
}

// Segmented buttons that behave as one choice (aria-pressed).
function choice(group, onChange) {
  const buttons = [...group.querySelectorAll("button")];
  const select = (button) => {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    onChange(button.dataset.value);
  };
  buttons.forEach((b) => b.addEventListener("click", () => select(b)));
  select(buttons.find((b) => b.getAttribute("aria-pressed") === "true") || buttons[0]);
}
