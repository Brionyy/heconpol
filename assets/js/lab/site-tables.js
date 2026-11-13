// 공개 표 다섯 개(구성원 · 졸업생 · 소식 · 수행연구 · 교과목)를 칸 규칙(schema/tables.json)대로 읽고 · 검사하고 · 고치는 부품(2026-10-28).
// 관리 화면(브라우저) · 가짜 서버 · 서버 도우미(supabase/functions/site-content, Deno) · 시험(node)이 같은 파일을 쓴다.
// 고치지 않은 줄은 글자 하나 바꾸지 않고 다시 쓴다(GitHub 판 기록에 고친 줄만 보이게, 줄 끝 모양 · 따옴표도 그대로).
// 바깥에 아무것도 보내지 않는다. 같은 규칙을 build.py 의 check_table_rules 가 파이썬으로 한 번 더 본다(시험이 둘을 비교).
(function (root) {
  'use strict';

  function userError(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  // ------------------------------------------------------------ CSV 읽기 · 쓰기(파이썬 csv 모듈과 같은 규칙)

  // 한 줄(record)씩 나누되, 따옴표 안의 쉼표 · 줄 바꿈은 칸 안 글자로 본다. 줄마다 원래 글자(raw)를 남긴다.
  function parse(text) {
    text = String(text);
    var bom = text.charCodeAt(0) === 0xFEFF;
    if (bom) text = text.slice(1);
    var eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    var items = [], i = 0, n = text.length;
    while (i < n) {
      var start = i, cells = [], cell = '', quoted = false, fresh = true;
      for (; i < n; i++) {
        var c = text[i];
        if (quoted) {
          if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
          else cell += c;
          continue;
        }
        if (c === '"' && fresh) { quoted = true; fresh = false; continue; }
        if (c === ',') { cells.push(cell); cell = ''; fresh = true; continue; }
        if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) break;
        cell += c; fresh = false;
      }
      cells.push(cell);
      var raw = text.slice(start, i);
      if (text[i] === '\r') i += 2; else if (text[i] === '\n') i += 1;
      items.push({ raw: raw, cells: cells, blank: cells.every(function (x) { return x.trim() === ''; }) });
    }
    var trailing = n > 0 && text[n - 1] === '\n';
    var head = items.shift() || { raw: '', cells: [] };
    return { bom: bom, eol: eol, trailing: trailing, headRaw: head.raw, header: head.cells.map(function (x) { return x.trim(); }), items: items };
  }

  function quoteCell(v) {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function serialize(doc) {
    var lines = [doc.headRaw].concat(doc.items.map(function (it) { return it.dirty ? it.cells.map(quoteCell).join(',') : it.raw; }));
    return (doc.bom ? '﻿' : '') + lines.join(doc.eol) + (doc.trailing ? doc.eol : '');
  }

  function clone(doc) {
    return { bom: doc.bom, eol: doc.eol, trailing: doc.trailing, headRaw: doc.headRaw, header: doc.header.slice(),
      items: doc.items.map(function (it) { return { raw: it.raw, cells: it.cells.slice(), blank: it.blank, dirty: it.dirty }; }) };
  }

  // 표의 줄(빈 줄은 빼고)을 { 칸 이름: 값 } 으로. 값은 앞뒤 빈칸을 뺀다(build.py read_table 과 같음).
  function dataItems(doc) { return doc.items.filter(function (it) { return !it.blank; }); }
  function toRow(doc, it) {
    var row = {};
    doc.header.forEach(function (k, j) { if (k) row[k] = (it.cells[j] || '').trim(); });
    return row;
  }
  function rows(doc) { return dataItems(doc).map(function (it) { return toRow(doc, it); }); }

  // ------------------------------------------------------------ 칸 규칙

  var DEFAULT_MAX = { text: 200, long: 3000, email: 120, https: 300, link: 300, file: 200, choice: 40, flag: 1, date: 10, year: 4, number: 6, photo: 85 };
  var CTRL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]');
  var EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
  var HTTPS = /^https:\/\/[^\s<>"'`]+$/;
  var SITE_PATH = /^\/(?!\/)[A-Za-z0-9._~\-\/#?=&%]*$/;
  var FILE = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_.\-]+)*\.md$/;

  function table(rules, name) {
    var t = rules && rules.tables && rules.tables[name];
    if (!t) throw userError('모르는 표입니다: ' + name);
    return t;
  }

  function realDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var d = new Date(v + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === v;
  }

  // 칸 하나를 본다. 틀리면 사람이 읽을 까닭을, 맞으면 null.
  function checkCell(rules, col, v) {
    v = v == null ? '' : String(v);
    if (CTRL.test(v)) return '줄 바꿈이나 보이지 않는 글자는 넣을 수 없습니다';
    if (v !== v.trim()) return '앞뒤 빈칸을 지워 주십시오';
    if (!v) return col.required ? '꼭 적어야 합니다' : null;
    var max = col.max || DEFAULT_MAX[col.kind] || 200;
    if (v.length > max) return max + '자까지 적을 수 있습니다(지금 ' + v.length + '자)';
    switch (col.kind) {
      case 'choice': return col.choices.indexOf(v) === -1 ? col.choices.join(' · ') + ' 가운데 하나를 고릅니다' : null;
      case 'flag': return v === '예' ? null : "'예' 또는 빈칸입니다";
      case 'date': return realDate(v) ? null : '2026-10-28 모양으로 적습니다';
      case 'year': return /^(19|20)\d{2}$/.test(v) ? null : '네 자리 해(예: 2026)로 적습니다';
      case 'email': return EMAIL.test(v) ? null : '메일 주소 모양이 아닙니다';
      case 'https': return HTTPS.test(v) ? null : 'https:// 로 시작하는 주소만 됩니다';
      case 'link': return HTTPS.test(v) || SITE_PATH.test(v) ? null : 'https:// 로 시작하는 주소(또는 /로 시작하는 사이트 안 주소)만 됩니다';
      case 'photo': return new RegExp(rules.photo_pattern).test(v) ? null : '사진 파일 이름은 영문 · 숫자 · _ · - 와 .jpg · .png · .webp 로 끝나야 합니다';
      case 'number': return /^[1-9][0-9]{0,5}$/.test(v) ? null : '1 이상의 숫자입니다';
      case 'file': return FILE.test(v) ? null : '글 파일 이름 모양이 아닙니다';
      default: return null;   // text, long
    }
  }

  // 표 한 줄을 본다: [{ col: 칸 이름, msg: 까닭 }]
  function checkRow(rules, name, row) {
    var t = table(rules, name), out = [];
    t.columns.forEach(function (col) {
      var msg = checkCell(rules, col, row[col.name]);
      if (msg) out.push({ col: col.name, msg: msg });
    });
    return out;
  }

  // 표 첫 줄에 규칙의 칸이 모두 있는가(없으면 저장하지 않는다. 규칙에 없는 칸은 그대로 둔다)
  function checkHeader(rules, name, doc) {
    var missing = table(rules, name).columns.map(function (c) { return c.name; })
      .filter(function (c) { return doc.header.indexOf(c) === -1; });
    return missing.length ? (table(rules, name).file + ' 첫 줄에 칸이 없습니다: ' + missing.join(', ')) : null;
  }

  // 표 전체를 본다: [{ line: 파일 몇 번째 줄, col, msg }]. 같은 번호 묶음(구성원 · 졸업생)의 번호가 겹치는지도 본다.
  function checkDocs(rules, docs) {
    var out = [], seen = {};
    Object.keys(docs).forEach(function (name) {
      var doc = docs[name], t = table(rules, name);
      var bad = checkHeader(rules, name, doc);
      if (bad) { out.push({ table: name, line: 1, col: '', msg: bad }); return; }
      // 줄 번호는 build.py 처럼 첫 줄(칸 이름)을 1로 센 기록 순서
      doc.items.forEach(function (it, k) {
        var line = k + 2;
        if (it.blank) return;
        var row = toRow(doc, it);
        checkRow(rules, name, row).forEach(function (e) { out.push({ table: name, line: line, col: e.col, msg: e.msg }); });
        t.columns.forEach(function (c) {
          if (c.kind !== 'number' || !row[c.name]) return;
          var key = (t.number_group || name) + ':' + row[c.name];
          if (seen[key]) out.push({ table: name, line: line, col: c.name, msg: '번호 ' + row[c.name] + '이(가) ' + seen[key] + '와 겹칩니다' });
          else seen[key] = t.label + ' ' + line + '번째 줄';
        });
      });
    });
    return out;
  }

  // ------------------------------------------------------------ 고치기

  function nextNumber(rules, docs, group) {
    var max = 0;
    Object.keys(rules.tables).forEach(function (name) {
      var t = rules.tables[name];
      if ((t.number_group || name) !== group || !docs[name]) return;
      rows(docs[name]).forEach(function (r) { var v = parseInt(r['번호'], 10); if (v > max) max = v; });
    });
    return String(max + 1);
  }

  function same(rules, name, a, b) {
    return table(rules, name).columns.every(function (c) { return (a[c.name] || '') === (b[c.name] || ''); });
  }

  // 화면에서 보낸 줄을 규칙대로 다듬는다: 앞뒤 빈칸, 고르기 처음 값, 메일을 숨기면 표에서 메일을 지움(공개 저장소에 남지 않게)
  function tidy(rules, name, row, old) {
    var t = table(rules, name), out = {};
    t.columns.forEach(function (c) {
      var v = c.kind === 'file' ? (old ? old[c.name] || '' : '') : row[c.name];
      v = v == null ? '' : String(v).trim();
      if (!v && c.default && c.kind === 'choice') v = c.default;
      if (c.kind === 'number' && old && old[c.name]) v = old[c.name];   // 번호는 한 번 붙으면 바꾸지 않는다(회원 계정과 잇는 값)
      out[c.name] = v;
    });
    if (out['메일 공개'] === '아니오') out['메일'] = '';
    return out;
  }

  function writeRow(doc, it, row) {
    doc.header.forEach(function (k, j) { if (k && Object.prototype.hasOwnProperty.call(row, k)) it.cells[j] = row[k]; });
    while (it.cells.length < doc.header.length) it.cells.push('');
    it.dirty = true;
    it.blank = false;
  }

  function nameOf(rules, name, row) {
    var c = table(rules, name).columns.filter(function (x) { return x.required && (x.kind === 'text' || x.kind === 'long'); })[0];
    var v = c ? row[c.name] || '' : '';
    return v.length > 40 ? v.slice(0, 40) + '…' : v;
  }

  // 고칠 것 여러 개를 한꺼번에(저장 한 번 = 판 하나). docs 는 { 표 이름: parse 결과 }, 고친 표만 새로 돌려준다.
  // change: { table, op: 'add' | 'edit' | 'remove' | 'move', index(빈 줄 뺀 몇 번째, 0부터), to(move), row(add · edit), expect(그때 본 줄) }
  // expect 가 지금 줄과 다르면 "그 사이 다른 관리자가 고쳤다"로 멈춘다.
  // 새 카드 번호(10-28 검토 3번): 한 번 쓴 번호는 다시 쓰지 않는다. opts.numbers 는 서버가 미리 내준 새 번호들(없으면 표의 가장 큰 번호 + 1).
  // 더할 때 화면이 적어 보낸 번호는 같은 저장에서 뺀 번호일 때만(졸업생으로 옮기기) 그대로 쓰고, 아니면 새 번호를 준다.
  // 돌려주는 것: { docs, notes, added: [{ table, number }], freed: [뺀 뒤 다시 쓰지 않은 번호(이어진 회원 연결을 끊을 것)] }
  function apply(rules, docs, changes, opts) {
    opts = opts || {};
    var pool = (opts.numbers || []).map(String);
    var out = {}, notes = [], freed = {}, added = [];
    function newNumber(group) { return pool.length ? pool.shift() : nextNumber(rules, Object.assign({}, docs, out), group); }
    function doc(name) {
      if (!out[name]) {
        if (!docs[name]) throw userError('표를 불러오지 못했습니다: ' + name);
        var bad = checkHeader(rules, name, docs[name]);
        if (bad) throw userError(bad);
        out[name] = clone(docs[name]);
      }
      return out[name];
    }
    function pick(d, name, ch) {
      var list = dataItems(d), it = list[ch.index];
      if (!it) throw userError('고칠 줄을 찾지 못했습니다. 화면을 새로 불러온 뒤 다시 해 주십시오.');
      if (ch.expect && !same(rules, name, toRow(d, it), ch.expect)) throw userError('그 사이 다른 관리자가 이 표를 고쳤습니다. 화면을 새로 불러온 뒤 다시 해 주십시오.');
      return it;
    }
    (changes || []).forEach(function (ch) {
      var t = table(rules, ch.table), d = doc(ch.table);
      if (ch.op === 'add') {
        var row = tidy(rules, ch.table, ch.row || {}, null);
        t.columns.forEach(function (c) {
          if (c.kind !== 'number') return;
          var given = row[c.name];
          if (given && freed[given]) { delete freed[given]; return; }
          row[c.name] = newNumber(t.number_group || ch.table);
        });
        added.push({ table: ch.table, number: row['번호'] || null });
        var it = { raw: '', cells: d.header.map(function () { return ''; }), blank: false };
        writeRow(d, it, row);
        var list = dataItems(d);
        var at = typeof ch.index === 'number' && ch.index >= 0 && ch.index < list.length ? d.items.indexOf(list[ch.index]) : -1;
        if (at === -1) {
          // 끝의 빈 줄들보다 앞에 넣는다
          var k = d.items.length;
          while (k > 0 && d.items[k - 1].blank) k--;
          d.items.splice(k, 0, it);
        } else d.items.splice(at, 0, it);
        notes.push(t.label + ' 더함: ' + nameOf(rules, ch.table, row));
      } else if (ch.op === 'edit') {
        var it2 = pick(d, ch.table, ch), old = toRow(d, it2);
        var row2 = tidy(rules, ch.table, ch.row || {}, old);
        if (same(rules, ch.table, old, row2)) return;
        writeRow(d, it2, row2);
        notes.push(t.label + ' 고침: ' + nameOf(rules, ch.table, row2));
      } else if (ch.op === 'remove') {
        var it3 = pick(d, ch.table, ch), old3 = toRow(d, it3);
        t.columns.forEach(function (c) { if (c.kind === 'number' && old3[c.name]) freed[old3[c.name]] = true; });
        d.items.splice(d.items.indexOf(it3), 1);
        notes.push(t.label + ' 뺌: ' + nameOf(rules, ch.table, old3));
      } else if (ch.op === 'move') {
        if (!t.orderable) throw userError(t.label + ' 표는 순서를 바꾸지 않습니다.');
        var it4 = pick(d, ch.table, ch), list4 = dataItems(d);
        var to = Math.max(0, Math.min(list4.length - 1, ch.to | 0));
        if (to === ch.index) return;
        var target = list4[to];
        d.items.splice(d.items.indexOf(it4), 1);
        var pos = d.items.indexOf(target);
        d.items.splice(to > ch.index ? pos + 1 : pos, 0, it4);
        notes.push(t.label + ' 순서 바꿈: ' + nameOf(rules, ch.table, toRow(d, it4)));
      } else {
        throw userError('모르는 고치기입니다: ' + ch.op);
      }
    });
    // 고친 표의 잘못 + 번호 겹침은 어느 표에서 났든(고치기 전에는 겹침이 없었으므로 이번 고침 탓)
    var errs = checkDocs(rules, Object.assign({}, docs, out)).filter(function (e) { return out[e.table] || /겹칩니다/.test(e.msg); });
    if (errs.length) {
      var e = errs[0];
      var err = userError(table(rules, e.table).label + ' ' + e.line + '번째 줄 \'' + e.col + '\': ' + e.msg);
      err.problems = errs;
      throw err;
    }
    return { docs: out, notes: notes, added: added, freed: Object.keys(freed).map(Number) };
  }

  var api = { parse: parse, serialize: serialize, rows: rows, checkCell: checkCell, checkRow: checkRow, checkHeader: checkHeader,
    checkDocs: checkDocs, apply: apply, nextNumber: nextNumber, nameOf: nameOf, quoteCell: quoteCell };
  root.LabSiteTables = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
