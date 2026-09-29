/**
 * tools/viz/levers.js — C1, "the price of predation" (the-environment §2).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Five levers a
 * culture can pre-supply, each mapped to one task the coercion literature says a
 * group must otherwise build for itself (the coercion post: selection, isolation,
 * pace, frame, hold). Toggle the levers and the ledger moves tasks from "left to
 * build" to "already supplied".
 *
 * The number is invented for legibility and is NOT a result: core = 3 tasks the
 * environment never builds for a predator (select, pace, hold), plus one for each
 * lever still not supplied. The point is the direction and the shrinking job, not
 * the value.
 */
VIZ.registerViz('levers', (function () {
  'use strict';

  var LEVERS = [
    { key: 'agency', label: 'a cosmology of hidden agency', task: 'install the frame' },
    { key: 'rank', label: 'a ranked inner state', task: 'grant the authority' },
    { key: 'trance', label: 'a sanctioned dissociation', task: 'legitimise the state' },
    { key: 'warrant', label: 'a host-certified warrant', task: 'certify the frame' },
    { key: 'slot', label: 'an empty authority slot', task: 'build the place' },
  ];
  // what no environment builds for a predator — the irreducible work
  var CORE = ['select the person', 'set the pace', 'keep the hold'];
  var TOTAL = CORE.length + LEVERS.length;
  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var on = {}; // lever key -> supplied?
    var btns = {};

    LEVERS.forEach(function (lv) {
      var b = VIZ.button(lv.label, function () {
        on[lv.key] = !on[lv.key];
        paintButton(lv.key);
        draw();
        VIZ.saveState(ctx);
      });
      btns[lv.key] = b;
      controls.appendChild(b);
    });

    function paintButton(key) {
      var b = btns[key];
      b.style.borderColor = on[key] ? VIZ.token('accent') : '';
      b.style.color = on[key] ? VIZ.token('accent') : '';
    }

    // shareable frame: #viz=levers&levers=11001
    VIZ.share(ctx, {
      get: function () {
        return { levers: LEVERS.map(function (lv) { return on[lv.key] ? '1' : '0'; }).join('') };
      },
      set: function (s) {
        if (typeof s.levers === 'string') {
          for (var i = 0; i < LEVERS.length; i++) on[LEVERS[i].key] = s.levers.charAt(i) === '1';
        }
        LEVERS.forEach(function (lv) { paintButton(lv.key); });
        draw();
      },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 250,
        ariaLabel:
          'A ledger with two columns. On the left, what the surrounding environment already supplies; on the ' +
          'right, what the predator must still build. Toggling a lever moves one task from right to left. The ' +
          'bar beneath is the remaining work, which never reaches zero: three tasks — selection, pace and ' +
          'hold — are always built by the predator.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var supplied = LEVERS.filter(function (lv) { return on[lv.key]; });
      var toBuild = CORE.slice().concat(
        LEVERS.filter(function (lv) { return !on[lv.key]; }).map(function (lv) { return lv.task; })
      );

      var colA = f.pad.l;
      var colB = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.52;
      var top = f.pad.t + 6;
      var rowHA = 26; // the left column carries a sub-label per row
      var rowHB = 17;

      f.textPx('the environment supplies', colA, top, { color: VIZ.token('accent'), font: '600 11px ' + MONO });
      f.textPx('left to build', colB, top, { color: VIZ.token('accent2'), font: '600 11px ' + MONO });

      supplied.forEach(function (lv, i) {
        var y = top + 22 + i * rowHA;
        f.textPx('✓', colA, y, { color: VIZ.token('accent') });
        f.textPx(lv.label, colA + 16, y, { color: VIZ.token('fg') });
        f.textPx('→ ' + lv.task, colA + 16, y + 12, { color: VIZ.token('dim'), font: '10px ' + MONO });
      });
      if (!supplied.length) {
        f.textPx('nothing — the group builds all of it', colA, top + 30, { color: VIZ.token('dim') });
      }

      toBuild.forEach(function (task, i) {
        var isCore = i < CORE.length;
        var y = top + 22 + i * rowHB;
        f.textPx(isCore ? '·' : '□', colB, y, { color: isCore ? VIZ.token('dim') : VIZ.token('accent2') });
        f.textPx(task, colB + 16, y, {
          color: isCore ? VIZ.token('dim') : VIZ.token('fg'),
          font: isCore ? 'italic 11px ' + MONO : '11px ' + MONO,
        });
      });

      /* the remaining work — the bar the whole figure is about */
      var frac = toBuild.length / TOTAL;
      var by = f.h - f.pad.b + 4;
      var bw = (f.w - f.pad.l - f.pad.r) * frac;
      f.textPx('work the predator must do', f.pad.l, by - 12, { color: VIZ.token('dim') });
      // draw the bar with plain canvas primitives through the frame's ctx
      var ctx2 = canvas.getContext('2d');
      var y0 = f.h - f.pad.b + 2;
      var y1 = f.h - f.pad.b + 14;
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(f.pad.l, y0, f.w - f.pad.l - f.pad.r, y1 - y0);
      ctx2.fillStyle = frac > 0.66 ? VIZ.token('accent') : frac > 0.4 ? VIZ.token('accent2') : VIZ.token('dim');
      ctx2.fillRect(f.pad.l, y0, bw, y1 - y0);
      // outline the track so the bar reads against the page background
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(f.pad.l, y0, f.w - f.pad.l - f.pad.r, y1 - y0);
      ctx2.stroke();
      ctx2.restore();
      // drawn directly: the frame's label painter would lay an opaque patch over the bar
      ctx2.font = '600 11px ' + MONO;
      ctx2.fillStyle = '#ffffff';
      ctx2.fillText(toBuild.length + ' of ' + TOTAL, f.pad.l + 6, (y0 + y1) / 2 + 4);

      out.set([
        'the environment supplies ', VIZ.bold(supplied.length + ' of 5'),
        ' → the predator still builds ', VIZ.bold(toBuild.length + ' of ' + TOTAL, true),
        ' tasks. The ', VIZ.bold(CORE.length + ' core', true),
        ' (selection, pace, hold) never leave the ledger — the lever is the ',
        VIZ.bold('price', true), ', not the predator',
      ]);
    }

    bag.onResize(draw);
    draw();
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
