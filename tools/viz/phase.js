/**
 * tools/viz/phase.js — W6, the phase figure: one axis, one sign (meditation-harm §4–§5).
 *
 * A SIGN-ONLY flow picture, not a vector field. The post publishes the *form*
 * of dG/dt — a growth term that acts when attention is outward, a decay term
 * that consumes G when attention is inward, and a turnover cost — and the two
 * values the system settles at, G* = 0.886 (§3) and the collapsed 0.049 (§4).
 * It does NOT publish the equation's rate constants, nor the switch's width,
 * so none of them appears here and no curve is drawn from them: every arrow
 * says only which way G moves.
 *
 *   below the measured intensity threshold 0.5992 (§4) — attention still
 *   outward enough that the growth term wins: one attractor, at 0.886, and
 *   the flow converges there from anywhere on the axis.
 *   past it — §5's border-collision fold: the healthy branch is annihilated on
 *   contact with the switching manifold and ALL flow leads to 0.049. There is
 *   no gradual softening to draw: the branch does not wobble and tip.
 *
 * Published landmarks quoted (§4–§5):
 *   canonical a_hold = 0.9; the dose sweep 214 healthy / 98 collapsed / 0 in between
 *   intensity threshold 0.5992, duration threshold 66.3 t.u. at that intensity
 *   the last healthy solution sits at ε_c = 0.265192279 and dies *exactly on* E = Θ_eff
 *   no critical slowing: recovery rate constant at −0.0015 (spread exactly 0), 667 t.u.
 *   what shrinks is the basin of attraction — the tolerated disturbance, slope ≈ 1
 * The flow is drawn only between the two published attractors and the right edge
 * of the axis: below 0.049 the sign is not published, so no arrow claims it.
 */
