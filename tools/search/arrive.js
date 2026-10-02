/**
 * tools/search/arrive.js — the query a result's link carried, met on the page.
 *
 * A search result's link is /<slug>/?q=<the query>, so the piece it opens can
 * mark the words it was found by — in the page's OWN rendered prose, not in an
 * index: the words are walked out of the text nodes the reader is looking at,
 * wrapped in <mark>, scrolled to, and counted in a small dismissible bar with
 * next/previous controls. No index is needed and none is fetched: this is the
 * half of the deep-link that stands alone (the search page's snippet names the
 * passage; this is the same answer continued in the piece itself).
 *
 * The word rule is the search's own — lowercased [a-z][a-z'-]+, three
 * characters or more, stopwords aside — read off the ?q= value with the quotes
 * of a phrase left as spaces (the phrase's words are marked like any other
 * words; the ORDER was the search's demand, the marks are this page's answer
 * to "which words"). Marking walks TEXT NODES only, so no markup is broken and
 * no attribute is touched, and it stays inside the prose (headings, body and
 * the notes alike — a word the piece was found by is marked wherever the
 * piece says it).
 *
 * Rules the reader can check:
 *   - a #fragment in the URL WINS: the browser scrolls to the anchor and
 *     nothing here moves the page (the marks still land, the bar still shows);
 *   - a query whose words are not in the page SAYS SO, in the bar, rather than
 *     counting to zero silently;
 *   - Escape, the × button, or a click outside dismisses the bar (the marks
 *     stay; they are the page's own words marked, and unmarking them would
 *     pretend the piece was never found by them);
 *   - with JS off nothing happens at all — the marks and the bar are script,
 *     and the page without them is the page as built.
 *
 * The build strips comments and inlines this into every POST page (a page with
 * no prose of its own does not carry it).
 */
