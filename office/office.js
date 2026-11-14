/* 辦公室 (research/site/officepage.py): the pixel-art office on the overview page.

   Reads the payload embedded in <script id="office-data"> (research/site/office.py) and draws
   a warm office on the canvas: one labelled desk with a chair per role (three a row on wide
   screens, two a row on narrow ones), a whiteboard (one sticky note per open decision), a
   clock and a window on Taipei time, a coffee corner, a bookcase and plants. One character per
   role works there: a role with activity in the last 24 hours types at its desk; the
   others wander to the coffee machine, the whiteboard, the window, the plant or a colleague's
   desk and back. Everything is drawn from rectangles here (no image files, no libraries), and
   every rectangle is snapped to the device pixel grid so the art stays crisp at any width.
   The animation pauses while the tab is hidden; prefers-reduced-motion shows a still frame.
   Hovering (or tapping) a character shows what its role is doing; clicking a desk or a
   character opens that role's page (on touch screens a second tap on the character does). */
(function () {
  "use strict";
  var dataEl = document.getElementById("office-data");
  var canvas = document.getElementById("office-canvas");
  var stage = document.getElementById("office-stage");
  var bubble = document.getElementById("office-bubble");
  if (!dataEl || !canvas || !stage || !canvas.getContext) return;
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var roles = (data && data.roles) || [];
  var ctx = canvas.getContext("2d");
  if (!ctx || !roles.length) return;

  var NARROW_PX = 520;     // CSS width below which the office is two desks wide
  var DESKS = roles.length; // one desk per role (research/site/office.py ROLES)
  var DESK_GAP = 104;      // logical pixels between desk centres in a row
  var SPEED = 22;          // walking speed, logical pixels per second
  var FRAME_MS = 33;       // redraw at most ~30 times a second
  var BUBBLE_CHARS = 46;   // characters of a role's current work shown in the bubble
  var MAX_NOTES = 12;      // sticky notes on the whiteboard
  var TAU = Math.PI * 2;

  /* ── colours: the room, and each role's look (hair style, clothes, accessory) ── */
  var C = {
    wall: "#f3e3c8", wallTop: "#e8d2ae", wains: "#e4c79f", trim: "#c9a77c", base: "#a8794f",
    floorA: "#c99a69", floorB: "#c4946a", seam: "#b5865a", rug: "#e2b98c", rugEdge: "#cf9f6f",
    rugDot: "#d7aa7c", deskTop: "#a86f45", deskLip: "#bd8457", deskFront: "#8b5a36",
    plate: "#f4e7d0", plateEdge: "#c9a983", plateText: "#5e3b22", leg: "#5e3b22",
    shadow: "rgba(70,35,10,.18)", chair: "#3d405b", chairHi: "#50557a", seat: "#33364f",
    lid: "#c5c9d0", lidHi: "#e3e6ea", lidDot: "#ffffff", keys: "#9aa0a8",
    eye: "#2b2118", blush: "#f4978e", shoe: "#3b2f2f", white: "#ffffff",
    frame: "#8b5a36", sill: "#bd8457", board: "#fbfbf8", boardEdge: "#aab0b8",
    pot: "#c7783a", potRim: "#b0612a", leaf: "#4f772d", leafHi: "#6a994e", leafLo: "#3d5c22",
    metal: "#3b3b40", metalHi: "#56565e", clockFace: "#fffaf0", hand: "#333333"
  };
  var LOOKS = {
    pm:       { hair: "#4a3226", style: "short", skin: "#f2c9a0", shirt: "#3d5a80", pants: "#2b2d42", acc: "tie", accColor: "#f2c14e" },
    data:     { hair: "#23232b", style: "spiky", skin: "#e3b48a", shirt: "#e07a2f", pants: "#3a3f58", acc: "", accColor: "" },
    research: { hair: "#8a4b2a", style: "bun", skin: "#f6d5b5", shirt: "#2a9d8f", pants: "#3d3d46", acc: "", accColor: "" },
    events:   { hair: "#e0b04c", style: "long", skin: "#f3cfae", shirt: "#8e6cc0", pants: "#34344a", acc: "phones", accColor: "#4a4e69" },
    design:   { hair: "#d0648f", style: "bob", skin: "#f7d9c0", shirt: "#79b8d9", pants: "#4b4a63", acc: "beret", accColor: "#e76f51" },
    qa:       { hair: "#5b4636", style: "cap", skin: "#d9a679", shirt: "#b07d8c", pants: "#2f3640", acc: "glasses", accColor: "#2b2b2b", cap: "#f2c14e", capLo: "#d9a73a" },
    usmarket: { hair: "#a9adb6", hairHi: "#d3d6dc", style: "curly", skin: "#c68e65", shirt: "#5f8f4e", pants: "#3a3f4b", acc: "", accColor: "" },
    consultant: { hair: "#2b1d16", hairHi: "#5a4031", style: "part", skin: "#f1c7a3", shirt: "#7b2d43", pants: "#2b2d42", acc: "collar", accColor: "#ffffff", pin: "#f2c14e" },
    gooaye:   { hair: "#1b1b22", style: "short", skin: "#e9be97", shirt: "#c44536", pants: "#2f3e46", acc: "phones", accColor: "#1d3557" }
  };
  var BOOKS = ["#e76f51", "#3a6ea5", "#f2c14e", "#2a9d8f", "#8e6cc0", "#f4e7d0"];
  var SPARKS = ["#ffd166", "#bde0fe", "#ffffff"];

  /* ── layout (logical pixels): three desks a row on wide screens (3 + 3 + 2, the short last
     row centred), two on narrow ones (4 rows) ── */
  var L, S = 1, dpr = 1, cssScale = 1;
  function makeLayout(narrow) {
    var W = narrow ? 224 : 320, cols = narrow ? 2 : 3, x0 = narrow ? 60 : 56, step = narrow ? 54 : 56;
    var rows = Math.ceil(DESKS / cols), rowY = [], desks = [];
    for (var row = 0; row < rows; row++) rowY.push(96 + row * step);
    for (var i = 0; i < DESKS; i++) {
      var r = Math.floor(i / cols), inRow = Math.min(cols, DESKS - r * cols);
      desks.push({ x: x0 + (i % cols) * DESK_GAP + (cols - inRow) * DESK_GAP / 2, y: rowY[r], r: r });
    }
    var lanes = rowY.map(function (y) { return y - 18; }); // walkways behind each desk row
    var H = rowY[rows - 1] + 40, short = DESKS % cols !== 0;
    return {
      narrow: narrow, W: W, H: H, wall: 58, desks: desks, lanes: lanes,
      aisles: narrow ? [16, 112, 208] : [16, 108, 212, 304], // between the columns of full rows
      shelf: short ? { x: 28, y: H - 10 } : null, // a bookcase in the short row's free corner
      board: { x: 8, y: 10, w: narrow ? 46 : 62, h: 31 },
      clock: { x: narrow ? 60 : 80, y: 14 },
      win: { x: narrow ? 82 : 116, y: 8, w: narrow ? 50 : 72, h: 37 },
      coffee: { x: W - 48 }
    };
  }

  /* ── drawing primitives: logical rectangles snapped to device pixels ── */
  function rect(c, x, y, w, h, col) {
    var x0 = Math.round(x * S), y0 = Math.round(y * S);
    var x1 = Math.round((x + w) * S), y1 = Math.round((y + h) * S);
    if (x1 <= x0 || y1 <= y0) return;
    c.fillStyle = col;
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mix(a, b, t) {
    var p = hex(a), q = hex(b);
    return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(p[i] + (q[i] - p[i]) * t); }).join(",") + ")";
  }
  function seeded(seed) { // small deterministic generator for stars, skyline and windows
    return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  }

  /* ── Taipei time (UTC+8, no daylight saving) and the sky outside ── */
  function taipeiHours() { return ((Date.now() / 3600000) + 8) % 24; }
  function skyFor(h) {
    if (h >= 5 && h < 6.5) return { top: "#5e548e", bot: "#f4a582", city: "#5b5f7a", lights: true, sun: false, stars: false };
    if (h >= 6.5 && h < 16.5) return { top: "#7ec8e3", bot: "#d4eef7", city: "#93a7bb", lights: false, sun: true, stars: false };
    if (h >= 16.5 && h < 18) return { top: "#f4a261", bot: "#fbe3b8", city: "#9a7f86", lights: false, sun: true, stars: false };
    if (h >= 18 && h < 19.5) return { top: "#4d4372", bot: "#e07a7f", city: "#3d3a5c", lights: true, sun: false, stars: false };
    return { top: "#101a35", bot: "#2b3a67", city: "#1c2440", lights: true, sun: false, stars: true };
  }

  var bg = document.createElement("canvas"), bgc = bg.getContext("2d"), bgMinute = -1;
  function drawWindow(c, h) {
    var w = L.win, s = skyFor(h), rnd = seeded(7);
    var ix = w.x + 2, iy = w.y + 2, iw = w.w - 4, ih = w.h - 4;
    for (var y = 0; y < ih; y++) rect(c, ix, iy + y, iw, 1, mix(s.top, s.bot, y / (ih - 1)));
    if (s.stars) {
      for (var k = 0; k < 14; k++) rect(c, ix + Math.floor(rnd() * iw), iy + Math.floor(rnd() * (ih - 12)), 1, 1, "#ffffff");
      rect(c, ix + iw - 9, iy + 4, 3, 3, "#f6f1d1"); rect(c, ix + iw - 8, iy + 4, 2, 2, s.top); // the moon
    }
    if (s.sun) {
      var t = Math.min(1, Math.max(0, (h - 6.5) / 11)), sx = ix + 3 + t * (iw - 10);
      var sy = iy + 4 + Math.round(Math.pow(2 * t - 1, 2) * (ih - 18));
      rect(c, sx, sy, 4, 4, "#ffd166"); rect(c, sx + 1, sy + 1, 2, 2, "#fff1b8");
      var drift = (Math.floor(Date.now() / 60000) % (iw + 12));
      [[drift, 6], [drift + iw / 2, 11]].forEach(function (p) {
        var cx = ix + ((p[0] % (iw + 12)) - 6);
        if (cx > ix - 6 && cx < ix + iw) {
          rect(c, Math.max(ix, cx), iy + p[1], Math.min(7, ix + iw - cx), 2, "#ffffff");
          if (cx + 2 < ix + iw && cx + 2 >= ix) rect(c, cx + 2, iy + p[1] - 1, Math.min(3, ix + iw - cx - 2), 1, "#ffffff");
        }
      });
    }
    var x = ix; // the skyline: invented blocks, a few lit windows at night
    while (x < ix + iw) {
      var bw = 3 + Math.floor(rnd() * 5), bh = 4 + Math.floor(rnd() * 9);
      bw = Math.min(bw, ix + iw - x);
      rect(c, x, iy + ih - bh, bw, bh, s.city);
      if (s.lights) for (var q = 0; q < 2; q++) if (rnd() < 0.6) rect(c, x + Math.floor(rnd() * bw), iy + ih - 1 - Math.floor(rnd() * (bh - 1)), 1, 1, "#ffd166");
      x += bw + (rnd() < 0.3 ? 1 : 0);
    }
    var tx = ix + Math.floor(iw * 0.62); // one slim tower
    rect(c, tx, iy + ih - 20, 3, 20, s.city); rect(c, tx + 1, iy + ih - 24, 1, 4, s.city);
    if (s.lights) rect(c, tx + 1, iy + ih - 24, 1, 1, "#ff9f1c");
    rect(c, w.x, w.y, w.w, 2, C.frame); rect(c, w.x, w.y + w.h - 2, w.w, 2, C.frame); // frame
    rect(c, w.x, w.y, 2, w.h, C.frame); rect(c, w.x + w.w - 2, w.y, 2, w.h, C.frame);
    rect(c, w.x + Math.floor(w.w / 2) - 1, w.y, 2, w.h, C.frame); rect(c, w.x, w.y + 17, w.w, 2, C.frame);
    rect(c, w.x - 3, w.y + w.h, w.w + 6, 3, C.sill);
  }
  function drawClock(c) {
    var o = L.clock, h = taipeiHours(), m = (h % 1) * 60, cx = o.x + 4.5, cy = o.y + 4.5;
    rect(c, o.x + 2, o.y, 5, 9, C.frame); rect(c, o.x, o.y + 2, 9, 5, C.frame);
    rect(c, o.x + 1, o.y + 1, 7, 7, C.frame);
    rect(c, o.x + 2, o.y + 1, 5, 7, C.clockFace); rect(c, o.x + 1, o.y + 2, 7, 5, C.clockFace);
    function hand(angle, len) {
      for (var k = 1; k <= len; k++) rect(c, Math.floor(cx + Math.sin(angle) * k), Math.floor(cy - Math.cos(angle) * k), 1, 1, C.hand);
    }
    hand(((h % 12) / 12) * TAU, 2); hand((m / 60) * TAU, 3);
    rect(c, o.x + 4, o.y + 4, 1, 1, C.hand);
  }
  function drawBoard(c) {
    var b = L.board, notes = Math.min(MAX_NOTES, (data.today && data.today.decisions) || 0);
    rect(c, b.x, b.y, b.w, b.h, C.boardEdge); rect(c, b.x + 1, b.y + 1, b.w - 2, b.h - 2, C.board);
    var bars = [4, 7, 5, 10], bx = b.x + 4;
    bars.forEach(function (v, i) { rect(c, bx + i * 4, b.y + 22 - v, 3, v, i === 3 ? "#e76f51" : "#3a6ea5"); });
    rect(c, b.x + 3, b.y + 23, 17, 1, "#9aa0a8");
    rect(c, b.x + 4, b.y + 26, 12, 1, "#b8bec6"); rect(c, b.x + 4, b.y + 28, 8, 1, "#b8bec6");
    var per = b.w > 50 ? 6 : 4, nx = b.x + 23; // sticky notes: one per open decision
    for (var n = 0; n < notes; n++) {
      var col = n % per, row = Math.floor(n / per);
      rect(c, nx + col * 6, b.y + 4 + row * 6, 4, 4, ["#ffd166", "#ffadad", "#a0c4ff"][n % 3]);
    }
    rect(c, b.x + 2, b.y + b.h, b.w - 4, 2, C.boardEdge); // marker tray
    rect(c, b.x + 8, b.y + b.h - 1, 4, 1, "#3a6ea5"); rect(c, b.x + 14, b.y + b.h - 1, 4, 1, "#e76f51");
  }
  function drawPlant(c, x, y, big) { // pot base at (x, y)
    var w = big ? 10 : 7;
    rect(c, x, y - 7, w, 7, C.pot); rect(c, x - 1, y - 8, w + 2, 2, C.potRim);
    var lx = x + w / 2;
    [[-5, -20, 4, 10], [1, -24, 4, 14], [-2, -16, 6, 8], [3, -18, 5, 9], [-6, -14, 4, 6]].forEach(function (p, i) {
      if (!big && i > 2) return;
      var sc = big ? 1 : 0.7;
      rect(c, Math.round(lx + p[0] * sc), Math.round(y - 8 + p[1] * sc), Math.max(2, Math.round(p[2] * sc)), Math.max(2, Math.round(p[3] * sc)), i % 2 ? C.leafHi : C.leaf);
    });
    rect(c, lx - 1, y - 12, 2, 4, C.leafLo);
  }
  function drawShelf(c) { // a low bookcase standing on the floor, bottom edge at (x, y)
    var o = L.shelf, w = 36, h = 22, rnd = seeded(11);
    rect(c, o.x - 1, o.y, w + 2, 2, C.shadow);
    rect(c, o.x, o.y - h, w, h, C.deskFront); rect(c, o.x, o.y - h, w, 2, C.deskLip);
    for (var k = 0; k < 2; k++) {
      var sy = o.y - h + 3 + k * 9, bx = o.x + 3;
      rect(c, o.x + 2, sy, w - 4, 7, C.leg);
      while (bx < o.x + w - 3) {
        var bw = Math.min(2 + Math.floor(rnd() * 2), o.x + w - 3 - bx), bh = 4 + Math.floor(rnd() * 3);
        rect(c, bx, sy + 7 - bh, bw, bh, BOOKS[Math.floor(rnd() * BOOKS.length)]);
        bx += bw + (rnd() < 0.25 ? 1 : 0);
      }
    }
  }
  function drawCoffee(c) {
    var x = L.coffee.x, top = 42;
    rect(c, x, top, 42, 3, C.deskLip); rect(c, x + 1, top + 3, 40, 18, C.deskFront);
    rect(c, x + 20, top + 5, 1, 14, C.leg); rect(c, x + 16, top + 10, 2, 2, C.deskLip); rect(c, x + 23, top + 10, 2, 2, C.deskLip);
    rect(c, x + 3, top - 18, 15, 18, C.metal); rect(c, x + 3, top - 18, 15, 2, C.metalHi); // machine
    rect(c, x + 5, top - 14, 4, 2, "#8ecae6"); rect(c, x + 12, top - 14, 2, 2, "#e76f51");
    rect(c, x + 6, top - 9, 9, 7, "#26262b"); rect(c, x + 9, top - 9, 3, 2, C.metalHi);
    rect(c, x + 8, top - 5, 4, 4, C.white); rect(c, x + 12, top - 4, 1, 2, C.white); // a mug
    rect(c, x + 22, top - 3, 7, 3, C.white); rect(c, x + 22, top - 4, 7, 1, "#e9ecef"); // cups
    drawPlant(c, x + 32, top, false);
  }
  function drawRoom() {
    var c = bgc, W = L.W, H = L.H, h = taipeiHours();
    c.clearRect(0, 0, bg.width, bg.height);
    rect(c, 0, 0, W, L.wall, C.wall); rect(c, 0, 0, W, 3, C.wallTop);
    rect(c, 0, 44, W, L.wall - 44, C.wains); rect(c, 0, 44, W, 1, C.trim); rect(c, 0, L.wall - 2, W, 2, C.base);
    for (var y = L.wall, row = 0; y < H; y += 6, row++) { // floor planks, ends staggered
      rect(c, 0, y, W, 6, row % 2 ? C.floorB : C.floorA); rect(c, 0, y + 5, W, 1, C.seam);
      for (var sx = (row * 23) % 48; sx < W; sx += 48) rect(c, sx, y, 1, 5, C.seam);
    }
    rect(c, 22, 82, W - 44, H - 92, C.rugEdge); rect(c, 24, 84, W - 48, H - 96, C.rug); // rug
    for (var ry = 90; ry < H - 14; ry += 8) for (var rx = 30 + (ry % 16 ? 4 : 0); rx < W - 28; rx += 8) rect(c, rx, ry, 1, 1, C.rugDot);
    drawWindow(c, h); drawClock(c); drawBoard(c); drawCoffee(c);
    if (L.shelf) drawShelf(c);
    drawPlant(c, 5, 80, true); drawPlant(c, W - 15, H - 4, true);
  }

  /* ── furniture drawn every frame (characters pass in front of and behind it) ── */
  function drawChair(i) {
    var d = L.desks[i];
    rect(ctx, d.x - 6, d.y - 17, 12, 10, C.chair); rect(ctx, d.x - 6, d.y - 17, 12, 1, C.chairHi);
    rect(ctx, d.x - 7, d.y - 7, 14, 4, C.seat);
  }
  function drawItem(key, d) {
    var x = d.x, y = d.y;
    if (key === "pm") { // clipboard and a mug
      rect(ctx, x + 13, y - 5, 7, 8, "#c8a46a"); rect(ctx, x + 14, y - 4, 5, 6, C.white);
      rect(ctx, x + 15, y - 3, 3, 1, "#9aa0a8"); rect(ctx, x + 15, y - 1, 3, 1, "#9aa0a8"); rect(ctx, x + 15, y - 6, 3, 2, "#777777");
      rect(ctx, x - 19, y - 2, 4, 4, C.white); rect(ctx, x - 15, y - 1, 1, 2, C.white);
    } else if (key === "data") { // a stack of disks and a blinking box
      ["#5f7fb8", "#6f8fc8", "#5f7fb8"].forEach(function (col, k) { rect(ctx, x - 21, y - 7 + k * 3, 8, 3, col); rect(ctx, x - 21, y - 7 + k * 3, 8, 1, "#8fb0e0"); });
      rect(ctx, x + 13, y - 1, 8, 3, "#2f3640"); rect(ctx, x + 14, y, 1, 1, Math.floor(Date.now() / 400) % 2 ? "#57cc99" : "#2f3640"); rect(ctx, x + 16, y, 1, 1, "#ffd166");
    } else if (key === "research") { // a chart on a stand and a pile of books
      rect(ctx, x + 13, y - 8, 9, 7, C.white); rect(ctx, x + 13, y - 8, 9, 1, C.boardEdge);
      rect(ctx, x + 14, y - 4, 1, 2, "#3a6ea5"); rect(ctx, x + 16, y - 5, 1, 3, "#3a6ea5"); rect(ctx, x + 18, y - 6, 1, 4, "#3a6ea5"); rect(ctx, x + 20, y - 7, 1, 5, "#e76f51");
      rect(ctx, x + 17, y - 1, 1, 2, C.leg);
      rect(ctx, x - 21, y - 1, 9, 2, "#e76f51"); rect(ctx, x - 20, y - 3, 8, 2, "#3a6ea5"); rect(ctx, x - 21, y - 5, 7, 2, "#f2c14e");
    } else if (key === "events") { // a desk calendar and a microphone
      rect(ctx, x - 21, y - 6, 8, 7, C.white); rect(ctx, x - 21, y - 6, 8, 2, "#e76f51"); rect(ctx, x - 18, y - 2, 2, 2, "#3a6ea5");
      rect(ctx, x + 15, y + 1, 5, 1, C.metal); rect(ctx, x + 17, y - 3, 1, 4, C.metal); rect(ctx, x + 16, y - 7, 3, 4, C.metalHi); rect(ctx, x + 16, y - 6, 3, 1, C.metal);
    } else if (key === "design") { // a pencil cup and colour swatches
      rect(ctx, x - 19, y - 3, 5, 5, "#e9ecef"); rect(ctx, x - 19, y - 6, 1, 3, "#e76f51"); rect(ctx, x - 17, y - 7, 1, 4, "#3a6ea5"); rect(ctx, x - 15, y - 6, 1, 3, "#f2c14e");
      rect(ctx, x + 12, y + 1, 3, 2, "#e76f51"); rect(ctx, x + 15, y + 1, 3, 2, "#f2c14e"); rect(ctx, x + 18, y + 1, 3, 2, "#79b8d9");
      rect(ctx, x + 13, y - 3, 8, 3, "#2f3640"); rect(ctx, x + 14, y - 2, 6, 1, "#56565e");
    } else if (key === "qa") { // a checklist and a magnifying glass
      rect(ctx, x + 13, y - 6, 7, 8, C.white); rect(ctx, x + 14, y - 4, 1, 1, "#3a6ea5"); rect(ctx, x + 16, y - 4, 3, 1, "#9aa0a8");
      rect(ctx, x + 14, y - 2, 1, 1, "#3a6ea5"); rect(ctx, x + 16, y - 2, 3, 1, "#9aa0a8"); rect(ctx, x + 14, y, 1, 1, "#9aa0a8"); rect(ctx, x + 16, y, 3, 1, "#9aa0a8");
      rect(ctx, x - 20, y - 4, 5, 1, C.metal); rect(ctx, x - 20, y, 5, 1, C.metal); rect(ctx, x - 21, y - 3, 1, 3, C.metal); rect(ctx, x - 15, y - 3, 1, 3, C.metal);
      rect(ctx, x - 20, y - 3, 5, 3, "#d8eefc"); rect(ctx, x - 14, y + 1, 3, 1, C.leg);
    } else if (key === "usmarket") { // a globe, and a screen where one line follows the other a day later
      rect(ctx, x - 19, y - 10, 5, 7, "#4f9fd1"); rect(ctx, x - 20, y - 9, 7, 5, "#4f9fd1");
      rect(ctx, x - 18, y - 9, 2, 2, "#7fb069"); rect(ctx, x - 16, y - 7, 2, 3, "#7fb069"); rect(ctx, x - 19, y - 6, 1, 1, "#7fb069");
      rect(ctx, x - 19, y - 9, 1, 1, "#bfe3f5");
      rect(ctx, x - 21, y - 8, 1, 4, "#c8a46a"); rect(ctx, x - 17, y - 3, 1, 3, C.leg); rect(ctx, x - 19, y, 5, 1, "#c8a46a");
      rect(ctx, x + 12, y - 8, 10, 8, "#2f3640"); rect(ctx, x + 13, y - 7, 8, 6, "#1d2b3a");
      var line = [4, 3, 3, 1, 2, 0, 1, 0];
      for (var k = 0; k < 7; k++) { rect(ctx, x + 13 + k, y - 7 + line[k], 1, 1, "#8ecae6"); rect(ctx, x + 14 + k, y - 6 + line[k], 1, 1, "#ffb703"); }
      rect(ctx, x + 16, y, 2, 1, C.metal); rect(ctx, x + 15, y + 1, 4, 1, C.metal);
    } else if (key === "consultant") { // a notebook and a small easel with a pyramid: conclusion on top
      rect(ctx, x - 22, y - 3, 10, 5, C.white); rect(ctx, x - 17, y - 3, 1, 5, "#d0d4da");
      rect(ctx, x - 21, y - 2, 3, 1, "#9aa0a8"); rect(ctx, x - 21, y, 2, 1, "#9aa0a8"); rect(ctx, x - 15, y - 2, 2, 1, "#9aa0a8");
      rect(ctx, x - 11, y - 4, 1, 5, "#2b2d42"); rect(ctx, x - 11, y + 1, 1, 1, "#f2c14e");
      rect(ctx, x + 13, y - 1, 1, 3, C.leg); rect(ctx, x + 20, y - 1, 1, 3, C.leg);
      rect(ctx, x + 12, y - 10, 10, 9, C.boardEdge); rect(ctx, x + 13, y - 9, 8, 7, C.board);
      rect(ctx, x + 16, y - 8, 2, 2, "#e76f51"); rect(ctx, x + 15, y - 6, 4, 2, "#3a6ea5"); rect(ctx, x + 14, y - 4, 6, 2, "#2a9d8f");
    }
  }
  function drawDesk(i) {
    var d = L.desks[i], role = roles[i], c = chars[i];
    rect(ctx, d.x - 26, d.y + 23, 52, 2, C.shadow);
    rect(ctx, d.x - 25, d.y + 19, 3, 5, C.leg); rect(ctx, d.x + 22, d.y + 19, 3, 5, C.leg);
    rect(ctx, d.x - 26, d.y, 52, 6, C.deskTop); rect(ctx, d.x - 26, d.y, 52, 1, C.deskLip);
    rect(ctx, d.x - 25, d.y + 6, 50, 14, C.deskFront);
    rect(ctx, d.x - 19, d.y + 8, 38, 10, C.plateEdge); rect(ctx, d.x - 18, d.y + 9, 36, 8, C.plate);
    if (role) {
      var size = Math.max(11 * dpr, Math.min(14 * dpr, 7 * S)), font = '600 ' + size + 'px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
      ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C.plateText;
      var maxW = 34 * S;
      while (ctx.measureText(role.name).width > maxW && size > 8 * dpr) { size -= dpr; ctx.font = font.replace(/\d+(\.\d+)?px/, size + "px"); }
      ctx.fillText(role.name, Math.round(d.x * S), Math.round((d.y + 13) * S));
      drawItem(role.key, d);
    }
    var on = c && c.state === "sit" && c.working;
    rect(ctx, d.x - 4, d.y + 1, 9, 2, C.keys); // the laptop
    rect(ctx, d.x - 4, d.y - 5, 9, 6, C.lid); rect(ctx, d.x - 4, d.y - 5, 9, 1, C.lidHi);
    rect(ctx, d.x, d.y - 3, 1, 1, on ? C.lidDot : "#aeb3ba");
    if (c && c.state === "sit") { // hands on the keys, typing when the role is at work
      var up = c.working && !reduced && Math.floor(c.clock * 7) % 2;
      rect(ctx, d.x - 7, d.y + (up ? 0 : 1), 2, 1, c.look.skin);
      rect(ctx, d.x + 6, d.y + (up ? 1 : 0), 2, 1, c.look.skin);
    }
  }

  /* ── characters: 10 x 18 sprites drawn from rectangles; (x, y) is the feet ── */
  function P(l, t, col, row, w, h, colr) { rect(ctx, l + col, t + row, w, h, colr); }
  function drawHead(c, l, t, face, opt) {
    var k = c.look, hair = k.hair;
    if (k.style === "long") { P(l, t, 0, 3, 2, 9, hair); P(l, t, 8, 3, 2, 9, hair); }
    if (k.style === "bob") { P(l, t, 0, 3, 2, 5, hair); P(l, t, 8, 3, 2, 5, hair); }
    P(l, t, 1, 3, 8, 5, k.skin); P(l, t, 2, 8, 6, 1, k.skin);
    if (face === "back") {
      P(l, t, 1, 2, 8, 6, hair); P(l, t, 2, 8, 6, 1, hair);
    } else {
      var ex = face === "left" ? [2, 5] : face === "right" ? [4, 7] : [3, 6];
      if (!opt.blink) { P(l, t, ex[0], 5, 1, 1, C.eye); P(l, t, ex[1], 5, 1, 1, C.eye); }
      if (face !== "right") P(l, t, ex[0] - 1, 6, 1, 1, C.blush);
      if (face !== "left") P(l, t, ex[1] + 1, 6, 1, 1, C.blush);
      if (opt.glow) P(l, t, 1, 3, 8, 6, "rgba(200,230,255,.22)");
    }
    P(l, t, 2, 0, 6, 1, hair); P(l, t, 1, 1, 8, 2, hair);
    if (k.style === "short") { P(l, t, 1, 3, 1, 1, hair); P(l, t, 8, 3, 1, 1, hair); P(l, t, 2, 3, 2, 1, hair); }
    if (k.style === "spiky") { P(l, t, 1, 3, 1, 2, hair); P(l, t, 8, 3, 1, 2, hair); P(l, t, 2, -1, 1, 1, hair); P(l, t, 4, -1, 2, 1, hair); P(l, t, 7, -1, 1, 1, hair); P(l, t, 3, 3, 4, 1, hair); }
    if (k.style === "bun") { P(l, t, 1, 3, 1, 2, hair); P(l, t, 8, 3, 1, 2, hair); P(l, t, 3, -2, 4, 2, hair); P(l, t, 4, -3, 2, 1, hair); }
    if (k.style === "long") P(l, t, 2, 3, 3, 1, hair);
    if (k.style === "bob") P(l, t, 1, 3, 8, 1, hair);
    if (k.style === "curly") { // a round puff of curls
      P(l, t, 0, 1, 1, 4, hair); P(l, t, 9, 1, 1, 4, hair);
      P(l, t, 1, -1, 2, 1, hair); P(l, t, 4, -1, 2, 1, hair); P(l, t, 7, -1, 2, 1, hair);
      P(l, t, 1, 3, 2, 1, hair); P(l, t, 7, 3, 2, 1, hair); P(l, t, 1, 4, 1, 1, hair); P(l, t, 8, 4, 1, 1, hair);
      P(l, t, 2, 1, 1, 1, k.hairHi); P(l, t, 5, 0, 1, 1, k.hairHi); P(l, t, 7, 1, 1, 1, k.hairHi);
    }
    if (k.style === "part") { // side-parted, the fringe swept to one side
      P(l, t, 1, 3, 1, 2, hair); P(l, t, 8, 3, 1, 1, hair); P(l, t, 2, 3, 4, 1, hair);
      P(l, t, 3, 1, 1, 2, k.hairHi);
    }
    if (k.style === "cap") {
      P(l, t, 1, 3, 1, 2, hair); P(l, t, 8, 3, 1, 2, hair);
      P(l, t, 2, -1, 6, 1, k.cap); P(l, t, 1, 0, 8, 3, k.cap);
      if (face !== "back") P(l, t, face === "left" ? 0 : 1, 3, 9, 1, k.capLo);
    }
    if (k.acc === "phones") { P(l, t, 1, -1, 8, 1, k.accColor); P(l, t, 0, 0, 1, 4, k.accColor); P(l, t, 9, 0, 1, 4, k.accColor); P(l, t, 0, 4, 1, 3, k.accColor); P(l, t, 9, 4, 1, 3, k.accColor); }
    if (k.acc === "beret") { P(l, t, 1, -2, 6, 2, k.accColor); P(l, t, 0, -1, 1, 1, k.accColor); P(l, t, 4, -3, 1, 1, k.accColor); }
    if (k.acc === "glasses" && face !== "back") { P(l, t, 2, 4, 2, 1, k.accColor); P(l, t, 5, 4, 2, 1, k.accColor); P(l, t, 4, 4, 1, 1, k.accColor); }
  }
  function drawStanding(c, x, y, face, frame, opt) {
    var k = c.look, l = x - 5, t = y - 18, lf = frame === 1, rf = frame === 2;
    P(l, t, 3, 14, 2, lf ? 2 : 3, k.pants); P(l, t, 5, 14, 2, rf ? 2 : 3, k.pants);
    P(l, t, 2, lf ? 16 : 17, 3, 1, C.shoe); P(l, t, 5, rf ? 16 : 17, 3, 1, C.shoe);
    P(l, t, 2, 9, 6, 5, k.shirt);
    var la = rf ? 1 : lf ? -1 : 0, ra = -la;
    P(l, t, 1, 10, 1, 3, k.shirt); P(l, t, 8, 10, 1, 3, k.shirt);
    P(l, t, 1, 13 + (face === "front" ? la : 0), 1, 1, k.skin);
    if (opt.mug) { P(l, t, 8, 11, 2, 2, C.white); P(l, t, 8, 13, 1, 1, k.skin); }
    else P(l, t, 8, 13 + (face === "front" ? ra : 0), 1, 1, k.skin);
    if (k.acc === "tie" && face !== "back") { P(l, t, 4, 9, 2, 1, k.accColor); P(l, t, 4, 10, 1, 3, k.accColor); }
    if (k.acc === "collar" && face !== "back") { P(l, t, 3, 9, 4, 1, k.accColor); P(l, t, 4, 10, 2, 1, k.accColor); P(l, t, 3, 11, 1, 1, k.pin); }
    drawHead(c, l, t, face, opt);
    if (opt.chat) { // speech dots while visiting a colleague
      var on = Math.floor(c.clock * 3) % 4;
      for (var d = 0; d < 3; d++) if (d < on) P(l, t, 2 + d * 2, -5, 1, 1, "#5e3b22");
    }
    if (opt.mug) { var s = Math.floor(c.clock * 4) % 3; P(l, t, 9, 9 - s, 1, 1, "rgba(255,255,255,.8)"); }
  }
  function drawSeated(c) {
    var d = L.desks[c.i], k = c.look, l = d.x - 5, t = d.y - 19;
    if (k.style === "long") { P(l, t, 0, 9, 2, 3, k.hair); P(l, t, 8, 9, 2, 3, k.hair); }
    P(l, t, 1, 9, 8, 10, k.shirt);
    P(l, t, 0, 10, 1, 9, k.shirt); P(l, t, 9, 10, 1, 9, k.shirt);
    if (k.acc === "tie") { P(l, t, 4, 9, 2, 1, k.accColor); P(l, t, 4, 10, 1, 4, k.accColor); }
    if (k.acc === "collar") { P(l, t, 3, 9, 4, 1, k.accColor); P(l, t, 4, 10, 2, 1, k.accColor); P(l, t, 2, 12, 1, 1, k.pin); }
    var bob = c.working && !reduced && Math.floor(c.clock * 2) % 2 ? 1 : 0;
    drawHead(c, l, t + bob, c.working ? "front" : c.look2 || "front", { blink: blinking(c), glow: c.working });
  }
  function blinking(c) { return !reduced && (c.clock + c.i * 0.7) % 3.6 < 0.12; }
  function drawChar(c) {
    if (c.state === "sit") { drawSeated(c); return; }
    var walking = c.state === "walk" && !reduced;
    var frame = walking ? [1, 0, 2, 0][Math.floor(c.clock * 8) % 4] : 0;
    var spot = c.state === "stay" ? c.spot : null;
    drawStanding(c, Math.round(c.x), Math.round(c.y), c.face, frame, {
      blink: blinking(c),
      mug: spot && spot.kind === "coffee" && c.stayed > 1.2,
      chat: spot && spot.kind === "visit" && !reduced
    });
  }

  /* ── where characters go and how they get there ── */
  function seatSpot(i) { var d = L.desks[i]; return { kind: "seat", desk: i, r: d.r, entry: d.x + 9, approach: [[d.x + 9, d.y - 3], [d.x, d.y - 3]], face: "front" }; }
  function visitSpot(j) { var d = L.desks[j]; return { kind: "visit", desk: j, r: d.r, entry: d.x - 14, approach: [[d.x - 14, d.y - 3]], face: "right" }; }
  function laneSpot(kind, x, face) { return { kind: kind, desk: -1, r: 0, entry: Math.round(x), approach: [], face: face }; }
  function pois() {
    return [laneSpot("coffee", L.W - 31, "back"), laneSpot("board", L.board.x + L.board.w / 2, "back"),
            laneSpot("window", L.win.x + L.win.w / 2, "back"), laneSpot("plant", 22, "left")];
  }
  function endOf(spot) { var a = spot.approach; return a.length ? a[a.length - 1] : [spot.entry, L.lanes[spot.r]]; }
  function bestAisle(a, b) {
    return L.aisles.reduce(function (best, x) { return Math.abs(a - x) + Math.abs(b - x) < Math.abs(a - best) + Math.abs(b - best) ? x : best; });
  }
  function route(a, b) {
    var pts = [], k;
    for (k = a.approach.length - 2; k >= 0; k--) pts.push(a.approach[k]);
    var la = L.lanes[a.r], lb = L.lanes[b.r];
    pts.push([a.entry, la]);
    if (a.r !== b.r) { var x = bestAisle(a.entry, b.entry); pts.push([x, la], [x, lb]); }
    pts.push([b.entry, lb]);
    for (k = 0; k < b.approach.length; k++) pts.push(b.approach[k]);
    return pts;
  }
  function taken(spot, except) {
    return chars.some(function (c) { return c !== except && c.target && c.target.kind === spot.kind && c.target.desk === spot.desk; });
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function place(c, spot) {
    var p = endOf(spot);
    c.x = p[0]; c.y = p[1]; c.spot = c.target = spot; c.face = spot.face; c.stayed = 0;
    c.state = spot.kind === "seat" ? "sit" : "stay";
  }
  function go(c, spot) {
    c.path = route(c.spot, spot); c.target = spot; c.state = "walk"; c.stayed = 0;
  }
  function pickOuting(c) {
    var options = pois().filter(function (s) { return !taken(s, c); });
    var hosts = chars.filter(function (o) { return o !== c && o.state === "sit"; });
    if (hosts.length && Math.random() < 0.3) {
      var v = visitSpot(hosts[Math.floor(Math.random() * hosts.length)].i);
      if (!taken(v, c)) return v;
    }
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }
  function decide(c) {
    if (c.state === "sit") {
      var out = c.working ? null : pickOuting(c);
      if (out) go(c, out); else c.timer = rand(4, 9);
      if (!c.working && !out) c.look2 = Math.random() < 0.5 ? "left" : "right";
      return;
    }
    if (Math.random() < 0.55) { go(c, seatSpot(c.i)); return; }
    var next = pickOuting(c);
    if (next) go(c, next); else go(c, seatSpot(c.i));
  }
  function step(c, dt) {
    c.clock += dt;
    if (c.state !== "walk") {
      c.stayed += dt; c.timer -= dt;
      if (c.state === "stay" && c.spot.kind === "coffee" && c.stayed > 1.2) c.face = "front";
      if (c.timer <= 0) decide(c);
      return;
    }
    var left = SPEED * dt;
    while (left > 0 && c.path.length) {
      var p = c.path[0], dx = p[0] - c.x, dy = p[1] - c.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.01) c.face = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "front" : "back");
      if (dist <= left) { c.x = p[0]; c.y = p[1]; left -= dist; c.path.shift(); }
      else { c.x += dx / dist * left; c.y += dy / dist * left; left = 0; }
    }
    if (!c.path.length) {
      place(c, c.target);
      c.timer = c.state === "sit" ? rand(4, 10) : rand(3, 6);
    }
  }

  /* ── state ── */
  var chars = [], sparks = [], reduced = false, raf = 0, lastTs = 0, lastDraw = 0, hover = null, pinned = null;
  function setup() {
    chars = roles.slice(0, L.desks.length).map(function (role, i) {
      return { i: i, role: role, look: LOOKS[role.key] || LOOKS.pm, working: role.status === "working",
               clock: Math.random() * 3, timer: 0, stayed: 0, path: [], face: "front", spot: null, target: null, state: "sit" };
    });
    var spots = pois(), next = 0;
    chars.forEach(function (c) {
      if (c.working || c.i % 2 === 0 || next >= spots.length) { place(c, seatSpot(c.i)); c.timer = c.working ? 1e9 : rand(1, 5); }
      else { place(c, spots[next++]); c.timer = rand(2, 6); }
    });
    sparks = [];
  }

  /* ── size: the canvas fills the stage; its backing store is in device pixels ── */
  function resize() {
    var w = stage.clientWidth;
    if (!w) return false;
    var narrow = w < NARROW_PX, changed = !L || L.narrow !== narrow;
    if (changed) L = makeLayout(narrow);
    dpr = window.devicePixelRatio || 1;
    var h = Math.round(w * L.H / L.W);
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    bg.width = canvas.width; bg.height = canvas.height;
    S = canvas.width / L.W; cssScale = w / L.W;
    ctx.imageSmoothingEnabled = false;
    if (changed) setup();
    bgMinute = -1;
    return true;
  }

  function render() {
    var minute = Math.floor(Date.now() / 60000);
    if (minute !== bgMinute) { drawRoom(); bgMinute = minute; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    var items = [];
    L.desks.forEach(function (d, i) {
      items.push({ z: d.y - 4, f: drawChair, a: i });
      items.push({ z: d.y + 1, f: drawDesk, a: i });
    });
    chars.forEach(function (c) { items.push({ z: c.state === "sit" ? L.desks[c.i].y - 2 : c.y, f: drawChar, a: c }); });
    items.sort(function (p, q) { return p.z - q.z; });
    items.forEach(function (it) { it.f(it.a); });
    sparks.forEach(function (s) { rect(ctx, Math.round(s.x), Math.round(s.y), 1, 1, s.col); });
    var steam = chars.some(function (c) { return c.state === "stay" && c.spot.kind === "coffee"; });
    if (steam && !reduced) {
      var k = Math.floor(Date.now() / 250) % 4;
      rect(ctx, L.coffee.x + 10, 34 - k, 1, 1, "rgba(255,255,255,.85)"); rect(ctx, L.coffee.x + 9, 31 - k, 1, 1, "rgba(255,255,255,.6)");
    }
    placeBubble();
  }
  function tick(ts) {
    raf = 0;
    if (document.hidden || reduced) return;
    var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    chars.forEach(function (c) {
      step(c, dt);
      if (c.state === "sit" && c.working) {
        c.spark = (c.spark || rand(0.3, 0.9)) - dt;
        if (c.spark <= 0) { var d = L.desks[c.i]; sparks.push({ x: d.x + rand(-3, 4), y: d.y - 6, vy: -9, life: 0.9, col: SPARKS[Math.floor(Math.random() * 3)] }); c.spark = rand(0.5, 1.1); }
      }
    });
    sparks = sparks.filter(function (s) { s.life -= dt; s.y += s.vy * dt; return s.life > 0; });
    if (ts - lastDraw >= FRAME_MS) { render(); lastDraw = ts; }
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (raf || reduced || document.hidden) return;
    lastTs = 0; raf = requestAnimationFrame(tick);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function still() { // reduced motion: everyone at a fixed place, one frame, redrawn each minute
    stop();
    setup();
    chars.forEach(function (c) { c.clock = 0; });
    render();
  }

  /* ── pointer: hover shows the bubble, click opens the role's page ── */
  function hitAt(ev) {
    var box = canvas.getBoundingClientRect();
    var x = (ev.clientX - box.left) / cssScale, y = (ev.clientY - box.top) / cssScale;
    var order = chars.slice().sort(function (p, q) { return zOf(q) - zOf(p); });
    for (var k = 0; k < order.length; k++) {
      var c = order[k], b = charBox(c);
      if (x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]) return { kind: "char", i: c.i };
    }
    for (var i = 0; i < Math.min(roles.length, L.desks.length); i++) {
      var d = L.desks[i];
      if (x >= d.x - 27 && x <= d.x + 27 && y >= d.y - 18 && y <= d.y + 25) return { kind: "desk", i: i };
    }
    return null;
  }
  function zOf(c) { return c.state === "sit" ? L.desks[c.i].y - 2 : c.y; }
  function charBox(c) {
    if (c.state === "sit") { var d = L.desks[c.i]; return [d.x - 6, d.y - 22, 12, 18]; }
    return [Math.round(c.x) - 6, Math.round(c.y) - 21, 12, 22];
  }
  function anchorOf(target) {
    if (target.kind === "char") { var b = charBox(chars[target.i]); return [b[0] + b[2] / 2, b[1]]; }
    var d = L.desks[target.i]; return [d.x, d.y - 4];
  }
  function href(i) { return roles[i].key + ".html"; }
  function fill(target) {
    var role = roles[target.i], now = role.now;
    var text = now ? (now.kind === "commit" ? "提交紀錄：" : "") + now.text : "近 14 天沒有紀錄。";
    if (text.length > BUBBLE_CHARS) text = text.slice(0, BUBBLE_CHARS - 1) + "…";
    bubble.textContent = "";
    var head = document.createElement("p"); head.className = "ob-head";
    head.textContent = role.name + " · " + (role.status === "working" ? "工作中" : "休息中");
    var body = document.createElement("p"); body.className = "ob-text"; body.textContent = text;
    var link = document.createElement("a"); link.className = "ob-link"; link.href = href(target.i); link.textContent = "看詳情 ›";
    bubble.appendChild(head); bubble.appendChild(body); bubble.appendChild(link);
  }
  var shown = null;
  function show(target) {
    if (!bubble) return;
    if (!shown || shown.kind !== target.kind || shown.i !== target.i) fill(target);
    shown = target; bubble.hidden = false; placeBubble();
  }
  function hide() { shown = null; pinned = null; if (bubble) bubble.hidden = true; }
  function placeBubble() {
    if (!shown || !bubble || bubble.hidden) return;
    var a = anchorOf(shown), sw = stage.clientWidth, bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var x = Math.min(Math.max(a[0] * cssScale, bw / 2 + 4), sw - bw / 2 - 4), y = a[1] * cssScale - 6;
    var below = y - bh < 0;
    bubble.classList.toggle("below", below);
    bubble.style.left = Math.round(x) + "px";
    bubble.style.top = Math.round(below ? y + 30 * cssScale : y) + "px";
  }
  var pointerType = "mouse";
  canvas.addEventListener("pointerdown", function (ev) { pointerType = ev.pointerType || "mouse"; });
  canvas.addEventListener("pointermove", function (ev) {
    if ((ev.pointerType || "mouse") !== "mouse") return;
    var hit = hitAt(ev);
    canvas.classList.toggle("hot", !!hit);
    hover = hit;
    if (hit) show(hit); else if (!pinned) hide();
  });
  canvas.addEventListener("pointerleave", function (ev) {
    if ((ev.pointerType || "mouse") !== "mouse") return;
    canvas.classList.remove("hot"); hover = null; if (!pinned) hide();
  });
  canvas.addEventListener("click", function (ev) {
    var hit = hitAt(ev);
    if (!hit) { hide(); return; }
    var touch = pointerType !== "mouse";
    if (!touch || hit.kind === "desk" || (pinned && pinned.kind === hit.kind && pinned.i === hit.i)) {
      window.location.href = href(hit.i);
      return;
    }
    pinned = hit; show(hit); // first tap on a character: show its bubble; a second tap opens it
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") hide(); });

  /* ── lifecycle ── */
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function applyMotion() {
    reduced = !!(motion && motion.matches);
    if (reduced) still(); else { setup(); render(); start(); }
  }
  // A stage with no width yet (a hidden pane or tab at load) boots on its first real size.
  var booted = false;
  function boot() {
    if (booted || !resize()) return;
    booted = true;
    applyMotion();
    if (motion) {
      if (motion.addEventListener) motion.addEventListener("change", applyMotion);
      else if (motion.addListener) motion.addListener(applyMotion);
    }
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
    setInterval(function () { if (reduced && !document.hidden) render(); }, 60000); // sky and clock
  }
  boot();
  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!booted) { boot(); return; }
      if (resize()) { if (reduced) still(); else render(); }
    }, 80);
  }
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(stage);
  else window.addEventListener("resize", onResize);
})();