VIZ.registerViz('phase', (function () {
  'use strict';

  var G_STAR = 0.886; // the healthy attractor (§3)
  var G_COL = 0.049; // the collapsed value (§4)
  var A_MIN = 0.5992; // the measured intensity threshold (§4)
  var A_CANON = 0.9; // the canonical inward drive (§4)
  var EPS_C = 0.265192279; // the last healthy solution (§5)
  var ERR_TAIL = '10⁻¹³'; // its residual on E = Θ_eff (§5)

  // The panel is laid out in fixed bands below the top pad — the lane, its
  // ticks, the axis name, the collapsed marker's note — so no two labels can
  // ever be asked for the same line, at any width. Only the free-text block at
  // the bottom flows, and it is wrapped to the canvas it is drawn on.
  var PAD = { l: 56, r: 20, t: 24, b: 14 };
  var LANE_PX = 26; // the flow lane, measured down from the top of the panel
  var NOTE_ABOVE = 16; // the healthy marker's note, above the lane
  var TICKS_DY = 13; // tick labels, below the lane
  var AXIS_DY = 34; // the axis name, below the tick labels
  var NOTE_BELOW = 54; // the collapsed marker's note, below the axis name
  var TEXT_TOP = 74; // the free-text block, below all of that
  var N_ARROWS = 9;
  var ARROW_LEN = 15; // px
  var SPEED = 0.14; // inward-drive units per second of the sweep

  // the engine's label font, repeated here so phase's own wrapping measures
  // with exactly the font it then draws in
  var FONT = '11px SFMono-Regular, Menlo, Consolas, monospace';
  var LINE_H = 15;
  var ROW_GAP = 7;

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    // a scratch 2-D context, used only to measure text before the frame is
    // sized (the panel grows to fit however many lines the width needs)
    var meas = document.createElement('canvas').getContext('2d');
    meas.font = FONT;

    /** The first of `cands` that fits `maxPx` — the marker notes shorten on a
     * narrow canvas rather than run off it (the full statement is in the text
     * block below and in the readout either way). */
    function note(cands, maxPx) {
      for (var i = 0; i < cands.length; i++) {
        if (meas.measureText(cands[i]).width <= maxPx) return cands[i];
      }
      return cands[cands.length - 1];
    }

    /** Split a string into lines that fit `maxPx` in FONT. */
    function wrapText(str, maxPx) {
      var words = String(str).split(' ');
      var lines = [];
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var t = line ? line + ' ' + words[i] : words[i];
        if (line && meas.measureText(t).width > maxPx) {
          lines.push(line);
          line = words[i];
        } else {
          line = t;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    var aSlider = VIZ.slider({
      label: 'inward drive a',
      min: 0.5,
      max: 1.0,
      step: 0.001,
      value: A_CANON,
      digits: 3,
      onInput: function () {
        sweep.stop();
        run.textContent = '▶ sweep the drive';
        draw();
      },
    });
    controls.appendChild(aSlider.el);

    var sweep = bag.loop(function (dt) {
      var a = aSlider.value() + dt * SPEED;
      if (a >= 1) {
        sweep.stop();
        run.textContent = '▶ sweep the drive';
        aSlider.set(1);
        draw();
        return;
      }
      aSlider.set(a);
      draw();
    });

    /** Sweep the drive up through the threshold: the annihilation is a switch,
     * so the reader sees the whole field flip between two frames. */
    var run = VIZ.button('▶ sweep the drive', function () {
      if (sweep.isRunning()) {
        sweep.stop();
        run.textContent = '▶ resume the sweep';
      } else {
        if (aSlider.value() >= 1) aSlider.set(0.5);
        run.textContent = '❚❚ pause';
        sweep.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      sweep.stop();
      run.textContent = '▶ sweep the drive';
      aSlider.set(A_CANON);
      draw();
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    /** One arrow of the field, in pixels, along the lane. */
    function arrowAt(c, px, dir, lane, color) {
      var half = ARROW_LEN / 2;
      var tip = px + dir * half;
      c.save();
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(px - dir * half, lane);
      c.lineTo(tip, lane);
      c.stroke();
      c.beginPath();
      c.moveTo(tip, lane);
      c.lineTo(tip - dir * 6, lane - 3.6);
      c.lineTo(tip - dir * 6, lane + 3.6);
      c.closePath();
      c.fill();
      c.restore();
    }

    /** The two published attractors, on the lane: FILLED = the fixed point the
     * flow selects at this drive; a bare ring = a published value the flow does
     * not select; with `struck`, the fixed point annihilated on contact (§5).
     * Returns the marker's x, in canvas px. */
    function attractor(f, g, lane, filled, struck) {
      var x = f.X(g);
      var c = f.ctx;
      c.save();
      c.strokeStyle = VIZ.token('accent');
      c.fillStyle = filled ? VIZ.token('accent') : VIZ.token('bg');
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(x, lane, 4.4, 0, Math.PI * 2);
      if (filled) c.fill();
      c.stroke();
      if (struck) {
        c.beginPath();
        c.moveTo(x - 5.6, lane - 5.6);
        c.lineTo(x + 5.6, lane + 5.6);
        c.moveTo(x - 5.6, lane + 5.6);
        c.lineTo(x + 5.6, lane - 5.6);
        c.stroke();
      }
      c.restore();
      return x;
    }

    function draw() {
      var a = aSlider.value();
      var armed = a >= A_MIN;
      // the canvas' own CSS width, as fitCanvas reads it — the free text is
      // wrapped to it before the frame is created, so nothing can run off it
      var avail = Math.max(240, canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 680);
      var textW = avail - PAD.l - PAD.r - 4;
      var head = wrapText(
        armed
          ? 'past the threshold: the healthy branch is annihilated — all flow → 0.049'
          : 'below the threshold: one attractor — the flow converges on G* 0.886',
        textW,
      );
      var rows = (armed
        ? [
            'the branch dies on contact: last healthy solution ε_c = ' + VIZ.fmt(EPS_C, 9),
            'it dies exactly on E = Θ_eff (residual ' + ERR_TAIL + ') — no wobble, no tip-over',
            'no slowing: recovery rate constant −0.0015, so 667 t.u. at every distance',
            'what shrinks instead is the basin — the disturbance tolerated → 0',
          ]
        : [
            'dose sweep: 214 healthy / 98 collapsed / 0 in between — no third state',
            'the threshold is sharp and bisectable: 66.3 t.u. at this intensity',
            'the published fixed points: 0.886 (healthy) and 0.049 (collapsed)',
            'growth wins at this drive: the generator is never starved',
          ]
      ).map(function (r) {
        return wrapText(r, textW);
      });
      var lines = head.length;
      for (var n = 0; n < rows.length; n++) lines += rows[n].length;
      // lane + its ticks, axis name and marker note, then the text block
      var height = PAD.t + LANE_PX + TEXT_TOP + lines * LINE_H + rows.length * ROW_GAP + PAD.b;

      var f = VIZ.frame(canvas, {
        height: height,
        ariaLabel: armed
          ? 'the flow along G with inward drive ' +
            VIZ.fmt(a, 3) +
            ' past the measured threshold 0.5992: the healthy branch at 0.886 is annihilated on contact and every arrow on the axis points to the collapsed value 0.049'
          : 'the flow along G with inward drive ' +
            VIZ.fmt(a, 3) +
            ' under the measured threshold 0.5992: one attractor, and every arrow on the axis points to the healthy 0.886',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        pad: PAD,
      });
      // the y axis is sign only, so the lane is anchored in pixels, not data
      var lane = f.pad.t + LANE_PX;
      var dim = VIZ.token('dim');

      // --- the axis itself: a single line of G, 0 → 1 ---
      var marks = VIZ.ticks(0, 1, 5);
      var c = f.ctx;
      c.save();
      c.strokeStyle = dim;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(f.X(0) - 8, lane);
      c.lineTo(f.X(1) + 8, lane);
      for (var i = 0; i < marks.length; i++) {
        var mx = Math.round(f.X(marks[i])) + 0.5;
        c.moveTo(mx, lane + 5);
        c.lineTo(mx, lane + 9);
      }
      c.stroke();
      c.restore();
      for (i = 0; i < marks.length; i++) {
        f.textPx(VIZ.fmt(marks[i], 1), f.X(marks[i]), lane + TICKS_DY, {
          align: 'center',
          baseline: 'top',
          color: dim,
        });
      }
      f.textPx('G — self-content, 0 → 1', f.X(0), lane + AXIS_DY, { color: dim, font: FONT });

      // --- the flow field: constant-length arrows, direction only ---
      var color = armed ? VIZ.token('accent') : VIZ.token('accent2');
      var lo = f.X(G_COL) + 10;
      var hi = f.X(1) + 4;
      var step = (hi - lo) / (N_ARROWS - 1);
      var span = f.X(1) - f.X(0);
      for (i = 0; i < N_ARROWS; i++) {
        var px = lo + step * i;
        // the two attractors keep their own markers — no arrow lands on one
        if (Math.abs(px - f.X(G_STAR)) < 16 || Math.abs(px - f.X(G_COL)) < 16) continue;
        var g = (px - f.X(0)) / span;
        arrowAt(c, px, armed ? -1 : g < G_STAR ? 1 : -1, lane, color);
      }

      // --- the two published attractors: filled = the one the flow selects ---
      // The notes live in their own bands — the healthy one above the lane, the
      // collapsed one below the axis name — so they can never share a line.
      var starNote = note(
        armed
          ? ['G* 0.886 — annihilated on contact', 'G* 0.886 — annihilated', 'G* 0.886 ✕']
          : ['healthy attractor G* 0.886', 'healthy G* 0.886', 'G* 0.886'],
        f.X(G_STAR) - 8 - 2,
      );
      var colNote = note(
        armed
          ? ['G 0.049 — all flow leads here', 'G 0.049 — all flow', 'G 0.049']
          : ['collapsed value G 0.049', 'collapsed G 0.049', 'G 0.049'],
        avail - (f.X(G_COL) + 9) - 2,
      );
      if (armed) {
        attractor(f, G_STAR, lane, false, true);
        f.textPx(starNote, f.X(G_STAR) - 8, lane - NOTE_ABOVE, {
          align: 'right',
          color: VIZ.token('accent'),
          font: FONT,
        });
        attractor(f, G_COL, lane, true, false);
      } else {
        attractor(f, G_STAR, lane, true, false);
        f.textPx(starNote, f.X(G_STAR) - 8, lane - NOTE_ABOVE, {
          align: 'right',
          color: VIZ.token('accent2'),
          font: FONT,
        });
        attractor(f, G_COL, lane, false, false);
      }
      f.textPx(colNote, f.X(G_COL) + 9, lane + NOTE_BELOW, {
        color: VIZ.token('accent'),
        font: FONT,
      });

      // --- the regime and what §5 measured, in words (the field is sign-only) ---
      var y = lane + TEXT_TOP;
      for (i = 0; i < head.length; i++) {
        f.textPx(head[i], f.X(0), y, { color: VIZ.token('fg'), font: FONT });
        y += LINE_H;
      }
      y += ROW_GAP;
      for (n = 0; n < rows.length; n++) {
        for (i = 0; i < rows[n].length; i++) {
          f.textPx(rows[n][i], f.X(0), y, { color: dim, font: FONT });
          y += LINE_H;
        }
        y += ROW_GAP;
      }

      f.flushLabels(); // labels last: the arrows cannot strike through them

      // every published landmark the brief names, in both states — the figure
      // states the drive's regime, never a parameter of its own
      var common = [
        '; the dose sweep found ',
        VIZ.bold('214 healthy / 98 collapsed / 0 in between'),
        ', the duration threshold is ',
        VIZ.bold('66.3 t.u.'),
        ' at that intensity, and the last healthy solution sits at ε_c = ',
        VIZ.bold('0.265192279'),
        ', dying exactly on E = Θ_eff; canonical a_hold = ',
        VIZ.bold('0.9'),
      ];
      out.set(
        (armed
          ? [
              'inward drive a = ',
              VIZ.bold(VIZ.fmt(a, 3), true),
              ' · past the measured intensity threshold ',
              VIZ.bold('0.5992'),
              ' → the healthy branch at ',
              VIZ.bold('0.886'),
              ' is annihilated on contact and ',
              VIZ.bold('all flow leads to 0.049'),
            ]
          : [
              'inward drive a = ',
              VIZ.bold(VIZ.fmt(a, 3)),
              ' · under the measured intensity threshold ',
              VIZ.bold('0.5992'),
              ' → one attractor: the flow converges on ',
              VIZ.bold('G* 0.886'),
              ' from anywhere on the axis',
            ]
        ).concat(common),
      );
    }

    bag.onResize(draw);
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