(function () {
  'use strict';

  var STOP = (
    'a an and are as at be been but by can could did do does for from had has have he her him his how ' +
    'if in into is it its just like may might more most no not of on one only or other our out over own ' +
    'said same she should so some such than that the their them then there these they this those to too ' +
    'two under up very was we were what when where which while who why will with without would you your'
  ).split(' ');
  var WORD = /[a-z][a-z'-]+/g;

  function wordsOf(q) {
    var raw = String(q || '').replace(/"/g, ' ').toLowerCase();
    var ws = raw.match(WORD) || [];
    var out = [], i, w;
    for (i = 0; i < ws.length; i++) {
      w = ws[i];
      if (w.length >= 3 && STOP.indexOf(w) < 0 && out.indexOf(w) < 0) out.push(w);
    }
    return out;
  }

  /** The query's own words, as a marking regex: a word is marked whole, with
   * its own suffixes (the search's snippets mark `proclus` in `proclus's`), so
   * the rule is word-start + the word + the characters a word may continue
   * with. Longest first, so `proclus` wins over `procl`. */
  function markRe(words) {
    var parts = words.slice().sort(function (a, b) { return b.length - a.length; });
    var body = '';
    for (var i = 0; i < parts.length; i++) {
      body += (i ? '|' : '') + parts[i].replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    }
    return new RegExp('\\b(?:' + body + ")[a-z'-]*", 'gi');
  }

  function boot() {
    var url = '';
    try { url = window.location.search || ''; } catch (e) { return; }
    if (!url) return;
    var q = '';
    var parts = url.replace(/^\?/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'q') { try { q = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); } catch (e) { q = kv[1] || ''; } }
    }
    if (!q) return;
    var words = wordsOf(q);
    var prose = document.querySelector('.prose');
    if (!prose) return;

    // a #fragment wins: the browser's own scroll target is the reader's, and
    // this never moves the page out from under it
    var fragment = (window.location.hash || '').length > 1;

    var marks = [];
    if (words.length) {
      var re = markRe(words);
      // text nodes collected by hand, not by a TreeWalker: the walker's filter
      // constants live on window in some engines and on document's global in
      // others, and the marks must not depend on which. Recursion into element
      // children only — a text node's own parent names whether it is markable.
      var nodes = [];
      (function collect(root) {
        for (var c = root.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) nodes.push(c);
          else if (c.nodeType === 1 && c.nodeName !== 'SCRIPT' && c.nodeName !== 'STYLE' && c.nodeName !== 'MARK') collect(c);
        }
      })(prose);
      for (var k = 0; k < nodes.length; k++) {
        var node = nodes[k];
        var text = node.nodeValue;
        if (!text || !re.test(text)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var at = 0, m;
        while ((m = re.exec(text))) {
          if (m.index > at) frag.appendChild(document.createTextNode(text.slice(at, m.index)));
          var mk = document.createElement('mark');
          mk.textContent = m[0];
          frag.appendChild(mk);
          marks.push(mk);
          at = m.index + m[0].length;
        }
        if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
      }
    }

    var bar = document.createElement('div');
    bar.className = 'qbar';
    bar.setAttribute('role', 'status');
    var said = words.length
      ? (marks.length
        ? 'found <span class="qbar-n2">' + marks.length + '</span> match' + (marks.length === 1 ? '' : 'es') +
          ' for <span class="qbar-q">' + esc(q) + '</span>'
        : 'no match for <span class="qbar-q">' + esc(q) + '</span> on this page')
      : 'nothing to mark for <span class="qbar-q">' + esc(q) + '</span>';
    var count = document.createElement('span');
    count.className = 'qbar-n';
    count.innerHTML = said;
    bar.appendChild(count);
    var pos = -1;
    var cur = document.createElement('span');
    cur.className = 'qbar-cur';
    bar.appendChild(cur);
    function paint() {
      for (var i2 = 0; i2 < marks.length; i2++) {
        if (i2 === pos) marks[i2].className = 'q-on';
        else marks[i2].removeAttribute('class');
      }
      cur.textContent = marks.length ? (pos + 1) + ' / ' + marks.length : '';
    }
    function go(d) {
      if (!marks.length) return;
      pos = pos < 0 ? (d > 0 ? 0 : marks.length - 1) : (pos + d + marks.length) % marks.length;
      paint();
      try { marks[pos].scrollIntoView({ block: 'center' }); } catch (e) { }
    }
    if (marks.length) {
      var prev = button('‹', 'previous match', function () { go(-1); });
      var next = button('›', 'next match', function () { go(1); });
      bar.appendChild(prev);
      bar.appendChild(next);
    }
    var x = button('×', 'close the match bar', function () { dismiss(); });
    bar.appendChild(x);
    document.body.appendChild(bar);
    function dismiss() {
      paintOff();
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      document.removeEventListener('keydown', onKey, true);
    }
    function paintOff() {
      for (var i3 = 0; i3 < marks.length; i3++) marks[i3].removeAttribute('class');
      cur.textContent = '';
    }
    function onKey(e) {
      if (e.key === 'Escape') { dismiss(); }
      else if (e.key === 'n' || e.key === 'N') { if (marks.length && !inField(e.target)) { e.preventDefault(); go(1); } }
      else if (e.key === 'p' || e.key === 'P') { if (marks.length && !inField(e.target)) { e.preventDefault(); go(-1); } }
    }
    function inField(t) {
      return !!(t && (t.nodeName === 'INPUT' || t.nodeName === 'TEXTAREA' || t.isContentEditable));
    }
    document.addEventListener('keydown', onKey, true);
    // arrive: the first match is scrolled to (and lit) unless the URL's own
    // fragment is the reader's destination — the fragment wins, always
    if (!fragment && marks.length) go(1);
    else if (marks.length) { pos = 0; paint(); }
  }

  function button(sym, label, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = sym;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', fn);
    return b;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  if (typeof window !== 'undefined') window.Arrive = { boot: boot };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
