/**
 * tools/viz/retrieval.js — the harness §11c (depletability and its control).
 *
 * THE MEASUREMENT THAT MAKES THE SELF FINITE: at a FIXED budget, growing
 * the store causes the reconstructed self to thin (priced coverage
 * 1.000 → 0.857 → 0.545 as the store grows 3 → 8 → 12 turns at B=6), while
 * the FREE-retrieval control — the same growth, retrieval priced at zero —
 * holds coverage at 1.000. That asymmetry is the evidence the mechanism is
 * real rather than a parameter: the control reproduces the pilot's
 * retention-1.000 defect (nothing was consumed, so the model's mechanism
 * was never engaged).
 *
 * Sliders grow the store and set the budget; the priced curve falls as the
 * budget binds while the control stays flat at 1.000, drawn beside it. The
 * three published points are drawn as measured markers on the priced
 * curve at B=6; every other point on the curve is the same arithmetic the
 * battery runs (min(candidates, budget) / candidates), drawn as the
 * design's own stated PROJECTION, never as a new measurement.
 */
VIZ.registerViz('retrieval', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The page's own data block (the generator's curated D2 numbers). */
  function data() {
    var el = document.getElementById('viz-data-harness');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.retrieval && d.retrieval.points && d.retrieval.points.length === 3 ? d.retrieval : null;
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
      out.set(['the figure is missing its own data — every number on it is curated from the design, and there is none to draw.']);
      return;
    }

    var B0 = d.budget; // the published demonstration's budget (6)
    var store = 12; // turns of self entries
    var budget = B0;

    var storeSlider = VIZ.slider({
      label: 'store (turns of self entries)',
      min: 1,
      max: 40,
      step: 1,
      value: store,
      digits: 0,
      onInput: function (v) {
        store = v;
        draw();
      },
    });
    controls.appendChild(storeSlider.el);
    var budgetSlider = VIZ.slider({
      label: 'per-turn budget B (derivations)',
      min: 1,
      max: 20,
      step: 1,
      value: budget,
      digits: 0,
      onInput: function (v) {
        budget = v;
        draw();
      },
    });
    controls.appendChild(budgetSlider.el);

    VIZ.share(ctx, {
      get: function () { return { n: store, b: budget }; },
      set: function (s) {
        if (s.n != null) { store = Math.max(1, Math.min(40, Number(s.n) | 0)); storeSlider.set(store); }
        if (s.b != null) { budget = Math.max(1, Math.min(20, Number(s.b) | 0)); budgetSlider.set(budget); }
        draw();
      },
    });

    /** The battery's own arithmetic (checked against the published three
     * at generation time): the candidate pool is the self entries written
     * before this turn (store − 1 candidates — each turn's key collides
     * with one seeded self key and each retrieval records an access), the
     * budget buys at most B of them, coverage is the ratio. */
    function priced(storeN, B) {
      var cand = Math.max(1, storeN - 1);
      return Math.min(cand, B) / cand;
    }

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 320,
        ariaLabel:
          'depletability, measured, with its control: at a fixed per-turn budget of B derivations, growing ' +
          'the store thins the reconstructed self — priced coverage 1.000 to 0.857 to 0.545 as the store ' +
          'grows 3 to 8 to 12 turns at B=6 — while the free-retrieval control holds coverage at 1.000 over ' +
          'the same growth. The asymmetry is the evidence the mechanism is real rather than a parameter.',
        xMin: 0,
        xMax: 41,
        yMin: 0,
        yMax: 1.05,
        pad: { l: 56, r: 24, t: 16, b: 46 },
        xLabel: 'store (turns of self entries)',
        yLabel: 'reconstruction coverage',
      });
      f.grid({ yFormat: function (v) { return v.toFixed(1); } });

      // the FREE-retrieval control: flat at 1.000 over the whole range —
      // nothing was consumed, so the model's mechanism was never engaged
      f.hline(1.0, { color: VIZ.token('accent2'), dash: [], width: 1.6 });
      f.textPx('the control: retrieval priced at ZERO — coverage 1.000 over the same growth', f.pad.l + 8, f.Y(1.0) - 9, {
        font: '9px ' + MONO,
        color: VIZ.token('accent2'),
      });

      // the priced curve: the battery's arithmetic, live under the sliders
      f.sample(function (x) { return priced(x, budget); }, {
        from: 1,
        to: 40,
        n: 160,
        color: VIZ.token('accent'),
        width: 2,
      });

      // the three PUBLISHED points, drawn as measured markers wherever the
      // budget slider sits at its published B (they ride the curve because
      // the curve IS their arithmetic); at any other budget they are not
      // drawn as measurements of this budget — the budget slider moved,
      // and the figure does not claim the battery ran at a budget it did not
      if (budget === B0) {
        for (var i = 0; i < d.points.length; i++) {
          var p = d.points[i];
          f.dot(p.store, p.coverage, { r: 4, color: VIZ.token('accent') });
          f.textPx(p.coverage.toFixed(3), f.X(p.store) + 7, f.Y(p.coverage) + (i === 0 ? 12 : -10), {
            font: '600 9px ' + MONO,
            color: VIZ.token('accent'),
          });
        }
      }

      // the reader's own point on the priced curve, at the store slider
      var here = priced(store, budget);
      f.dot(store, here, { r: 3, color: VIZ.token('fg') });
      f.vline(store, { color: VIZ.token('fg'), dash: [2, 3], alpha: 0.5 });
      f.flushLabels();

      // the readout: the reader's numbers, the published asymmetry, always
      var cand = Math.max(1, store - 1);
      var bought = Math.min(cand, budget);
      var parts = [
        'store ',
        VIZ.bold(String(store), true),
        ' at budget B=' + budget + ': the budget buys ',
        VIZ.bold(bought + ' of ' + cand, true),
        ' retrievable entries — priced coverage ',
        VIZ.bold(here.toFixed(3), true),
        '; the control beside it reads 1.000 (the same growth, priced at zero).',
      ];
      parts.push('  ‖  measured (D2, B=' + B0 + '): priced ');
      for (var j = 0; j < d.points.length; j++) {
        parts.push(VIZ.bold(d.points[j].coverage.toFixed(3), j === d.points.length - 1));
        parts.push(j < d.points.length - 1 ? ' → ' : '');
      }
      parts.push(' as the store grows 3 → 8 → 12; the control holds 1.000 — ' + d.controlReason + '. ' + d.statusNote + '.');
      out.set(parts);
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
