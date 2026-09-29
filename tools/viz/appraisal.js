/**
 * tools/viz/appraisal.js — C11, "same state, two appraisals" (set-and-setting §2–§3).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. One state,
 * two readings; and the six variables the literature found predict the
 * difficulty, every one of them a framing variable. Toggle the frame and watch
 * the state not move.
 */
VIZ.registerViz('appraisal', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var READINGS = [
    { frame: 'told it is expected', read: 'breakthrough', tone: 'accent2' },
    { frame: 'told nothing, or warned against', read: 'bad trip', tone: 'accent' },
  ];

  var PREDICTORS = [
    ['no preparation', 'no frame supplied in advance'],
    ['negative mindset', 'a frame pointing the wrong way'],
    ['no support', 'no holder'],
    ['disagreeable setting', 'milieu control, inverted'],
    ['dose too large', 'the approach driven past the edge'],
    ['a life event beforehand', 'the pre-existing vulnerability'],
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var at = 0;

    var btns = READINGS.map(function (r, i) {
      var b = VIZ.button(r.frame, function () {
        at = i;
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      controls.appendChild(b);
      return b;
    });

    function paint() {
      btns.forEach(function (b, i) {
        b.style.borderColor = i === at ? VIZ.token('accent') : '';
        b.style.color = i === at ? VIZ.token('accent') : '';
      });
    }

    VIZ.share(ctx, {
      get: function () { return { frame: at }; },
      set: function (s) { if (s.frame != null) at = Math.max(0, Math.min(READINGS.length - 1, Number(s.frame) | 0)); paint(); draw(); },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 280,
        ariaLabel:
          'One state, two appraisals. The same depersonalisation-like experience is read as a breakthrough or ' +
          'as a bad trip depending only on how the person was framed for it. Below, the six variables the ' +
          'literature found predict difficulty: no preparation, negative mindset, no support, a disagreeable ' +
          'setting, too large a dose, and a major life event beforehand.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 4;

      /* the state — never moves */
      f.textPx('the state (identical)', left, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(left, top + 10, w, 24);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath(); ctx2.rect(left, top + 10, w, 24); ctx2.stroke();
      ctx2.restore();
      f.textPx('depersonalisation / derealisation — the same either way', left + 8, top + 22, { color: VIZ.token('fg') });

      /* the reading — the only thing that changes */
      f.textPx('read as', left, top + 52, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      var tone = at === 0 ? VIZ.token('accent2') : VIZ.token('accent');
      ctx2.save();
      ctx2.fillStyle = tone;
      ctx2.globalAlpha = 0.14;
      ctx2.fillRect(left, top + 62, w, 26);
      ctx2.restore();
      f.textPx('"' + READINGS[at].read + '"', left + 8, top + 75, { color: tone, font: '600 12px ' + MONO });
      f.textPx('because: ' + READINGS[at].frame, left + 140, top + 75, { color: VIZ.token('dim') });

      /* the six predictors */
      var py = top + 104;
      f.textPx('and the six predictors the literature found', left, py, {
        color: VIZ.token('dim'), font: '600 10px ' + MONO,
      });
      var rowH = 22;
      var mid = left + Math.max(180, w * 0.34);
      for (var i = 0; i < PREDICTORS.length; i++) {
        var y = py + 20 + i * rowH;
        ctx2.save();
        ctx2.fillStyle = tone;
        ctx2.fillRect(left, y - 3, 6, 6);
        ctx2.restore();
        f.textPx(PREDICTORS[i][0], left + 12, y, { color: VIZ.token('fg') });
        f.textPx(PREDICTORS[i][1], mid, y, { color: VIZ.token('dim') });
      }

      out.set([
        'the state does not move. Read as ', VIZ.bold(READINGS[at].read, true),
        ' because ', VIZ.bold(READINGS[at].frame),
        '. And the things that predict difficulty are not properties of the state \u2014 ',
        'they are all ', VIZ.bold('framing variables', true),
        ', which is what the coercion post calls levers and this literature calls risk factors',
      ]);
    }

    bag.onResize(draw);
    paint();
    draw();
  }

  function unmount(slot, ctx) { ctx.lifecycle.dispose(); }
  function update(prev, next, ctx) { unmount(prev, ctx); mount(next, ctx); }
  return { mount: mount, unmount: unmount, update: update };
})());
