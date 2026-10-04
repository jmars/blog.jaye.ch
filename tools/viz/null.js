/**
 * tools/viz/null.js — the worker §5 (the honest null), the work score.
 *
 * A REPLAY, not a simulation: every dot is a measured cell's own score from
 * the sealed evaluator, outside the agent's write domain. Three arms, two
 * sets, on one 0–12 scale — and the point the figure must make is the one the
 * data makes: the reconstruct arm is the lowest in BOTH sets, and the gap is
 * not significant in either (D0 vs D1, two-sided: p = 0.105 and p = 0.348),
 * and the effect halved on replication. The mechanism is the result; the work
 * score is not the evidence, and nothing here implies the agent's work was
 * damaged.
 *
 * The control switches the set; the readout states the null either way.
 */
VIZ.registerViz('null', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';
  var MAX = 12;

  /** The page's own data (the work score rows and their stats, both sets). */
  function data() {
    var el = document.getElementById('viz-data-worker');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.sets ? d : null;
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
      out.set([
        'the figure is missing its own data — every mark on it comes from real runs, and there are none to draw.',
      ]);
      return;
    }

    var SET_NAMES = { set1: 'the deciding set', set2: 'the replication' };
    var order = ['D0', "D1'", 'D1'];
    var ARM_LABELS = { D0: 'D0 — no self', "D1'": 'D1′ — carrier', D1: 'D1 — reconstruct' };
    var TONE = { D0: 'accent2', "D1'": 'accent2', D1: 'accent' };

    var at = d.sets.length - 1; // the replication by default, like the replay

    var buttons = d.sets.map(function (s, i) {
      var b = VIZ.button(SET_NAMES[s.key] || s.key, function () {
        at = i;
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      controls.appendChild(b);
      return b;
    });

    function paint() {
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].style.borderColor = i === at ? VIZ.token('accent') : '';
        buttons[i].style.color = i === at ? VIZ.token('accent') : '';
      }
    }

    VIZ.share(ctx, {
      get: function () {
        return { s: at };
      },
      set: function (s) {
        if (s.s != null) at = Math.round(VIZ.clamp(s.s, 0, d.sets.length - 1));
        paint();
        draw();
      },
    });

    function draw() {
      var set = d.sets[at];
      var f = VIZ.frame(canvas, {
        height: 300,
        ariaLabel:
          'The honest null: the sealed evaluator\u2019s work score, three arms, one 0\u201312 scale. Every dot is ' +
          'a measured cell; the bar is the arm\u2019s mean, the whiskers its range. The reconstruct arm is the ' +
          'lowest in both sets, and the gap is not significant in either.',
        xMin: -0.4,
        xMax: order.length - 0.6,
        yMin: 0,
        yMax: MAX,
        pad: { l: 46, r: 16, t: 24, b: 46 },
        yLabel: 'work score (0\u201312)',
        xLabel: 'arm',
      });
      f.grid({
        yTicks: [0, 3, 6, 9, 12],
        xTicks: [],
      });

      var plotW = f.w - f.pad.l - f.pad.r;
      var plotH = f.h - f.pad.t - f.pad.b;
      var slot = 1;
      for (var i = 0; i < order.length; i++) {
        var arm = set.arms[order[i]];
        var stats = arm.workStats;
        var x = (i + 0.5) * slot;

        // the arm's extent, faint, behind the dots
        f.ctx.save();
        f.ctx.strokeStyle = VIZ.token('dim');
        f.ctx.globalAlpha = 0.45;
        f.ctx.lineWidth = 1;
        f.ctx.setLineDash([]);
        f.ctx.beginPath();
        f.ctx.moveTo(f.X(x), f.Y(stats.range[0]));
        f.ctx.lineTo(f.X(x), f.Y(stats.range[1]));
        f.ctx.stroke();
        f.ctx.restore();

        // every cell's own score, jittered off the arm's axis so equal
        // scores stay visible as a stack
        for (var k = 0; k < arm.work.length; k++) {
          var jx = x + (((k % 5) - 2) * 0.052);
          f.ctx.save();
          f.ctx.fillStyle = VIZ.token(TONE[order[i]]);
          f.ctx.globalAlpha = order[i] === 'D1' ? 0.85 : 0.55;
          f.ctx.beginPath();
          f.ctx.arc(f.X(jx), f.Y(arm.work[k]), 3, 0, Math.PI * 2);
          f.ctx.fill();
          f.ctx.restore();
        }

        // the mean, a bold tick through the arm
        f.hline(stats.mean, {
          from: x - 0.28,
          to: x + 0.28,
          color: VIZ.token(TONE[order[i]]),
          width: 3,
        });
        // the mean's label, beside the tick — flipped LEFT of the arm when
        // the arm is the last one, so it can never run off the right edge
        var meanAlign = i === order.length - 1 ? 'right' : 'left';
        f.textPx(
          'mean ' + VIZ.fmt(stats.mean, 2),
          f.X(x) + (meanAlign === 'right' ? -34 : 34),
          f.Y(stats.mean) - 6,
          { align: meanAlign, font: '600 10px ' + MONO, color: VIZ.token(TONE[order[i]]) },
        );

        // the arm's tag and n, at the axis — the last arm's tag flips left
        // of its centre so it stays inside the plot
        var tagX = i === order.length - 1 ? f.X(x) - 14 : f.X(x);
        f.textPx(
          ARM_LABELS[order[i]].replace(/ —.*/, ''),
          tagX,
          f.pad.t + plotH + 14,
          { align: i === order.length - 1 ? 'right' : 'center', baseline: 'top', font: '11px ' + MONO, color: VIZ.token('fg') },
        );
        f.textPx(
          'n = ' + stats.n,
          tagX,
          f.pad.t + plotH + 28,
          { align: i === order.length - 1 ? 'right' : 'center', baseline: 'top', font: '10px ' + MONO, color: VIZ.token('dim') },
        );
      }

      f.flushLabels();

      // the readout: the null, stated
      var w0 = set.arms.D0.workStats;
      var w1 = set.arms.D1.workStats;
      out.set([
        SET_NAMES[set.key] + ' \u2014 the work score does not separate the arms: ',
        VIZ.bold('D0 ' + VIZ.fmt(w0.mean, 2)),
        ' \u00b7 ',
        VIZ.bold('D1\u2032 ' + VIZ.fmt(set.arms["D1'"].workStats.mean, 2)),
        ' \u00b7 ',
        VIZ.bold('D1 ' + VIZ.fmt(w1.mean, 2), true),
        ' (means of a 0\u201312 ordinal) \u2014 D1 is the lowest of the three, and the gap is not significant ' +
          '(D0 vs D1: p = ' + VIZ.fmt(set.arms.D1.pD0D1, 3) + ', two-sided) \u2014 directional, and not claimed.',
      ]);
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
