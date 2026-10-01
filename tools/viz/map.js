/**
 * tools/viz/map.js — the map: the whole blog on one ring.
 *
 * Every piece is a point on the ring, grouped by series in nav order; every
 * link one piece makes to another is a quadratic curve across it, coloured by
 * the series the link leaves. A piece that is a close reading is a square,
 * because on this blog one book is one piece.
 *
 * WHY A RING AND NOT A FORCE LAYOUT: the graph is hub-heavy (372 links over 55
 * pieces in the deployable build, total degrees 0 to 32) and a force layout on
 * it is a hairball with no two runs alike — nothing to look at, nothing to
 * compare. A ring is deterministic: the same data always draws the same figure,
 * a neighbourhood is a contiguous arc plus the curves that touch it, and the
 * reader can see WHERE a piece sits without decoding a simulation. The cost is
 * honest and stated on the page: a position is a layout, not a measurement.
 *
 * SCHEMATIC, and the page says so: the edges are the links the pieces really
 * make (read out of the prose at render time, never inferred from a resemblance
 * between a piece and a book), and the counts are counts of those links — but
 * the ring's geometry means nothing.
 */
VIZ.registerViz('map', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';
  var LABEL_FONT = '11px ' + MONO;
  var ARC_FONT = '600 11px ' + MONO;
  var HEIGHT = 580; // canvas height; the ring is fitted to the width
  var GAP_UNITS = 3; // ring slots between two series groups
  var HUB_LABELS = 5; // named on the canvas; the rest are named in the readout
  var HIT = 14; // pointer distance, in px, that counts as being on a point

  // Series colours. The site has four colour tokens, not five, so the two reds
  // are separated by alpha and the books take the strong one — and a book is a
  // SQUARE, so its form says "book" whatever its hue. The legend draws each
  // swatch exactly as the figure draws it, so what the reader compares is what
  // is on the canvas. Everything comes from a token, so dark mode is free.
  var COLOUR = {
    mechanism: { token: 'accent', alpha: 0.42 },
    implications: { token: 'accent2', alpha: 1 },
    frames: { token: 'fg', alpha: 1 },
    cases: { token: 'dim', alpha: 1 },
    readings: { token: 'accent', alpha: 1 },
  };
  var COLOUR_FALLBACK = { token: 'dim', alpha: 1 };
  var EDGE_ALPHA = 0.17; // each curve on its own; a neighbourhood overrides it
  var DIM_ALPHA = 0.05; // everything else, while something is selected

  // The three filters, with the predicate each one names. The readout repeats
  // the predicate, so a button can never be read as saying something the figure
  // is not showing.
  var FILTERS = [
    { label: 'all links', say: 'every link' },
    { label: 'crossing series', say: 'the links that cross between two series' },
    { label: 'touching a book', say: 'the links with a book at one end' },
  ];

  function spec(series) {
    return COLOUR[series] || COLOUR_FALLBACK;
  }

  /** The graph the build serialised into the page, or null. */
  function graph() {
    var el = document.getElementById('viz-data-map');
    if (!el) return null;
    try {
      var g = JSON.parse(el.textContent);
      return g && g.nodes && g.edges ? g : null;
    } catch (e) {
      return null;
    }
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);
    // The shared figure CSS holds a canvas at a legible minimum width so the
    // multi-column figures scroll instead of squashing. This figure is round:
    // a scrolled circle is mostly off-screen, so it takes the width it is
    // given and shortens its canvas instead (see heightFor).
    canvas.style.minWidth = '0';
    var G = graph();

    var nodes = G ? G.nodes : [];
    var groups = G && G.groups ? G.groups.filter(function (g) { return g.nodes && g.nodes.length; }) : [];
    var links = [];
    var i;
    if (G) {
      for (i = 0; i < G.edges.length; i++) {
        var e = G.edges[i];
        if (e && e.length === 2 && nodes[e[0]] && nodes[e[1]]) links.push({ f: e[0], t: e[1] });
      }
    }
    // out-links and in-links per node: what the readout reports and what the
    // highlight draws
    var outs = [];
    var ins = [];
    for (i = 0; i < nodes.length; i++) {
      outs.push([]);
      ins.push([]);
    }
    for (i = 0; i < links.length; i++) {
      outs[links[i].f].push(i);
      ins[links[i].t].push(i);
    }
    var books = 0;
    for (i = 0; i < nodes.length; i++) if (nodes[i].book) books++;

    // The two of a mutual pair would otherwise be drawn on top of each other —
    // one curve where there are two links, and no direction to read. Each curve
    // bows by its own amount, so both are visible and which one starts where is
    // legible. This is a property of the links alone, not of the selection or of
    // the filter, so it is worked out once here instead of on every draw.
    var reverse = {};
    for (i = 0; i < links.length; i++) {
      for (var j = i + 1; j < links.length; j++) {
        if (links[j].f === links[i].t && links[j].t === links[i].f) {
          reverse[i] = j;
          reverse[j] = i;
          break;
        }
      }
    }

    // the layout: one ring slot per piece, `gap` empty slots between two series
    // groups, and the whole ring closed by one more gap. Both the gap and the
    // room left for the ring depend on the canvas width: on a phone the ring is
    // small, 57 pieces cannot all be spaced on it, and its labels have no room
    // outside it — so the ring takes nearly the whole canvas and the widest gap
    // it can afford, which is what keeps neighbouring marks from merging into
    // one bar. The legend is given a band across the top and the ring is fitted
    // BELOW it, so the two can never overlap however narrow the canvas gets.
    var slot = [];
    var total = 0;
    var angle = [];
    var LEGEND_ROW = 16;
    var LEGEND_TOP = 12;

    /** The legend's entries, in order, each with the width it occupies — the
     * one definition both the reserved band and the drawing use, so a row the
     * layout did not count cannot be drawn over the ring. */
    function legendItems() {
      var items = [];
      for (var gl = 0; gl < groups.length; gl++) {
        var key = groups[gl].key;
        items.push({
          label: groups[gl].label,
          series: key,
          book: key === 'readings',
          text: groups[gl].label + (key === 'readings' ? ' (books)' : ''),
        });
      }
      for (var gi = 0; gi < items.length; gi++) {
        items[gi].w = meas.measureText(items[gi].text).width + 20;
      }
      return items;
    }

    /** How many rows the legend needs at this width (it wraps). */
    function legendRows(w) {
      var avail = w - 24;
      var items = legendItems();
      var x = 0;
      var rows = 1;
      for (var gl = 0; gl < items.length; gl++) {
        if (x + items[gl].w > avail && x > 0) {
          rows++;
          x = 0;
        }
        x += items[gl].w;
      }
      return rows;
    }

    function layout(w) {
      var h = heightFor(w);
      var band = LEGEND_TOP + legendRows(w) * LEGEND_ROW + 4;
      var top = band + 6;
      var bottom = h - 10;
      var margin = w >= 620 ? 104 : 46;
      var r = Math.max(48, Math.min(w / 2 - margin, (bottom - top) / 2));
      var cy = top + (bottom - top) / 2;
      // ~11 px of ring per point at the smallest radius keeps the marks apart
      var want = Math.floor((2 * Math.PI * r) / 11) - nodes.length;
      var gap = Math.max(2, Math.min(GAP_UNITS, want));
      total = 0;
      for (var ga = 0; ga < groups.length; ga++) {
        total += gap;
        for (var gb = 0; gb < groups[ga].nodes.length; gb++) {
          slot[groups[ga].nodes[gb]] = total++;
        }
      }
      total += gap;
      for (var gc = 0; gc < nodes.length; gc++) {
        angle[gc] = -Math.PI / 2 + (((slot[gc] == null ? 0 : slot[gc]) + 0.5) / Math.max(1, total)) * Math.PI * 2;
      }
      return { w: w, h: h, cx: w / 2, cy: cy, r: r, band: band };
    }

    // the hubs: the pieces the most links touch, named on the canvas so the ring
    // has anchors to read the rest against
    var degree = [];
    for (i = 0; i < nodes.length; i++) degree.push({ i: i, d: outs[i].length + ins[i].length });
    degree.sort(function (a, b) { return b.d - a.d; });
    var hubs = [];
    for (i = 0; i < degree.length && hubs.length < HUB_LABELS; i++) {
      if (degree[i].d > 0) hubs.push(degree[i].i);
    }
    // and the ones whose names are not the largest, so the reader is never
    // shown a figure that names only its biggest pieces
    var quiet = null;
    for (i = degree.length - 1; i >= 0; i--) {
      if (degree[i].d === 0) { quiet = degree[i].i; break; }
    }

    var filter = 0;
    var sel = null;

    // a detached 2-D context, only to measure text the way the canvas will
    var meas = document.createElement('canvas').getContext('2d');
    meas.font = LABEL_FONT;

    /** `str`, shortened with an ellipsis until it fits `maxPx`. Returns '' when
     * not even the ellipsis fits — a label too long for the room it has is a
     * name the readout still carries, not one to hang off the canvas. */
    function fit(str, maxPx) {
      if (maxPx < 8 || meas.measureText('…').width > maxPx) return '';
      if (meas.measureText(str).width <= maxPx) return str;
      var s = str;
      while (s.length > 1 && meas.measureText(s + '…').width > maxPx) s = s.slice(0, -1);
      return s + '…';
    }

    /** Does this link pass the current filter? Named exactly as the readout
     * names it. */
    function passes(l) {
      if (filter === 1) return nodes[l.f].series !== nodes[l.t].series;
      if (filter === 2) return !!(nodes[l.f].book || nodes[l.t].book);
      return true;
    }

    /** Links of node `i` that the current filter keeps. */
    function kept(i) {
      var n = 0;
      var j;
      for (j = 0; j < outs[i].length; j++) if (passes(links[outs[i][j]])) n++;
      for (j = 0; j < ins[i].length; j++) if (passes(links[ins[i][j]])) n++;
      return n;
    }

    function shown() {
      var n = 0;
      for (var j = 0; j < links.length; j++) if (passes(links[j])) n++;
      return n;
    }

    function seriesLabel(key) {
      for (var j = 0; j < groups.length; j++) if (groups[j].key === key) return groups[j].label;
      return key || 'unfiled';
    }

    /** `n` with the noun that agrees with it — 1 piece, 2 pieces. */
    function pieces(n) {
      return n + (n === 1 ? ' piece' : ' pieces');
    }

    function say() {
      if (sel == null) {
        return [
          FILTERS[filter].say + ' — ', VIZ.bold(shown() + ' links between different pairs'),
          ' of the ', VIZ.bold(pieces(nodes.length)),
          '. ', VIZ.bold(books + ' of them books'),
          ', drawn as squares. An edge is a link one piece makes to another, and nothing more: ',
          'point at a piece, or tab to the figure and step with the arrow keys, to see the pieces it ' +
          'points at; Enter or a click opens it.',
        ];
      }
      var n = nodes[sel];
      return [
        VIZ.bold(n.title, true), ' — ', seriesLabel(n.series), n.book ? ', a book' : '',
        '. It points at ', VIZ.bold(pieces(outs[sel].length)),
        ', and is pointed at by ', VIZ.bold(pieces(ins[sel].length)),
        '. Drawn here under this filter: ', VIZ.bold(String(kept(sel))), ' of its links. ',
        'Enter or a click opens the piece; on a touch screen, tap it and then tap it again.',
      ];
    }

    function paint() {
      out.set(say());
    }

    /* ---------------------------------------------------------------- drawing */

    /** The CSS width the canvas actually has, measured the way the engine's
     * fitCanvas measures it (and with its floor), so the height this widget
     * picks and the width the frame is given cannot disagree. */
    function cssWidth() {
      var measured = Math.round(canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 0);
      return Math.max(240, measured || 680);
    }

    /** How tall the figure should be at this width.
     *
     * The canvas is fitted to the viewport instead of being held at a minimum
     * width and scrolled (which is what .viz does for the multi-column figures,
     * where a squashed layout is worse than a sideways scroll). A RING is the
     * one shape where that trade goes the other way: a scrolled circle is
     * mostly off-screen, so the figure gives up width rather than the reader
     * giving up the whole. Below the width where the ring has room, the canvas
     * is also shortened, so a phone gets the ring, not a ring in an empty
     * 580-pixel frame. */
    var MIN_W = 620;
    function heightFor(w) {
      return w < MIN_W ? Math.max(280, Math.round(Math.min(HEIGHT, w * 0.95))) : HEIGHT;
    }

    /** The ring: its centre and radius, from the canvas the reader actually has.
     * One definition, so the drawing, the legend and the hit test cannot
     * disagree about where a piece is — and the layout is recomputed from the
     * width each time, so the angles the hit test uses are the ones drawn. */
    function ring(w) {
      return layout(w);
    }

    function draw() {
      var f = VIZ.frame(canvas, {
        height: heightFor(cssWidth()),
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        pad: { l: 0, r: 0, t: 0, b: 0 },
        ariaLabel:
          'A ring of ' + nodes.length + ' pieces, grouped by series, of which ' + books +
          ' are books and drawn as squares. A curve joins two pieces when one of them links to the other, ' +
          'one curve per pair — a piece that links to another five times still makes one line: ' +
          links.length + ' links between different pairs of them are drawn. The position of a piece on the ' +
          'ring is a layout; the number of links is a count. Point at a piece, or move with the arrow keys, ' +
          'to read the pieces it points at; Enter or a click opens it.',
      });
      var c = f.ctx;
      var W = f.w;
      var H = f.h;
      var g = ring(W);
      var cx = g.cx;
      var cy = g.cy;
      var r = g.r;
      var px = [];
      var py = [];
      var i2;
      for (i2 = 0; i2 < nodes.length; i2++) {
        px[i2] = cx + r * Math.cos(angle[i2]);
        py[i2] = cy + r * Math.sin(angle[i2]);
      }

      // the ring the pieces sit on: the figure's one structural line
      c.save();
      c.globalAlpha = 1;
      c.strokeStyle = VIZ.token('line');
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
      c.restore();

      if (!nodes.length) {
        f.textPx('no pieces to draw', 16, 24, { color: VIZ.token('dim') });
        f.flushLabels();
        return;
      }

      // the curves: faint, thin, and coloured by the series the link LEAVES, so
      // a reader can follow one series' reach without following all of them
      var neighbourhood = null;
      if (sel != null) {
        neighbourhood = {};
        neighbourhood[sel] = true;
        // the neighbourhood follows the links that are DRAWN, not every link the
        // piece has: with a filter on, a neighbour joined only by a curve that
        // the filter removed must not light up, or the highlight would disagree
        // with the readout's own "of its links" count
        for (i2 = 0; i2 < outs[sel].length; i2++) {
          if (passes(links[outs[sel][i2]])) neighbourhood[links[outs[sel][i2]].t] = true;
        }
        for (i2 = 0; i2 < ins[sel].length; i2++) {
          if (passes(links[ins[sel][i2]])) neighbourhood[links[ins[sel][i2]].f] = true;
        }
      }
      for (i2 = 0; i2 < links.length; i2++) {
        var l = links[i2];
        if (!passes(l)) continue;
        var hot = neighbourhood && (l.f === sel || l.t === sel);
        var sp = spec(nodes[l.f].series);
        // the curve's belly is placed on the angle halfway between its two ends
        // (a circular mean, so it stays stable when the two are nearly
        // opposite), at a radius that keeps a long chord off the crowded centre
        // and a short one close to the ring
        var mAng = Math.atan2(Math.sin(angle[l.f]) + Math.sin(angle[l.t]), Math.cos(angle[l.f]) + Math.cos(angle[l.t]));
        var mmx = (px[l.f] + px[l.t]) / 2 - cx;
        var mmy = (py[l.f] + py[l.t]) / 2 - cy;
        var mr = Math.sqrt(mmx * mmx + mmy * mmy);
        var bow = reverse[i2] == null ? 0.46 : reverse[i2] > i2 ? 0.30 : 0.74;
        var cr = r * bow + mr * 0.34;
        c.save();
        c.globalAlpha = hot ? 0.9 : neighbourhood ? DIM_ALPHA : EDGE_ALPHA * (0.35 + 0.65 * sp.alpha);
        c.strokeStyle = VIZ.token(sp.token);
        c.lineWidth = hot ? 1.5 : 0.7;
        c.beginPath();
        c.moveTo(px[l.f], py[l.f]);
        c.quadraticCurveTo(cx + Math.cos(mAng) * cr, cy + Math.sin(mAng) * cr, px[l.t], py[l.t]);
        c.stroke();
        c.restore();
      }

      // the pieces
      for (i2 = 0; i2 < nodes.length; i2++) {
        var n = nodes[i2];
        var spn = spec(n.series);
        var isSel = sel === i2;
        var near = !!(neighbourhood && neighbourhood[i2] && !isSel);
        var size = isSel ? 5 : near ? 4 : 3.2;
        c.save();
        // the legend draws each swatch at exactly this alpha, so what the
        // reader compares is what is on the canvas
        c.globalAlpha = neighbourhood && !isSel && !near ? spn.alpha * 0.5 : spn.alpha;
        c.fillStyle = VIZ.token(spn.token);
        if (n.book) {
          c.fillRect(px[i2] - size, py[i2] - size, size * 2, size * 2);
        } else {
          c.beginPath();
          c.arc(px[i2], py[i2], size, 0, Math.PI * 2);
          c.fill();
        }
        if (isSel) {
          c.globalAlpha = 1;
          c.strokeStyle = VIZ.token('fg');
          c.lineWidth = 1.2;
          c.beginPath();
          c.arc(px[i2], py[i2], size + 4, 0, Math.PI * 2);
          c.stroke();
        }
        c.restore();
      }

      /* labels — as few as possible. A ring of every title would run off the
         canvas and bury the figure, so the canvas names the series arcs, the
         largest hubs and whatever the reader is on; everything else is named in
         the readout, which is a live region and readable by a screen reader.
         Each label is measured against the room there actually is on ITS side of
         its own point (a fixed character budget runs off the canvas as soon as
         the canvas is narrow), then placed only where the canvas is clear.
         The engine's own label painter avoids a clash by nudging a label up or
         down, which cannot know about the legend band this figure reserves —
         so the placement is decided here and the painter is called with a spot
         that is already free. A name with nowhere to go is simply not drawn;
         the readout still carries it, and the hovered piece always gets its own
         name however tight the canvas is. */
      var LIMIT = 210;
      var boxes = [];

      /** Is a label's box clear of the canvas edge, the legend band and every
       * label already placed? */
      function clear(x0, x1, y) {
        if (x0 < 3 || x1 > W - 3) return false;
        if (y - 7 < g.band + 2 || y + 7 > H - 3) return false;
        for (var b = 0; b < boxes.length; b++) {
          var bx = boxes[b];
          if (x0 < bx.x1 + 5 && bx.x0 < x1 + 5 && y < bx.y1 + 3 && bx.y0 < y + 3) return false;
        }
        return true;
      }

      /** Draw `str` at its natural spot, or at the nearest spot that is clear;
       * `must` draws it anyway (the piece the reader is on). */
      function place(str, x, y, o, must) {
        if (!str) return;
        var tw = meas.measureText(str).width;
        var x0 = o.align === 'right' ? x - tw : o.align === 'center' ? x - tw / 2 : x;
        var base = clamp(y, g.band + 9, H - 9);
        var offsets = [0, -13, 13, -26, 26, -39, 39, -52, 52];
        for (var n = 0; n < offsets.length; n++) {
          var yy = base + offsets[n];
          if (!clear(x0, x0 + tw, yy)) continue;
          boxes.push({ x0: x0, x1: x0 + tw, y0: yy - 7, y1: yy + 7 });
          f.textPx(str, x, yy, o);
          return;
        }
        if (must) {
          boxes.push({ x0: x0, x1: x0 + tw, y0: base - 7, y1: base + 7 });
          f.textPx(str, x, base, o);
        }
      }

      // the series arcs first: they are what makes the ring readable, so they
      // get the first pick of the space outside it
      for (var gi2 = 0; gi2 < groups.length; gi2++) {
        var ids = groups[gi2].nodes;
        var mid = 0;
        for (var j2 = 0; j2 < ids.length; j2++) mid += slot[ids[j2]] + 0.5;
        mid = mid / Math.max(1, ids.length);
        var a = -Math.PI / 2 + (mid / Math.max(1, total)) * Math.PI * 2;
        var ax = cx + (r + 16) * Math.cos(a);
        var ay = cy + (r + 16) * Math.sin(a);
        var aAlign = Math.cos(a) >= 0 ? 'left' : 'right';
        // the room OUTSIDE the ring is smallest where the ring is widest — on
        // the horizontal axis — so the inside is a real alternative there, not a
        // fallback: the name goes wherever it fits, and is only shortened when
        // neither side has the room for it.
        var outRoom = aAlign === 'left' ? W - ax - 8 : ax - 8;
        var innRoom = 2 * r - 20; // the clear width across the ring's interior
        var label = groups[gi2].label;
        if (outRoom >= meas.measureText(label).width + 4 || outRoom >= innRoom) {
          place(fit(label, Math.min(LIMIT, outRoom)), ax + (aAlign === 'left' ? 2 : -2), ay,
            { align: aAlign, color: VIZ.token('dim'), font: ARC_FONT }, true);
        } else {
          place(fit(label, Math.min(LIMIT, innRoom)), ax - Math.cos(a) * 34, ay,
            { align: aAlign === 'left' ? 'right' : 'left', color: VIZ.token('dim'), font: ARC_FONT }, true);
        }
      }

      // then the pieces: the largest hubs, one piece with nothing pointing at it
      // (so the figure is not only its biggest names), and whatever the reader is
      // on — which is placed last and always drawn
      var named = [];
      var howMany = W >= 620 ? HUB_LABELS : W >= 480 ? 3 : 2;
      for (i2 = 0; i2 < hubs.length && named.length < howMany; i2++) if (hubs[i2] !== sel) named.push(hubs[i2]);
      // a name shortened to a stub says nothing the readout does not say in
      // full, so a stunted one is dropped rather than drawn as "the r …"
      if (quiet != null && quiet !== sel) named.push(quiet);
      if (sel != null) named.push(sel);
      for (i2 = 0; i2 < named.length; i2++) {
        var k = named[i2];
        var ux = Math.cos(angle[k]);
        var uy = Math.sin(angle[k]);
        var outAlign = ux >= 0 ? 'left' : 'right';
        var outRoom = outAlign === 'left' ? W - (px[k] + 11) - 8 : px[k] - 9 - 8;
        var needs = meas.measureText(nodes[k].title).width;
        // A phone has no room outside the ring for a title, and the painter lays
        // an opaque patch behind every label, so a name over the links stays
        // readable: narrow canvases put the names INSIDE the ring, where the
        // room is the width of the ring itself. On a wide canvas the outside is
        // the natural place and is kept unless the title does not fit there.
        var inside = W < 620 || (outRoom < needs + 4 && 2 * r - 30 > outRoom);
        var room = Math.min(LIMIT, inside ? 2 * r - 30 : outRoom);
        var align = inside ? (ux >= 0 ? 'right' : 'left') : outAlign;
        var lx = (inside ? px[k] - ux * 14 : px[k] + ux * 9) + (align === 'left' ? 2 : -2);
        var shown = fit(nodes[k].title, room);
        // a name shortened to a stub says nothing the readout does not say in
        // full, so a stunted one is dropped rather than drawn as "the r …"
        if (k !== sel && needs > room && meas.measureText(shown).width < 60) continue;
        place(shown, lx, py[k] + uy * 9, {
          align: align,
          color: k === sel ? VIZ.token('fg') : VIZ.token('dim'),
          font: k === sel ? ARC_FONT : LABEL_FONT,
        }, k === sel);
      }

      drawLegend(f);

      // the labels are painted last, so no curve or point can strike through one
      f.flushLabels();
    }

    function clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    /** The legend, on the canvas: the same swatches the figure draws, so the
     * reader is comparing like with like (and the PNG export keeps them). It
     * occupies the band layout() reserved for it, and wraps inside the canvas
     * width — the same widths legendRows() counted, so the two agree. */
    function drawLegend(f) {
      var items = legendItems();
      var maxX = f.w - 12;
      var x = 12;
      var y = LEGEND_TOP + LEGEND_ROW / 2;
      for (var i3 = 0; i3 < items.length; i3++) {
        var it = items[i3];
        var tw = it.w;
        if (x + tw > maxX && x > 12) {
          x = 12;
          y += LEGEND_ROW;
        }
        var sp = spec(it.series);
        f.ctx.save();
        f.ctx.globalAlpha = sp.alpha;
        f.ctx.fillStyle = VIZ.token(sp.token);
        if (it.book) f.ctx.fillRect(x, y - 4, 8, 8);
        else {
          f.ctx.beginPath();
          f.ctx.arc(x + 4, y, 4, 0, Math.PI * 2);
          f.ctx.fill();
        }
        f.ctx.restore();
        f.textPx(it.text, x + 13, y, { color: VIZ.token('dim'), font: LABEL_FONT });
        x += tw;
      }
    }

    /* ------------------------------------------------------------ interaction */

    function setSel(i) {
      if (i === sel) return;
      sel = i;
      draw();
      paint();
    }

    function pointAt(ev) {
      if (!nodes.length) return null;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var mx = ev.clientX;
      var my = ev.clientY;
      if (rect && rect.width && rect.height) {
        // the canvas is drawn in CSS pixels and scaled by the device, so the
        // pointer has to be mapped back through the box it actually occupies —
        // each axis by its OWN ratio (they agree only while the CSS height
        // tracks the attribute's ratio, which `height:auto` does today)
        mx = (ev.clientX - rect.left) * (canvas.clientWidth / rect.width);
        my = (ev.clientY - rect.top) * (canvas.clientHeight / rect.height);
      }
      var g = ring(cssWidth());
      var best = null;
      var bestD = HIT * HIT;
      for (var i4 = 0; i4 < nodes.length; i4++) {
        var dx = g.cx + g.r * Math.cos(angle[i4]) - mx;
        var dy = g.cy + g.r * Math.sin(angle[i4]) - my;
        var d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i4;
        }
      }
      return best;
    }

    bag.on(canvas, 'mousemove', function (ev) {
      setSel(pointAt(ev));
    });
    bag.on(canvas, 'mouseleave', function () {
      setSel(null);
    });
    // A finger has no hover, so a TAP selects: the readout is the only place a
    // phone can read a piece's own links, and a tap that navigated would never
    // reach it. A second tap on the piece the last one selected opens it — the
    // gesture a touch reader tries when the first tap visibly changed nothing.
    // A mouse is untouched by either: hovering still selects, a click still
    // opens. The readout and the canvas description both say what a tap does.
    var tapSel = null; // the piece the last tap selected
    var tapClick = false; // the click a tap generates is not a navigation
    // A tap's synthetic click is the only thing that clears the flag, and a tap
    // does not always produce one (a scroll-tap, or a tap the canvas loses). A
    // stale flag would then swallow the next genuine mouse click, so a mouse
    // pointerdown — which always precedes a mouse click — clears it first.
    bag.on(canvas, 'pointerdown', function (ev) {
      if (ev.pointerType === 'mouse') tapClick = false;
    });
    bag.on(canvas, 'pointerup', function (ev) {
      if (!nodes.length || ev.pointerType === 'mouse') return;
      var hit = pointAt(ev);
      if (hit == null) return;
      tapClick = true; // swallow the click this tap is about to produce
      if (tapSel === hit) {
        window.location.href = '/' + nodes[hit].slug + '/';
        return;
      }
      tapSel = hit;
      setSel(hit);
    });
    bag.on(canvas, 'click', function (ev) {
      if (tapClick) {
        // the click behind a tap: the tap has already selected the piece, and
        // opening it here would be the one thing a phone cannot afford
        tapClick = false;
        return;
      }
      var hit = pointAt(ev);
      if (hit == null) return;
      window.location.href = '/' + nodes[hit].slug + '/';
    });

    // keyboard: the canvas is focusable and the arrow keys step a piece at a
    // time, so the same information is reachable without a pointer
    canvas.setAttribute('tabindex', '0');
    bag.on(canvas, 'focus', function () {
      if (sel == null && nodes.length) setSel(0);
    });
    bag.on(canvas, 'keydown', function (ev) {
      if (!nodes.length) return;
      var step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1
        : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (sel != null) window.location.href = '/' + nodes[sel].slug + '/';
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Home') setSel(0);
      else if (ev.key === 'End') setSel(nodes.length - 1);
      else if (step) setSel(((sel == null ? (step > 0 ? -1 : 0) : sel) + step + nodes.length) % nodes.length);
      else return;
      ev.preventDefault();
    });

    for (var fi = 0; fi < FILTERS.length; fi++) {
      (function (idx) {
        var b = VIZ.button(FILTERS[idx].label, function () {
          filter = idx;
          paintButtons();
          draw();
          paint();
          VIZ.saveState(ctx);
        });
        controls.appendChild(b);
      })(fi);
    }
    var btns = controls.querySelectorAll('button');

    function paintButtons() {
      for (var j3 = 0; j3 < btns.length; j3++) {
        var on = j3 === filter;
        btns[j3].style.borderColor = on ? VIZ.token('accent') : '';
        btns[j3].style.color = on ? VIZ.token('accent') : '';
        btns[j3].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    // linkable frame: #viz=map&f=1&s=12
    VIZ.share(ctx, {
      get: function () {
        return { f: filter, s: sel == null ? -1 : sel };
      },
      set: function (st) {
        if (typeof st.f === 'number' && st.f >= 0 && st.f < FILTERS.length) filter = Math.round(st.f);
        if (typeof st.s === 'number') {
          sel = st.s < 0 || st.s >= nodes.length ? null : Math.round(st.s);
        }
        paintButtons();
        draw();
        paint();
      },
    });

    bag.onResize(draw);
    paintButtons();
    draw();
    paint();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
