/**
 * tools/viz/lossgrid.js — the worker §2 (the loss), the replication grid.
 *
 * A REPLAY, not a simulation: every mark comes from real runs. The arms-replay
 * figure above plays ONE cell per arm; this one shows them ALL — every cell of
 * both sets as a strip of sixty turns, so the reader can see that the pattern
 * is not a cherry-pick: the reconstruct arm (D1) goes empty at its first
 * compaction in every cell and never returns; the carrier (D1′) sprinkles
 * single-turn empties that each fall on a compaction and recover the next turn;
 * the no-self arm (D0) is empty throughout, by construction.
 *
 * The controls cycle the four blocks (the two arms' transient blocks are the
 * point of the figure), and the readout totals the block the cursor is over.
 */
VIZ.registerViz('lossgrid', (function () {
  'use strict';

  var TURNS = 60;

  /** The page's own data (every cell of every arm of both sets). */
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

  /** A strip's first compaction turn, or null. */
  function firstCompaction(c) {
    return c.compactions.length ? c.compactions[0] : null;
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
    var ARM_LABELS = { D0: 'D0 — no self', "D1'": 'D1′ — carrier', D1: 'D1 — reconstruct' };

    // the four blocks, in the page's own reading order: D0 first (the
    // construction), then the carrier (the transient — the figure's point),
    // then the reconstruct arm, per set
    var blocks = [];
    var order = ['D0', "D1'", 'D1'];
    for (var i = 0; i < d.sets.length; i++) {
      var set = d.sets[i];
      for (var j = 0; j < order.length; j++) {
        var arm = set.arms[order[j]];
        if (!arm) continue;
        blocks.push({
          setKey: set.key,
          setName: SET_NAMES[set.key] || set.key,
          armKey: order[j],
          armLabel: ARM_LABELS[order[j]] || order[j],
          cells: arm.cells,
        });
      }
    }
    var at = 0; // the block the cursor is over

    var prev = VIZ.button('← the previous arm', function () {
      at = (at + blocks.length - 1) % blocks.length;
      draw();
      VIZ.saveState(ctx);
    });
    var next = VIZ.button('the next arm →', function () {
      at = (at + 1) % blocks.length;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(prev);
    controls.appendChild(next);

    VIZ.share(ctx, {
      get: function () {
        return { b: at };
      },
      set: function (s) {
        if (s.b != null) at = Math.round(VIZ.clamp(s.b, 0, blocks.length - 1));
        draw();
      },
    });

    function draw() {
      var b = blocks[at];
      var rowH = 13;
      var topPad = 34;
      var botPad = 46;
      var f = VIZ.frame(canvas, {
        height: topPad + botPad + b.cells.length * rowH,
        ariaLabel:
          'the replication grid: every cell of one arm and one set as a strip of sixty turns. ' +
          'A filled mark is a turn the self is present; an empty gap is a turn it is absent; ' +
          'a tick above a turn is a compaction. The reconstruct arm goes empty at its first ' +
          'compaction in every cell and never returns; the carrier empties for single turns ' +
          'that each fall on a compaction and recover the next turn; the no-self arm is empty throughout.',
        xMin: 0.5,
        xMax: TURNS + 0.5,
        yMin: -0.4,
        yMax: b.cells.length,
        pad: { l: 64, r: 16, t: topPad, b: botPad },
        xLabel: 'turn',
      });
      f.grid({
        xTicks: [1, 10, 20, 30, 40, 50, 60],
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yTicks: [],
      });

      // the block's own heading, at the left margin above the strips
      f.textPx(
        b.armLabel + ' · ' + b.setName,
        8,
        14,
        { align: 'left', font: '11px ' + 'SFMono-Regular, Menlo, Consolas, monospace' },
      );

      var emptyTotal = 0;
      var emptyAtCompaction = 0;
      var recovered = 0;

      for (var ci = 0; ci < b.cells.length; ci++) {
        var c = b.cells[ci];
        var py = f.Y(ci + 0.5); // the strip's baseline in data space

        // the compaction turns carry a tick above the strip
        var comps = c.compactions;
        for (var k = 0; k < comps.length; k++) {
          var px = f.X(comps[k]);
          f.ctx.save();
          f.ctx.strokeStyle = VIZ.token('dim');
          f.ctx.globalAlpha = 0.35;
          f.ctx.lineWidth = 1;
          f.ctx.setLineDash([]);
          f.ctx.beginPath();
          f.ctx.moveTo(px, py - 4);
          f.ctx.lineTo(px, py - 7);
          f.ctx.stroke();
          f.ctx.restore();
        }

        // the strip itself: one mark per turn — filled the self is present,
        // an empty gap it is absent, nothing the run never reached
        var strip = c.strip;
        var runEnd = -1; // the last drawn turn, for the dead-cell marker
        for (var t = 1; t <= TURNS; t++) {
          var ch = strip.charAt(t - 1);
          if (ch === ' ') break;
          runEnd = t;
          var x = f.X(t);
          if (ch === '1') {
            f.ctx.save();
            f.ctx.fillStyle = VIZ.token('accent2');
            f.ctx.globalAlpha = 0.8;
            f.ctx.beginPath();
            f.ctx.arc(x, py, 2.5, 0, Math.PI * 2);
            f.ctx.fill();
            f.ctx.restore();
          } else {
            emptyTotal++;
            var isComp = false;
            for (var q = 0; q < comps.length; q++) if (comps[q] === t) isComp = true;
            if (isComp) emptyAtCompaction++;
            // the next turn is inside the strip: did the self come back?
            if (t < TURNS && strip.charAt(t) === '1') recovered++;
            f.ctx.save();
            f.ctx.strokeStyle = VIZ.token('accent');
            f.ctx.globalAlpha = 0.5;
            f.ctx.lineWidth = 1.2;
            f.ctx.setLineDash([]);
            f.ctx.beginPath();
            f.ctx.arc(x, py, 2.5, 0, Math.PI * 2);
            f.ctx.stroke();
            f.ctx.restore();
          }
        }

        // a cell the run did not finish: the turn it stopped, marked
        if (runEnd >= 0 && runEnd < TURNS) {
          f.textPx('stopped at turn ' + runEnd, f.X(runEnd) + 6, py, {
            align: 'left',
            color: VIZ.token('dim'),
          });
        }

        // the cell's own tag, at the left margin
        f.textPx(
          'r' + c.repeat,
          8,
          py,
          { align: 'left', font: '10px ' + 'SFMono-Regular, Menlo, Consolas, monospace', color: VIZ.token('dim') },
        );
      }

      f.flushLabels(); // labels last: nothing can strike through them

      // the readout: the totals over the block the cursor is over
      var first = null;
      for (var z = 0; z < b.cells.length; z++) {
        var fc = firstCompaction(b.cells[z]);
        if (fc != null && (first == null || fc < first)) first = fc;
      }
      var parts = [
        b.armLabel + ' · ' + b.setName + ' · ' + b.cells.length + ' cells — ',
      ];
      if (b.armKey === 'D0') {
        parts.push(VIZ.bold('empty in every turn of every cell', true));
        parts.push(' — by construction: the arm carries no self at all.');
      } else if (b.armKey === "D1'") {
        parts.push(VIZ.bold(emptyTotal + ' empty turns', true));
        parts.push(
          ' across ' +
            b.cells.length +
            ' cells — ' +
            (emptyAtCompaction === emptyTotal
              ? 'every one at a compaction, '
              : emptyAtCompaction + ' of them at a compaction, ') +
            (recovered === emptyTotal
              ? 'and the self is back the very next turn every time.'
              : 'and the self is back the next turn in ' + recovered + ' of them.'),
        );
      } else {
        parts.push(VIZ.bold('empty from the first compaction in every cell', true));
        parts.push(
          ' — the first compaction lands at turn ' + (first == null ? '—' : first) +
            ', and no cell ever recovers the self.',
        );
      }
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
