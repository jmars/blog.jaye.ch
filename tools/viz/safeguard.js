/**
 * tools/viz/safeguard.js — C6, "the map and the frame" (the-empty-vessel §3–§5).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. The same four
 * meditative states, routed two ways: by the tradition's map (makyō, meditation
 * sickness) and by a group's owned frame. The states do not change. The routing
 * is the variable — and that is what "who supplies the frame" means.
 */
VIZ.registerViz('safeguard', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var STATES = [
    'a beautiful vision',
    'a blank, trance-like absorption',
    'terror, or numbness',
    'a doubt about the teacher',
  ];
  var TRADITION = [
    'not the goal — open your eyes',
    'a stage of practice; do not cling to it',
    'meditation sickness — stop, and see a master',
    'ask it — the check stays outside him',
  ];
  var FRAME = [
    'you are advancing',
    'deeper — go on',
    'your resistance, or an enemy at work',
    'the ego — or an enemy\u2019s influence',
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var owned = true; // start on the group's frame — the case under study

    var toggle = VIZ.button('', function () {
      owned = !owned;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(toggle);
    function label() {
      toggle.textContent = owned ? 'map: the guru\u2019s frame →' : 'map: the tradition →';
    }

    VIZ.share(ctx, {
      get: function () { return { owned: owned ? 1 : 0 }; },
      set: function (s) { owned = !!Number(s.owned); draw(); },
    });

    function draw() {
      label();
      var route = owned ? FRAME : TRADITION;
      var accent = owned ? VIZ.token('accent') : VIZ.token('accent2');

      var f = VIZ.frame(canvas, {
        height: 260,
        ariaLabel:
          'Four meditative states, routed two ways. Under the tradition\u2019s map, a vision is not the goal, a ' +
          'blank trance is a stage not to cling to, terror is meditation sickness to be treated with a master\u2019s ' +
          'help, and a doubt about the teacher may be asked. Under the guru\u2019s frame, the same four states are ' +
          'advancement, deeper practice, an enemy, and the ego.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var mid = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.34;
      var top = f.pad.t + 8;
      var rowH = 34;

      /* the column heads, and the divider: one variable, two routings */
      f.textPx('the state', left, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx(owned ? 'the guru\u2019s frame routes it' : 'the tradition\u2019s map routes it',
        mid, top, { color: accent, font: '600 10px ' + MONO });

      ctx2.save();
      ctx2.strokeStyle = VIZ.token('line');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(mid - 12, top + 8);
      ctx2.lineTo(mid - 12, top + 12 + STATES.length * rowH);
      ctx2.stroke();
      ctx2.restore();

      for (var i = 0; i < STATES.length; i++) {
        var y = top + 34 + i * rowH;
        f.textPx(STATES[i], left, y, { color: VIZ.token('fg') });
        // a small arrow marker, so the routing reads directionally
        ctx2.save();
        ctx2.fillStyle = accent;
        ctx2.fillRect(mid - 6, y - 2, 7, 5);
        ctx2.restore();
        f.textPx(route[i], mid + 10, y, { color: accent });
      }

      // the box around the routed column, so the "one variable" is visible
      ctx2.save();
      ctx2.strokeStyle = accent;
      ctx2.lineWidth = 1;
      ctx2.globalAlpha = 0.5;
      ctx2.beginPath();
      ctx2.rect(mid - 20, top + 20, f.w - f.pad.r - (mid - 20), 12 + STATES.length * rowH);
      ctx2.stroke();
      ctx2.restore();

      // the footnote of the figure: what the two maps share, and what differs
      f.textPx(
        owned
          ? 'the same four states \u2014 relabelled: every one now confirms the frame'
          : 'the same four states \u2014 and none of them is allowed to mean "the goal"',
        left, f.h - f.pad.b + 2, { color: VIZ.token('dim') });

      out.set(
        owned
          ? [
              'the guru\u2019s frame: every state ', VIZ.bold('confirms it', true),
              ' \u2014 a vision is progress, a trance is deeper, terror is an enemy, and doubt is the ego. ',
              'There is no result at which the practice is wrong, because the frame owns the reading',
            ]
          : [
              'the tradition\u2019s map: ', VIZ.bold('maky\u014d', true),
              ' \u2014 the vision is not the goal, the trance is not to be clung to, terror is ',
              VIZ.bold('meditation sickness', true),
              ' to be treated, and a doubt about the teacher may be asked. The map is the safeguard the ',
              'frame replaces',
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
