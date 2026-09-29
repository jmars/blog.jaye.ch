/**
 * tools/viz/supplied.js — C7, "three environments, one mechanism" (the-new-jerusalem §7).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Switch between
 * the three case environments and watch the same mechanism stay put while the
 * columns move: what the environment supplies, what is left for the group to
 * build, and what that costs.
 */
VIZ.registerViz('supplied', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  // the mechanism, identical in every environment
  var MECH = 'inward practice  \u2192  the collapse state  \u2192  appraisal as attainment  \u2192  a holder on the far side';

  var ENVS = [
    {
      key: 'Brazil',
      supplies: ['the endpoint (ilumina\u00e7\u00e3o, evolu\u00eddo)', 'a ranked inner state', 'a sanctioned state', 'no safeguard'],
      builds: ['occupying the chair', 'the hold', 'the pace'],
      price: 0.22,
      note: 'cheap \u2014 the reading is pre-installed',
    },
    {
      key: 'Japan',
      supplies: ['the safeguard (maky\u014d, meditation sickness)'],
      builds: ['a counter-doctrine to override it', 'the staged path', 'the initiation apparatus', 'the appraisal'],
      price: 0.85,
      note: 'expensive \u2014 it must make the state mean the opposite',
    },
    {
      key: 'Ukraine',
      supplies: ['nothing \u2014 a vacuum', 'a resident vocabulary', 'an empty authority slot', 'hunger'],
      builds: ['the frame, from scratch', 'the technique', 'the hierarchy', 'the endpoint'],
      price: 0.30,
      note: 'cheap \u2014 no competitor, and maximum hunger',
    },
    {
      key: 'India \u2192 the West',
      supplies: ['a demand \u2014 seekers', 'a certificate \u2014 the therapy culture', 'a market'],
      builds: ['the method (the state, on a schedule)', 'the reading (\u201cno-mind\u201d)', 'the brand'],
      price: 0.12,
      note: 'cheapest to reproduce \u2014 a book, timings, a name, a reading',
    },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var at = 0;
    var btns = [];

    ENVS.forEach(function (env, i) {
      var b = VIZ.button(env.key, function () {
        at = i;
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      btns.push(b);
      controls.appendChild(b);
    });

    function paint() {
      btns.forEach(function (b, i) {
        b.style.borderColor = i === at ? VIZ.token('accent') : '';
        b.style.color = i === at ? VIZ.token('accent') : '';
      });
    }

    VIZ.share(ctx, {
      get: function () { return { env: at }; },
      set: function (s) { if (s.env != null) at = Math.max(0, Math.min(ENVS.length - 1, Number(s.env) | 0)); paint(); draw(); },
    });

    function draw() {
      var e = ENVS[at];
      var f = VIZ.frame(canvas, {
        height: 265,
        ariaLabel:
          'Four environments, one mechanism. The mechanism band, inward practice through the collapse to an ' +
          'appraisal and a holder, is identical across Brazil, Japan and Ukraine. What changes is the left column, ' +
          'what the environment already supplies, and the right column, what the group must still build \u2014 and ' +
          'with them the price: cheap in Brazil, expensive in Japan, cheap again in Ukraine.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var top = f.pad.t + 4;

      /* the mechanism band — identical for every environment */
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(f.pad.l, top, f.w - f.pad.l - f.pad.r, 20);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(f.pad.l, top, f.w - f.pad.l - f.pad.r, 20);
      ctx2.stroke();
      ctx2.restore();
      f.textPx('the mechanism \u2014 the same in all three:', f.pad.l + 6, top + 10, { color: VIZ.token('dim') });
      f.textPx(MECH, f.pad.l + 6, top + 26, { color: VIZ.token('fg'), font: '10px ' + MONO });

      /* the two columns */
      var colTop = top + 44;
      var mid = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.46;
      f.textPx('the environment supplies', f.pad.l, colTop, { color: VIZ.token('accent2'), font: '600 11px ' + MONO });
      f.textPx('the group must build', mid + 12, colTop, { color: VIZ.token('accent'), font: '600 11px ' + MONO });

      var rowH = 17;
      e.supplies.forEach(function (s, i) {
        var y = colTop + 22 + i * rowH;
        ctx2.save();
        ctx2.fillStyle = VIZ.token('accent2');
        ctx2.fillRect(f.pad.l, y - 4, 6, 6);
        ctx2.restore();
        f.textPx(s, f.pad.l + 12, y, { color: VIZ.token('fg') });
      });
      e.builds.forEach(function (s, i) {
        var y = colTop + 22 + i * rowH;
        ctx2.save();
        ctx2.strokeStyle = VIZ.token('accent');
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.rect(mid + 12, y - 5, 7, 7);
        ctx2.stroke();
        ctx2.restore();
        f.textPx(s, mid + 26, y, { color: VIZ.token('fg') });
      });

      /* the price bar — the finding */
      var by = f.h - f.pad.b - 4;
      var bw = f.w - f.pad.l - f.pad.r;
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(f.pad.l, by - 12, bw, 14);
      ctx2.fillStyle = e.price > 0.6 ? VIZ.token('accent') : VIZ.token('accent2');
      ctx2.fillRect(f.pad.l, by - 12, bw * e.price, 14);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(f.pad.l, by - 12, bw, 14);
      ctx2.stroke();
      ctx2.restore();
      f.textPx('the price of the move', f.pad.l, by - 22, { color: VIZ.token('dim') });
      f.textPx(e.note, f.pad.l + bw * e.price + 8 > f.w - 60 ? f.pad.l + 6 : f.pad.l + bw * e.price + 8, by - 5, {
        color: e.price > 0.6 ? VIZ.token('accent') : VIZ.token('accent2'),
      });

      out.set([
        e.key, ': the environment supplies ', VIZ.bold(String(e.supplies.length)),
        ' of the levers; the group still builds ', VIZ.bold(String(e.builds.length), true),
        '. The mechanism band never moves \u2014 ', VIZ.bold('what changes is the price', true),
        ', not the mechanism',
      ]);
    }

    bag.onResize(draw);
    paint();
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
