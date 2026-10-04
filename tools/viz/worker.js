/**
 * tools/viz/worker.js — the arms replay (the worker §1, the mechanism figure).
 *
 * A REPLAY, not a simulation: every mark comes from real runs. Three lanes —
 * the no-self arm (D0), the carrier arm (D1′) and the reconstruct arm (D1) —
 * over the sixty turns of one measured cell each, drawn forward turn by turn.
 * The point the reader should see: the carrier arm empties for exactly one
 * turn at a compaction and is handed the derivation back; the reconstruct arm
 * goes empty at its first compaction and never returns; the no-self arm is
 * empty throughout, by construction.
 *
 * The cell each lane plays is named in the page's own data (one representative
 * per arm per set; the aggregates beside the figure say the same thing holds
 * in every cell of both sets). The slider scrubs to any turn and the readout
 * names the state of each lane's self at that turn.
 */
VIZ.registerViz('worker', (function () {
  'use strict';

  var TURNS = 60;

  /** The page's own data (one replay cell per arm, per set), or null. */
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

  /** The lane set the figure plays: the second (replication) set by default —
   * its carrier cell shows the transient best — or the first when the hash
   * asks for it. Both tell the same story; the aggregates are in the page. */
  function lanes(d, key) {
    var set = null;
    for (var i = 0; i < d.sets.length; i++) if (d.sets[i].key === key) set = d.sets[i];
    if (!set) return null;
    var order = ['D0', "D1'", 'D1'];
    var labels = { D0: 'D0 — no self', "D1'": 'D1′ — carrier', D1: 'D1 — reconstruct' };
    var out = [];
    for (var j = 0; j < order.length; j++) {
      var arm = order[j];
      var rep = set.replay[arm];
      if (!rep) return null;
      out.push({ arm: arm, label: labels[arm], turns: rep.turns });
    }
    return { key: set.key, lanes: out };
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var d = data();
    var which = d && d.sets.length > 1 ? d.sets[1].key : d && d.sets[0].key;
    var play = lanes(d, which);
    if (!play) {
      out.set(['the figure is missing its own data — every mark on it comes from real runs, and there are none to draw.']);
      return;
    }

    var turn = TURNS;

    var turnSlider = VIZ.slider({
      label: 'turn',
      min: 1,
      max: TURNS,
      step: 1,
      value: turn,
      digits: 0,
      format: function (v) {
        return VIZ.fmt(v, 0) + ' of ' + TURNS;
      },
      onInput: function (v) {
        turn = Math.round(v);
        draw();
      },
    });
    controls.appendChild(turnSlider.el);

    var loop = bag.loop(function (dt) {
      if (turn >= TURNS) {
        loop.stop();
        run.textContent = '▶ play the sixty turns';
        draw();
        VIZ.saveState(ctx);
        return;
      }
      turn = Math.min(TURNS, Math.round(turn + dt * 14 + 0.4));
      turnSlider.set(turn);
      draw();
    });

    var run = VIZ.button('▶ play the sixty turns', function () {
      if (loop.isRunning()) {
        loop.stop();
        run.textContent = '▶ resume';
        VIZ.saveState(ctx);
      } else {
        if (turn >= TURNS) turn = 1;
        run.textContent = '❚❚ pause';
        loop.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      loop.stop();
      run.textContent = '▶ play the sixty turns';
      turn = TURNS;
      turnSlider.set(turn);
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    // shareable frame: #viz=worker&t=42&s=set2 (the turn cursor and the set)
    VIZ.share(ctx, {
      get: function () {
        return { t: turnSlider.value(), s: play.key === d.sets[0].key ? 1 : 2 };
      },
      set: function (s) {
        if (s.s != null && d.sets[s.s - 1]) {
          var next = lanes(d, d.sets[s.s - 1].key);
          if (next) play = next;
        }
        if (s.t != null) {
          turn = Math.round(VIZ.clamp(s.t, 1, TURNS));
          turnSlider.set(turn);
        }
        loop.stop();
        run.textContent = '▶ play the sixty turns';
        draw();
      },
    });

    function laneState(l) {
      // the state of one lane's self at the cursor: the row the turn names,
      // with the turn BEFORE the first recorded row read as present (a D1
      // cell carries its seeded derivation before its rows begin at turn 1)
      var r = null;
      for (var i = 0; i < l.turns.length; i++) if (l.turns[i].turn === turn) r = l.turns[i];
      return {
        row: r,
        present: r ? r.present : true,
        compaction: r ? r.compaction : false,
        recon: r ? r.recon : false,
      };
    }

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 230,
        ariaLabel:
          'the arms replay: three lanes over sixty turns of real runs. The no-self arm is empty ' +
          'throughout; the carrier arm empties for exactly one turn at each compaction and is handed ' +
          'the derivation back; the reconstruct arm goes empty at its first compaction and never returns.',
        xMin: 0.5,
        xMax: TURNS + 0.5,
        yMin: -0.6,
        yMax: 1.6,
        pad: { l: 118, r: 20, t: 18, b: 42 },
        xLabel: 'turn',
      });
      f.grid({
        xTicks: [1, 10, 20, 30, 40, 50, 60],
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yTicks: [],
      });

      var mid = 0.5; // the lane baseline in data space
      for (var li = 0; li < play.lanes.length; li++) {
        var l = play.lanes[li];
        var y = mid - (li - 1) * 0.55;

        // the lane's label, at the left margin
        f.textPx(l.label, 8, f.Y(y), { align: 'left', font: '11px ' + 'SFMono-Regular, Menlo, Consolas, monospace' });

        // the run so far: one tick per turn, filled = self present,
        // hollow = empty; the compaction turns carry a mark above the lane
        for (var ti = 0; ti < l.turns.length; ti++) {
          var r = l.turns[ti];
          if (r.turn > turn) break; // not played yet
          var px = f.X(r.turn);
          var py = f.Y(y);
          if (r.compaction) {
            // the compaction mark: a tick above the lane
            f.ctx.save();
            f.ctx.strokeStyle = VIZ.token('dim');
            f.ctx.globalAlpha = 0.55;
            f.ctx.lineWidth = 1.5;
            f.ctx.setLineDash([]);
            f.ctx.beginPath();
            f.ctx.moveTo(px, py - 9);
            f.ctx.lineTo(px, py - 15);
            f.ctx.stroke();
            f.ctx.restore();
          }
          f.ctx.save();
          if (r.present) {
            f.ctx.fillStyle = VIZ.token('accent2');
            f.ctx.beginPath();
            f.ctx.arc(px, py, 3.4, 0, Math.PI * 2);
            f.ctx.fill();
          } else {
            f.ctx.strokeStyle = VIZ.token('accent');
            f.ctx.lineWidth = 1.6;
            f.ctx.fillStyle = VIZ.token('bg');
            f.ctx.beginPath();
            f.ctx.arc(px, py, 3.4, 0, Math.PI * 2);
            f.ctx.fill();
            f.ctx.stroke();
          }
          f.ctx.restore();
          if (r.recon) {
            // a reconstruction call landed on this turn: a ring around the dot
            f.ctx.save();
            f.ctx.strokeStyle = VIZ.token('accent');
            f.ctx.globalAlpha = 0.8;
            f.ctx.lineWidth = 1.2;
            f.ctx.beginPath();
            f.ctx.arc(px, py, 6.5, 0, Math.PI * 2);
            f.ctx.stroke();
            f.ctx.restore();
          }
        }
      }

      // the cursor, over every lane
      f.vline(turn, { color: VIZ.token('fg'), dash: [2, 3], alpha: 0.7 });
      f.flushLabels(); // labels last: nothing can strike through them

      // the readout: each lane's state at the cursor
      var parts = ['turn ', VIZ.bold(VIZ.fmt(turn, 0))];
      for (var i = 0; i < play.lanes.length; i++) {
        var st = laneState(play.lanes[i]);
        parts.push(' · ' + play.lanes[i].label.replace(/ —.*/, '') + ': ');
        if (st.present) parts.push(VIZ.bold('self present'));
        else parts.push(VIZ.bold('EMPTY', true));
        if (st.compaction) parts.push(' (compaction)');
        else if (st.recon) parts.push(' (reconstruction)');
      }
      parts.push(
        ' — the carrier arm loses the self for exactly one turn at a compaction and is handed the ' +
          'derivation back; the reconstruct arm goes empty at its first compaction and never returns; ' +
          'the no-self arm is empty by construction.',
      );
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
