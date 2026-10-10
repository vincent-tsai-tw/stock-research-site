/* 大盤走勢: index line with ranges and scrubbing, official foreign flows and margin balance, all
   read from the precomputed data/market.json. Red is up and buying, green down and selling. */
(function () {
  "use strict";
  var RANGES = [["1 個月", 21], ["3 個月", 63], ["6 個月", 126], ["1 年", 250], ["2 年", 500], ["5 年", 1250], ["全部", 100000]];
  var MARKETS = [["加權指數", "twse"], ["櫃買指數", "tpex"]];
  var FLOW_DAYS = 60, MARGIN_DAYS = 250, H = 260, PAD_R = 64, PAD_T = 12, PAD_B = 22;
  var NS = "http://www.w3.org/2000/svg";
  var buildMeta = document.querySelector('meta[name="build"]');
  var V = buildMeta && buildMeta.content ? "?v=" + encodeURIComponent(buildMeta.content) : "";
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, market: 0, range: 2 };

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmt(v, d) { return Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function signed(v, d) { var r = Number(Number(v).toFixed(d)), s = fmt(Math.abs(r), d); return r > 0 ? "+" + s : r < 0 ? "−" + s : s; }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }
  function md(date) { return Number(date.slice(5, 7)) + "/" + Number(date.slice(8, 10)); }
  /* axis label: month/day within a year, year/month when the span is longer */
  function axisLabel(date, first, last) {
    var long = (Date.parse(last) - Date.parse(first)) > 370 * 864e5;
    return long ? date.slice(0, 4) + "/" + Number(date.slice(5, 7)) : md(date);
  }
  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function decimals(step) {
    var dp = 0;
    while (dp < 3 && Math.abs(Math.round(step * Math.pow(10, dp)) - step * Math.pow(10, dp)) > 1e-9) dp++;
    return dp;
  }
  function segmented(container, items, active, onPick) {
    container.innerHTML = "";
    items.forEach(function (item, i) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = item[0];
      b.setAttribute("aria-pressed", String(i === active));
      b.addEventListener("click", function () { onPick(i); });
      container.appendChild(b);
    });
  }
  function rows() {
    var d = state.data, cols = d.cols;
    return (d[MARKETS[state.market][1]] || []).map(function (a) {
      var o = {}; cols.forEach(function (c, i) { o[c] = a[i]; }); return o;
    });
  }
  function yi(v) { return v === null || v === undefined ? "—" : signed(v, 1) + " 億"; }
  /* common-stock medians of the published ratios; days not yet backfilled are left out */
  var MEDIANS = [["pe_median", "本益比中位數 ", 1, ""], ["pb_median", "股價淨值比中位數 ", 2, ""], ["dy_median", "殖利率中位數 ", 2, "%"]];
  function medians(r) {
    return MEDIANS.map(function (m) {
      var v = r[m[0]];
      return typeof v === "number" && isFinite(v) ? "　" + m[1] + fmt(v, m[2]) + m[3] : "";
    }).join("");
  }

  /* a line chart with nice ticks, end-date labels and a scrub cursor; onAt(i | null) */
  function lineChart(svg, pts, opts, onAt) {
    var W = Math.max(320, svg.parentNode.clientWidth || 640), HH = opts.height || 160;
    svg.setAttribute("viewBox", "0 0 " + W + " " + HH); svg.innerHTML = "";
    if (pts.length < 2) { onAt(null); return; }
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
    var pad = (hi - lo) * 0.08 || Math.max(1, Math.abs(hi) * 0.02); lo -= pad; hi += pad;
    var plotW = W - PAD_R, plotH = HH - PAD_T - PAD_B, n = pts.length;
    var x = function (i) { return i / (n - 1) * plotW; };
    var y = function (v) { return PAD_T + (hi - v) / (hi - lo) * plotH; };
    var step = niceStep(hi - lo, 4), dp = decimals(step);
    for (var k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) {
      var gy = y(k * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent = fmt(k * step, dp);
    }
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p.v).toFixed(1); }).join("");
    if (opts.area) el("path", { d: line + "L" + plotW + "," + (PAD_T + plotH) + "L0," + (PAD_T + plotH) + "Z", "class": "area " + opts.tone }, svg);
    el("path", { d: line, "class": "line " + opts.tone }, svg);
    el("text", { x: 0, y: HH - 4, "class": "tick" }, svg).textContent = axisLabel(pts[0].d, pts[0].d, pts[n - 1].d);
    el("text", { x: plotW, y: HH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = axisLabel(pts[n - 1].d, pts[0].d, pts[n - 1].d);
    var cursor = el("line", { x1: 0, x2: 0, y1: PAD_T, y2: HH - PAD_B, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot " + opts.tone, visibility: "hidden" }, svg);
    function at(evt) {
      var r = svg.getBoundingClientRect(), px = (evt.clientX - r.left) / r.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (n - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(pts[i].v)); dot.setAttribute("visibility", "visible");
      onAt(i);
    }
    function leave() { cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); onAt(null); }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    leave();
  }

  function drawIndex() {
    var all = rows(), bars = all.slice(-RANGES[state.range][1]);
    if (!bars.length) return;
    var base = all.length > bars.length ? all[all.length - bars.length - 1] : bars[0];
    var last = bars[bars.length - 1], tone = cls(last.close - base.close) || "flat";
    $("k-name").textContent = MARKETS[state.market][0];
    document.title = MARKETS[state.market][0] + " · 大盤走勢 · 台股研究";
    function header(i) {
      var r = i === null ? last : bars[i], chg = r.close - base.close;
      $("k-close").textContent = fmt(r.close, 2);
      var c = $("k-chg"); c.textContent = signed(chg, 2) + "（" + signed(chg / base.close * 100, 2) + "%）"; c.className = "quote-chg " + cls(chg);
      $("k-meta").textContent = i === null
        ? (RANGES[state.range][1] >= all.length ? bars[0].date + " 以來" : RANGES[state.range][0]) + "漲跌，資料截至 " + last.date
        : r.date + "　當日 " + signed(r.change, 2) + "　成交 " + (r.turnover === null ? "—" : fmt(r.turnover, 0) + " 億") +
          "　外資 " + yi(r.foreign) + "　投信 " + yi(r.trust) + "　融資 " + (r.margin === null ? "—" : fmt(r.margin, 0) + " 億") +
          medians(r);
    }
    lineChart($("k-chart"), bars.map(function (r) { return { d: r.date, v: r.close }; }), { height: H, area: true, tone: tone }, header);
  }

  function drawFlows() {
    var svg = $("k-flows"), pts = rows().filter(function (r) { return r.foreign !== null; }).slice(-FLOW_DAYS);
    var W = Math.max(320, svg.parentNode.clientWidth || 640), FH = 180, top = 16, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + FH); svg.innerHTML = "";
    if (!pts.length) { $("k-flow-readout").textContent = "官方金額回補中。"; return; }
    var m = 0; pts.forEach(function (r) { m = Math.max(m, Math.abs(r.foreign)); }); m = m || 1;
    var half = (FH - top - bottom) / 2, zero = top + half, slot = W / pts.length, bw = Math.min(10, slot * 0.7);
    var hover = el("rect", { x: 0, y: top, width: slot, height: FH - top - bottom, rx: 2, "class": "hover-band", visibility: "hidden" }, svg);
    el("line", { x1: 0, x2: W, y1: zero, y2: zero, "class": "axis" }, svg);
    pts.forEach(function (r, i) {
      var h = Math.abs(r.foreign) / m * half; if (!h) return;
      el("rect", { x: i * slot + (slot - bw) / 2, y: r.foreign > 0 ? zero - h : zero, width: bw, height: h, rx: 1.5, "class": "bar " + (r.foreign > 0 ? "pos" : "neg") }, svg);
    });
    el("text", { x: 0, y: FH - 4, "class": "tick" }, svg).textContent = md(pts[0].date);
    el("text", { x: W, y: FH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = md(pts[pts.length - 1].date);
    var sum = pts.reduce(function (a, r) { return a + r.foreign; }, 0);
    function readout(label, v, extra) {
      var p = $("k-flow-readout"), s = document.createElement("span");
      p.textContent = label + " "; s.className = cls(Number(v.toFixed(1))); s.textContent = signed(v, 1) + " 億"; p.appendChild(s);
      if (extra) p.appendChild(document.createTextNode(extra));
    }
    function at(evt) {
      var r = svg.getBoundingClientRect(), i = Math.floor((evt.clientX - r.left) / r.width * W / slot);
      i = Math.min(Math.max(i, 0), pts.length - 1);
      hover.setAttribute("x", i * slot); hover.setAttribute("visibility", "visible");
      readout(md(pts[i].date) + " 外資", pts[i].foreign, "　投信 " + yi(pts[i].trust) + "　自營商 " + yi(pts[i].dealer));
    }
    function leave() { hover.setAttribute("visibility", "hidden"); readout("外資近 " + pts.length + " 日合計", sum); }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    leave();
  }

  function drawMargin() {
    var pts = rows().filter(function (r) { return r.margin !== null; }).slice(-MARGIN_DAYS);
    var n = pts.length;
    if (n < 2) { $("k-margin-readout").textContent = "融資資料回補中。"; $("k-margin").innerHTML = ""; return; }
    var back = pts[Math.max(0, n - 21)];
    lineChart($("k-margin"), pts.map(function (r) { return { d: r.date, v: r.margin }; }), { height: 160, tone: "hold" }, function (i) {
      var r = i === null ? pts[n - 1] : pts[i], p = $("k-margin-readout");
      p.textContent = md(r.date) + " 融資餘額 " + fmt(r.margin, 1) + " 億";
      if (i === null && n > 20) {
        var s = document.createElement("span"), chg = r.margin - back.margin;
        p.appendChild(document.createTextNode("，20 日 "));
        s.className = cls(Number(chg.toFixed(1))); s.textContent = signed(chg, 1) + " 億"; p.appendChild(s);
      }
    });
  }

  function render() {
    segmented($("k-markets"), MARKETS, state.market, function (i) { state.market = i; render(); });
    segmented($("k-ranges"), RANGES, state.range, function (i) { state.range = i; render(); });
    var r = rows();
    $("k-eyebrow").textContent = "大盤 · 資料截至 " + (r.length ? r[r.length - 1].date : "—");
    drawIndex(); drawFlows(); drawMargin();
  }

  fetch("../stock/data/market.json" + V).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) {
    state.data = d;
    if (new URLSearchParams(location.search).get("m") === "tpex") state.market = 1;
    render();
  }).catch(function () { $("k-meta").textContent = "大盤資料載入失敗，請稍後重新整理。"; });
  var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { if (state.data) render(); }, 150); });

  /* shared chrome: sidebar sheet and theme */
  function side(open) {
    document.body.classList.toggle("nav-open", open);
    var o = document.querySelector(".side-open"); if (o) o.setAttribute("aria-expanded", String(open));
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-action]"); if (!a) return;
    var act = a.getAttribute("data-action");
    if (act === "side-open") side(true);
    else if (act === "side-close") side(false);
    else if (act === "theme") {
      var r = document.documentElement, cur = r.getAttribute("data-theme");
      var dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches, next = dark ? "light" : "dark";
      r.setAttribute("data-theme", next); try { localStorage.setItem("theme", next); } catch (err) {}
      if (state.data) render();
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") side(false); });
})();
