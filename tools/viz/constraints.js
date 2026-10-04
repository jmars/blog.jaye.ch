/**
 * tools/viz/constraints.js — the harness §4a (the constraint grid).
 *
 * THE DESIGN'S REAL SHAPE: every binding constraint of the harness, one cell
 * per C-entry, each carrying its own status — and the point the grid must make
 * is that the statuses DIFFER. Some constraints are MEASURED (a number with an
 * artifact behind it); some are INTERPRETATION (a reading of measured facts);
 * some are PROJECTION (a design hypothesis no measurement backs yet); some are
 * DECIDED (a user decision, made on stated grounds); some are [C] (an open
 * design choice). A reader must be able to tell one from another AT A GLANCE
 * and in the readout — never by colour alone.
 *
 * Every cell is CURATED FROM THE DESIGN: the constraint's text and its status
 * were parsed out of the design documents by the generator, not typed here.
 * Click a cell to read the constraint and its evidence; the filter buttons
 * isolate one status; the counts per status are always in the readout.
 */
VIZ.registerViz('constraints', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The status vocabulary, in the grid's own display order. [C] is the
   * design's marking for an open design choice — displayed as "CHOICE" so the
   * word carries its own meaning, with the bracket form kept in the readout. */
  var ORDER = ['MEASURED', 'INTERPRETATION', 'PROJECTION', 'DECIDED', 'C'];
  var WORD = { MEASURED: 'MEASURED', INTERPRETATION: 'INTERPRETATION', PROJECTION: 'PROJECTION', DECIDED: 'DECIDED', C: '[C] choice' };
  /** A narrow cell's fixed short form — a NAMED abbreviation, never a
   * mid-word cut, so the reader is never asked to complete a truncated word. */
  var ABBR = { INTERPRETATION: 'INTERP.', PROJECTION: 'PROJ.', MEASURED: 'MEAS.' };

  /** The page's own data block (the generator's curated constraint set). */
  function data() {
    var el = document.getElementById('viz-data-harness');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.constraints && d.constraints.length ? d : null;
    } catch (e) {
      return null;
    }
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var d = data();
    if (!d) {
      out.set(['the figure is missing its own data — every cell on it is curated from the design, and there is none to draw.']);
      return;
    }

    var rows = d.constraints;
    var filter = null; // one of ORDER, or null (all)
    var sel = null; // selected constraint id
    var cells = []; // hit rects, per draw

    // count EVERY status a row carries, not only its headline: the filter
    // matches any status, so a headline-only count would disagree with what
    // the filter shows — a "PROJECTION (0)" button that is not empty. A row
    // the doc splits ("MEASURED (inputs); PROJECTION (component)") therefore
    // counts under BOTH, which is what it is.
    function counts() {
      var c = {};
      for (var i = 0; i < rows.length; i++) {
        for (var j = 0; j < rows[i].status.length; j++) {
          var k = rows[i].status[j];
          c[k] = (c[k] || 0) + 1;
        }
      }
      return c;
    }

    function visible() {
      return rows.filter(function (r) {
        return filter == null || r.status.indexOf(filter) >= 0;
      });
    }

    var buttons = [null].concat(ORDER).map(function (st) {
      var label = st == null ? 'all' : WORD[st];
      var b = VIZ.button(label, function () {
        filter = st;
        if (sel != null) {
          var keep = false;
          for (var i = 0; i < rows.length; i++) if (rows[i].id === sel && rows[i].status.indexOf(st == null ? '' : st) >= 0) keep = true;
          if (st != null && !keep) sel = null;
        }
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      controls.appendChild(b);
      return { st: st, el: b };
    });

    function paint() {
      var c = counts();
      for (var i = 0; i < buttons.length; i++) {
        var on = buttons[i].st === filter;
        buttons[i].el.style.borderColor = on ? VIZ.token('accent') : '';
        buttons[i].el.style.color = on ? VIZ.token('accent') : '';
        var n = buttons[i].st == null ? rows.length : c[buttons[i].st] || 0;
        // a status with ZERO cells is DRAWN as a zero — a count that can be
        // zero must never be an omitted button (an absence is not a zero)
        buttons[i].el.textContent = (buttons[i].st == null ? 'all' : WORD[buttons[i].st]) + ' (' + n + ')';
      }
    }

    VIZ.share(ctx, {
      get: function () {
        return { f: filter == null ? 0 : ORDER.indexOf(filter) + 1, s: sel == null ? '' : sel };
      },
      set: function (s) {
        filter = s.f != null && s.f > 0 ? ORDER[s.f - 1] : null;
        if (s.s != null) sel = rows.some(function (r) { return r.id === s.s; }) ? s.s : null;
        paint();
        draw();
      },
    });

    function pointAt(ev) {
      if (!cells.length) return null;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var mx = ev.clientX;
      var my = ev.clientY;
      if (rect && rect.width && rect.height) {
        mx = (ev.clientX - rect.left) * (canvas.clientWidth / rect.width);
        my = (ev.clientY - rect.top) * (canvas.clientHeight / rect.height);
      }
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (mx >= c.x0 && mx <= c.x1 && my >= c.y0 && my <= c.y1) return c.id;
      }
      return null;
    }
    bag.on(canvas, 'mousemove', function (ev) {
      var hit = pointAt(ev);
      if (hit !== sel) select(hit);
    });
    bag.on(canvas, 'mouseleave', function () {
      select(null);
    });
    bag.on(canvas, 'click', function (ev) {
      select(pointAt(ev));
    });
    // keyboard: arrows walk the visible cells, Enter pins/unpins the readout
    canvas.setAttribute('tabindex', '0');
    bag.on(canvas, 'keydown', function (ev) {
      var vis = rows.filter(function (r) {
        return filter == null || r.status.indexOf(filter) >= 0;
      });
      if (!vis.length) return;
      var step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      ev.preventDefault();
      var at = sel == null ? (step > 0 ? -1 : 0) : vis.findIndex(function (r) { return r.id === sel; });
      if (at < 0) at = step > 0 ? -1 : 0;
      select(vis[Math.min(vis.length - 1, Math.max(0, at + step))].id);
    });

    function select(id) {
      sel = id;
      draw();
      VIZ.saveState(ctx);
    }

    function draw() {
      // FIXED height: every cell is always drawn — a filter dims the cells it
      // excludes rather than removing them, so the canvas never resizes between
      // draws (a shrunk canvas would strand labels drawn by the earlier layout)
      var cols = 8;
      var rowsN = Math.ceil(rows.length / cols) || 1;
      var f = VIZ.frame(canvas, {
        height: 60 + rowsN * 62,
        ariaLabel:
          'the constraint grid: every binding constraint of the harness as one cell, colourable by status — ' +
          'MEASURED, INTERPRETATION, PROJECTION, DECIDED, or [C] an open design choice. Select a cell to read ' +
          'the constraint and the statuses it carries.',
        xMin: 0,
        xMax: cols,
        yMin: 0,
        yMax: rowsN,
        pad: { l: 20, r: 20, t: 14, b: 14 },
      });
      cells = [];
      var cw = 1;
      var ch = 1;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var cx = i % cols;
        var cy = Math.floor(i / cols);
        var x0 = f.X(cx + 0.08);
        var x1 = f.X(cx + 0.92);
        var y0 = f.Y(cy + 0.92);
        var y1 = f.Y(cy + 0.08);
        var shown = filter == null || r.status.indexOf(filter) >= 0;
        if (shown) cells.push({ id: r.id, x0: x0, x1: x1, y0: y0, y1: y1 });
        var hot = sel === r.id;
        var st0 = r.status[0];
        f.ctx.save();
        f.ctx.setLineDash([]);
        // the cell: stroked in the STATUS's tone — and the status WORD is
        // drawn in the cell, so colour is never the only carrier. A cell the
        // filter excludes is drawn FAINT, never removed: the grid's shape is
        // the design's shape, and a filter is a reading, not a hiding.
        var tone = { MEASURED: 'accent2', INTERPRETATION: 'dim', PROJECTION: 'accent', DECIDED: 'fg', C: 'dim' }[st0] || 'dim';
        f.ctx.strokeStyle = hot ? VIZ.token('accent') : VIZ.token(tone);
        f.ctx.lineWidth = hot ? 2.4 : 1.3;
        f.ctx.fillStyle = VIZ.token('bg');
        f.ctx.globalAlpha = shown ? 1 : 0.22;
        f.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        f.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        f.ctx.restore();
        // the id, bold
        f.textPx(r.id, (x0 + x1) / 2, y0 + 15, {
          align: 'center',
          font: '600 11px ' + MONO,
          color: hot ? VIZ.token('accent') : VIZ.token('fg'),
        });
        // the status word — the second status the doc names (a split row) is
        // shown as a count in the readout, and the first here. A NARROW cell
        // takes a fixed abbreviation, never a mid-word cut: a status truncated
        // to "INTERPRET…" is a status a reader cannot be sure of, and the whole
        // point of the grid is that the statuses differ. The readout always
        // spells the status out in full, so the abbreviation is never the only
        // form on the page.
        var stWord = WORD[st0].replace(' [C] choice', '');
        var avail = (x1 - x0) - 6;
        var full = stWord.length * 5.1; // 8.5px monospace, ~5.1px per character
        if (full > avail) stWord = ABBR[stWord] || stWord;
        f.textPx(stWord, (x0 + x1) / 2, y0 + 31, {
          align: 'center',
          font: '8.5px ' + MONO,
          color: VIZ.token(tone === 'fg' ? 'dim' : tone),
        });
      }
      f.flushLabels();

      // the readout: counts per status, always; and the selection, if any
      var c = counts();
      var parts = [VIZ.bold(rows.length + ' constraints', true), ' — by status, a split constraint counted under each it carries: '];
      var shown = 0;
      for (var s = 0; s < ORDER.length; s++) {
        var k = ORDER[s];
        parts.push(WORD[k] + ' ');
        parts.push(VIZ.bold(String(c[k] || 0), k === 'C'));
        if (s < ORDER.length - 1) parts.push(' · ');
      }
      var nShown = 0;
      for (var q2 = 0; q2 < rows.length; q2++) if (filter == null || rows[q2].status.indexOf(filter) >= 0) nShown++;
      parts.push(filter == null ? ' — every status shown.' : ' — filtered to ' + WORD[filter] + ' (' + nShown + ' of ' + rows.length + ').');
      if (sel != null) {
        var row = null;
        for (var q = 0; q < rows.length; q++) if (rows[q].id === sel) row = rows[q];
        if (row) {
          parts.push('  ‖  ');
          parts.push(VIZ.bold(row.id, true));
          parts.push(' (' + row.status.map(function (s2) { return WORD[s2]; }).join(', ') + '): ');
          parts.push(row.text);
          // the cell the doc itself splits carries its own full status text
          if (row.status.length > 1) parts.push(' — status cell, verbatim: ' + row.statusCell + '.');
        }
      } else {
        parts.push(' Click or hover a cell to read the constraint and its evidence.');
      }
      out.set(parts);
    }

    bag.onResize(draw);
    paint();
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  /** Part of the MFE contract; never invoked on a static page. */
  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
