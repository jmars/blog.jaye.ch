/**
 * tools/viz/costume.js — A? , "the costume comes off" (the-costume §2–§4).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Toggle the
 * costume off and watch which levers survive: four of the five are indifferent to
 * whether they wear a cosmology, because they are POSITIONS. The fifth — the
 * sanctioned dissociation — has no secular instance, and that is the point: it
 * belongs to the mechanism, not to the costume.
 */
VIZ.registerViz('costume', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  // name — the invariant. mystical / secular — the costume.
  var LEVERS = [
    {
      name: 'a hidden membership',
      mystical: 'the initiated; the elect',
      secular: 'a roster kept off the rolls',
    },
    {
      name: 'a ranked inner state',
      mystical: 'evolu\u00eddo; iluminado',
      secular: 'an A/B/C grade on the list',
    },
    {
      name: 'an unfalsifiable claim',
      mystical: 'karma; hidden entities',
      secular: '"improper influence," unprovable',
    },
    {
      name: 'a borrowed warrant',
      mystical: "the tradition's authority",
      secular: "the state's, or the market's",
    },
    {
      name: 'a sanctioned dissociation',
      mystical: 'the trance; no-mind',
      secular: null, // no secular instance — it is the mechanism's own
    },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var dressed = true; // start costumed

    var toggle = VIZ.button('', function () {
      dressed = !dressed;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(toggle);
    function label() {
      toggle.textContent = dressed ? 'costume: on (mystical) \u2192 take it off' : 'costume: off (secular) \u2192 put it back';
    }

    VIZ.share(ctx, {
      get: function () { return { dressed: dressed ? 1 : 0 }; },
      set: function (s) { dressed = !!Number(s.dressed); draw(); },
    });

    function draw() {
      label();
      var f = VIZ.frame(canvas, {
        height: 268,
        ariaLabel:
          'Five levers, as a list. With the costume on, each lever shows a mystical instance. With the costume ' +
          'off, four of the five still show a secular instance \u2014 hidden membership, a graded status, an ' +
          'unfalsifiable claim, a borrowed warrant. The fifth, a sanctioned dissociation, has no secular ' +
          'instance: it is the mechanism\u2019s own, not the costume\u2019s.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var mid = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.50; // clear of the longest lever name
      var top = f.pad.t + 4;
      var rowH = 44;

      f.textPx('the lever (invariant)', left, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx(dressed ? 'its mystical costume' : 'its secular instance', mid, top,
        { color: VIZ.token('accent'), font: '600 10px ' + MONO });

      ctx2.save();
      ctx2.strokeStyle = VIZ.token('line');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(mid - 14, top + 8);
      ctx2.lineTo(mid - 14, top + 18 + LEVERS.length * rowH);
      ctx2.stroke();
      ctx2.restore();

      var survived = 0;
      for (var i = 0; i < LEVERS.length; i++) {
        var L = LEVERS[i];
        var y = top + 30 + i * rowH;
        var instance = dressed ? L.mystical : L.secular;
        var has = instance != null;
        if (has) survived++;

        // the lever name — always present, always the same
        f.textPx(L.name, left, y, { color: VIZ.token('fg') });

        // the costume — present or (for the mechanism-bound lever) gone
        ctx2.save();
        ctx2.fillStyle = has ? VIZ.token('accent') : VIZ.token('dim');
        ctx2.fillRect(mid - 8, y - 2, 6, 5);
        ctx2.restore();

        if (has) {
          f.textPx(instance, mid + 8, y, { color: VIZ.token('accent') });
        } else {
          f.textPx(instance === null ? 'none \u2014 this one is the mechanism\u2019s own'
            : '\u2014', mid + 8, y, { color: VIZ.token('dim') });
        }
        // a hairline between rows
        ctx2.save();
        ctx2.strokeStyle = VIZ.token('line');
        ctx2.globalAlpha = 0.5;
        ctx2.beginPath();
        ctx2.moveTo(left, y + 18);
        ctx2.lineTo(f.w - f.pad.r, y + 18);
        ctx2.stroke();
        ctx2.restore();
      }

      out.set(
        dressed
          ? [
              'costume on: five levers, five mystical instances \u2014 the readings the case studies found in ',
              'Brazil, Japan, Ukraine and India. The lever and the costume look like one thing',
            ]
          : [
              'costume off: ', VIZ.bold(survived + ' of ' + LEVERS.length + ' levers remain', true),
              ' with no mysticism at all \u2014 they are ', VIZ.bold('positions', true),
              ', not beliefs. The fifth, a sanctioned dissociation, has no secular instance: it belongs to ',
              'the mechanism, which is exactly what makes the levers predatory rather than merely powerful',
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
