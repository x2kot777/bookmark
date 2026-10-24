// 琥太郎 3つの道具 — 画面（計算は logic.mjs、ここは表示と端末内保存だけ。通信なし）
import {
  inputModeFor, validateFields,
  FUNDS_FIELDS, FUNDS_EXAMPLE, calcFunds, fundsToProfitHandoff,
  PROFIT_FIELDS, PROFIT_EXAMPLE, validateProfit, calcProfit,
  MATCH_QUESTIONS, isMatchComplete, matchCategories, ALWAYS_UNRESEARCHED,
  RESEARCH_FIELDS, RESEARCH_STATUSES, summarizeResearch,
  sampleToFunds, sampleToProfit, applyResearchOverrides,
  formatYen, formatMan, formatPct,
} from './logic.mjs';
import { PRODUCT_CHOICES, DEFAULT_PRODUCT_ID, QUANTITY_PLANS, productFor, productChoice, fundsForProduct, profitForProduct, matchingPlan } from './beginner.mjs';

const SAMPLE_NOTE = '説明用の仮定。相場・実績ではありません。';

// ---------------------------------------------------------------------------
// 状態と端末内保存
// ---------------------------------------------------------------------------

function defaultState() {
  return {
    match: { step: 0, showResult: false, answers: { interests: [], trait: null, joy: null } },
    research: {},
    funds: fundsForProduct(DEFAULT_PRODUCT_ID),
    fundsProductId: DEFAULT_PRODUCT_ID,
    fundsPlan: 'standard',
    fundsSource: { kind: 'example', text: '' },
    profit: profitForProduct(DEFAULT_PRODUCT_ID),
    profitProductId: DEFAULT_PRODUCT_ID,
    profitSource: { kind: 'example', text: '' },
  };
}

function loadState() { return defaultState(); }
function saveState() {}
let state = loadState();

// ---------------------------------------------------------------------------
// DOM 小道具（利用者の入力は textContent でだけ表示する）
// ---------------------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (id) => document.getElementById(id);
let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

// ---------------------------------------------------------------------------
// ルーティング（#match / #funds / #profit / #receive-preview）
// ---------------------------------------------------------------------------

const VIEWS = ['home', 'funds', 'profit'];
function currentView() {
  const v = decodeURIComponent(location.hash.replace(/^#/, ''));
  return VIEWS.includes(v) ? v : 'home';
}
function route(focus = true) {
  const v = currentView();
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.dataset.view !== v;
  if (v === 'funds') renderFunds();
  if (v === 'profit') renderProfit();
  if (focus) {
    window.scrollTo(0, 0);
    const title = document.querySelector(`[data-view="${v}"] .page-title`);
    if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
  }
}
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------------------------------------------------------------------------
// ① 診断
// ---------------------------------------------------------------------------

function renderMatch() {
  const root = $('match-root');
  root.replaceChildren();
  const m = state.match;
  if (m.showResult && isMatchComplete(m.answers)) root.append(renderMatchResult());
  else { m.showResult = false; root.append(renderQuestion()); }
}

function renderQuestion() {
  const m = state.match;
  const q = MATCH_QUESTIONS[m.step];
  const total = MATCH_QUESTIONS.length;
  const bar = h('span');
  bar.style.width = `${((m.step + 1) / total) * 100}%`;
  const val = m.answers[q.key];

  const options = h('div', { class: 'options', role: 'group', 'aria-label': q.title });
  for (const o of q.options) {
    const pressed = q.type === 'single' ? val === o.id : val.includes(o.id);
    options.append(h('button', {
      type: 'button', class: 'option', 'aria-pressed': String(pressed),
      onclick: () => {
        if (q.type === 'single') {
          m.answers[q.key] = o.id;
          saveState();
          nextStep();
        } else {
          const arr = m.answers[q.key];
          m.answers[q.key] = arr.includes(o.id) ? arr.filter((x) => x !== o.id) : [...arr, o.id];
          saveState();
          renderMatch();
          document.querySelector(`#match-root .option:nth-child(${q.options.indexOf(o) + 1})`)?.focus();
        }
      },
    }, q.type === 'multi' ? h('span', { class: 'check', 'aria-hidden': 'true' }, pressed ? '✓' : '') : null,
    h('span', {}, o.label, o.help ? h('small', {}, o.help) : null)));
  }

  const canNext = q.type === 'multi' || val !== null;
  return h('div', { class: 'card' },
    h('div', { class: 'progress' }, h('span', {}, `質問 ${m.step + 1} / ${total}`), h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, bar)),
    h('h2', { class: 'q-title' }, q.title),
    h('p', { class: 'small' }, q.note),
    options,
    h('div', { class: 'btn-row' },
      m.step > 0 ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { m.step -= 1; saveState(); renderMatch(); } }, '← 戻る') : null,
      q.type === 'multi' || val !== null
        ? h('button', { type: 'button', class: 'btn', disabled: !canNext, onclick: nextStep }, m.step === total - 1 ? '候補を見る' : '次へ →')
        : null,
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: resetMatch }, '最初からやり直す'),
    ),
  );
}

function nextStep() {
  const m = state.match;
  if (m.step < MATCH_QUESTIONS.length - 1) m.step += 1;
  else m.showResult = true;
  saveState();
  renderMatch();
  $('match-title').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function resetMatch() {
  state.match = defaultState().match;
  saveState();
  renderMatch();
}

function renderMatchResult() {
  const m = state.match;
  const r = matchCategories(m.answers);
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'banner banner-warn' },
    h('strong', {}, '好みから広がる、3つのヒント'),
    h('br'),
    '興味と楽しみ方の重なりから並べた遊びのヒントです。性格適性・売れやすさは判定していません。AI 未接続、需要・競争も未調査です。'));
  wrap.append(h('h2', { class: 'page-title' }, '気になる分野をのぞいてみよう'));
  for (const c of r.candidates) wrap.append(renderCandidate(c));
  wrap.append(h('p', { class: 'small' }, '気になる例が見つかったら、②で必要な資金、③で利益の数字を試せます。実際につくる前の調査や確認は別に必要です。'));

  wrap.append(h('div', { class: 'btn-row' },
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { m.showResult = false; m.step = MATCH_QUESTIONS.length - 1; saveState(); renderMatch(); } }, '← 回答を直す'),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: resetMatch }, '最初からやり直す')));
  return wrap;
}

function renderCandidate(item) {
  const c = item.category;
  const card = h('article', { class: 'card' });
  card.append(h('h3', {}, c.name), h('p', {}, item.cue));
  card.append(h('p', { class: 'block-label' }, 'このヒントが出た理由'));
  card.append(h('ul', {}, item.reasons.map((t) => h('li', {}, t))));
  card.append(renderSampleHandoff(c));
  card.append(h('details', {},
    h('summary', {}, '本当に作るなら確認したいこと'),
    h('p', { class: 'block-label' }, 'まだ調べていないこと'),
    h('ul', {}, ALWAYS_UNRESEARCHED.map((t) => h('li', {}, t))),
    h('p', { class: 'block-label' }, '試作品・制度などの確認'),
    h('ul', {}, [...c.cautions, ...c.checks].map((t) => h('li', {}, t))),
    renderResearch(c)));
  return card;
}

function researchEntry(catId) {
  if (!state.research[catId]) state.research[catId] = {};
  return state.research[catId];
}

function researchSummaryText(catId) {
  const s = summarizeResearch(state.research[catId]);
  return `本人入力：自分で確認した ${s.self} ／ 調べ中 ${s.doing} ／ 未調査 ${s.none}（全 ${s.total} 項目）。このツールは内容を確かめていません。`;
}

function renderResearch(c) {
  const entry = researchEntry(c.id);
  const summary = h('p', { class: 'small', role: 'status' }, researchSummaryText(c.id));
  const det = h('details', {},
    h('summary', {}, '自分で調べたことを記録する（本人入力）'),
    h('p', { class: 'small' }, h('span', { class: 'pill pill-self' }, '本人入力'), ' ここに書いた内容は、上の好みから出したヒントとは別に扱います。ツールは URL を開いたり、内容を確かめたりしません。入力しても「実証済み」にはなりません。'),
    summary);
  for (const f of RESEARCH_FIELDS) {
    const cur = entry[f.key] || { value: '', status: 'none' };
    const id = nextId(`r-${c.id}-${f.key}`);
    const sid = `${id}-st`;
    const err = h('span', { class: 'error', 'aria-live': 'polite' });
    const field = h('div', { class: 'field' });
    const onValue = (e) => {
      entry[f.key] = { ...(entry[f.key] || { status: 'none' }), value: e.target.value };
      if (f.type !== 'text') {
        const v = validateFields([{ key: 'x', kind: f.type, optional: true }], { x: e.target.value });
        err.textContent = v.ok ? '' : v.errors.x;
        field.classList.toggle('has-error', !v.ok);
      }
      saveState();
      refreshHandoffButtons(c.id);
    };
    const input = f.type === 'text'
      ? h('textarea', { id, rows: '2', oninput: onValue })
      : h('input', { id, type: 'text', inputmode: inputModeFor(f.type), autocomplete: 'off', oninput: onValue });
    input.value = cur.value || '';
    const sel = h('select', {
      id: sid, 'aria-label': `${f.label} の確認状況`,
      onchange: (e) => { entry[f.key] = { ...(entry[f.key] || { value: '' }), status: e.target.value }; saveState(); summary.textContent = researchSummaryText(c.id); },
    }, RESEARCH_STATUSES.map((s) => h('option', { value: s.id }, s.label)));
    sel.value = cur.status || 'none';
    field.append(h('label', { for: id }, f.label), h('span', { class: 'help' }, f.help),
      f.type === 'text' ? input : h('div', { class: 'input-wrap' }, input, h('span', { class: 'unit' }, f.type === 'int' ? '個' : '円')),
      err);
    det.append(h('div', { class: 'research-row' }, field, h('label', { for: sid, class: 'small' }, '確認状況'), sel));
  }
  det.append(h('button', {
    type: 'button', class: 'btn btn-ghost',
    onclick: () => { delete state.research[c.id]; saveState(); renderMatch(); },
  }, 'この分野の記録を消す'));
  return det;
}

const handoffSlots = new Map();
function refreshHandoffButtons(catId) {
  const slot = handoffSlots.get(catId);
  if (slot) slot();
}

function renderSampleHandoff(c) {
  const s = c.sample;
  const box = h('div', { class: 'sample-box' },
    h('p', { class: 'block-label' }, h('span', { class: 'pill pill-sample' }, '説明用サンプル'), s.name),
    h('p', { class: 'small' }, 'この分野の例で、②③の数字を動かしてみる。金額は説明用の仮定です。'),
    h('details', {}, h('summary', {}, '例に入っている数字を見る'),
      h('p', { class: 'small' }, `製造単価 ${formatYen(s.unitCost)}・包装 ${formatYen(s.packUnit)}・初回 ${s.qty} 個・入庫物流 ${formatYen(s.inbound)}・販売価格 ${formatYen(s.price)}`),
      h('p', { class: 'small' }, `${SAMPLE_NOTE}利益が出ることを示すものではありません。`)),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-gold', onclick: () => sendSample(c, 'funds', false) }, 'この仮定で②資金を試す'),
      h('button', { type: 'button', class: 'btn btn-gold', onclick: () => sendSample(c, 'profit', false) }, 'この仮定で③利益を試す')));
  const selfRow = h('div', { class: 'btn-row' });
  const update = () => {
    const probe = applyResearchOverrides({}, state.research[c.id], 'profit');
    selfRow.replaceChildren();
    if (probe.used.length) {
      selfRow.append(
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sendSample(c, 'funds', true) }, '本人入力の数字を反映して②へ'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sendSample(c, 'profit', true) }, '本人入力の数字を反映して③へ'));
    }
  };
  handoffSlots.set(c.id, update);
  update();
  box.append(selfRow);
  return box;
}

function sendSample(c, target, useSelf) {
  const base = target === 'funds' ? sampleToFunds(c.sample) : sampleToProfit(c.sample);
  let values = base;
  let text = `①の候補「${c.name}」の説明用サンプル「${c.sample.name}」の数字を入れました。${SAMPLE_NOTE}`;
  let kind = 'sample';
  if (useSelf) {
    const r = applyResearchOverrides(base, state.research[c.id], target);
    values = r.values;
    if (r.used.length) {
      kind = 'self';
      text = `①の候補「${c.name}」から。本人入力（ツールは未検証）：${r.used.join('、')}。それ以外は説明用サンプルの数字です（${SAMPLE_NOTE}）`;
    }
  }
  if (target === 'profit') text += ' 売れた数は仕入数の半分を仮に入れています。候補から来た数字でも、利益が確実という意味ではありません。';
  state[target] = values;
  state[`${target}ProductId`] = c.id;
  if (target === 'funds') state.fundsPlan = matchingPlan(c.id, values.qty);
  state[`${target}Source`] = { kind, text };
  saveState();
  go(`#${target}`);
}

// ---------------------------------------------------------------------------
// ② / ③ 共通：入力フォーム
// ---------------------------------------------------------------------------

/**
 * groups: [{title, keys}] / fields: 定義 / raw: state 上の文字列
 * onChange(): 入力のたびに呼ばれる（結果欄だけ描き直す）
 */
function buildForm(groups, fields, raw, onChange, extras = {}) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const refs = {};
  const form = h('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() });
  const grid = h('div', { class: 'form-grid' });
  for (const g of groups) {
    grid.append(h('p', { class: 'group-title' }, g.title));
    for (const key of g.keys) {
      const f = byKey[key];
      const id = nextId(`f-${key}`);
      const err = h('span', { class: 'error', id: `${id}-err`, 'aria-live': 'polite' });
      const input = h('input', {
        id, type: 'text', inputmode: inputModeFor(f.kind), autocomplete: 'off', 'aria-describedby': `${id}-help ${id}-err`,
        oninput: (e) => { raw[key] = e.target.value; saveState(); onChange(); },
      });
      input.value = raw[key] ?? '';
      const field = h('div', { class: 'field' },
        h('label', { for: id }, f.label),
        h('span', { class: 'help', id: `${id}-help` }, f.help),
        h('div', { class: 'input-wrap' }, input, h('span', { class: 'unit' }, f.unit)),
        err);
      refs[key] = { input, err, field, label: f.label };
      grid.append(field);
      if (extras[key]) grid.append(extras[key]);
    }
  }
  form.append(grid);
  return {
    form, refs,
    showErrors(errors) {
      for (const [k, r] of Object.entries(refs)) {
        const msg = errors[k] || '';
        r.err.textContent = msg;
        r.field.classList.toggle('has-error', !!msg);
        r.input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      }
    },
  };
}

function staleBox(errors, refs) {
  const keys = Object.keys(errors);
  return h('div', { class: 'notice warn' },
    h('p', { class: 'stale-msg' }, `入力に直すところが ${keys.length} か所あります。直すと結果が出ます。前の結果は表示していません。`),
    h('ul', {}, keys.map((k) => h('li', {},
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => refs[k].input.focus() }, refs[k].label),
      ' ', errors[k]))));
}

function sourceBanner(src) {
  if (src.kind === 'example') return h('p', { class: 'banner banner-sample' }, h('strong', {}, '例の数字から始めています。'), SAMPLE_NOTE, '自由に書き換えてください。');
  if (src.kind === 'empty') return h('p', { class: 'banner banner-info' }, '空欄から始めています。0 のときは 0 を入れてください。');
  return h('p', { class: `banner ${src.kind === 'self' ? 'banner-info' : 'banner-sample'}` }, src.text);
}

function metric(label, value, note, cls = '') {
  return h('div', { class: `metric ${cls}` },
    h('div', { class: 'm-label' }, label),
    h('div', { class: `m-value ${value < 0 ? 'neg' : ''}` }, formatYen(value)),
    formatMan(value) ? h('div', { class: 'big-sub' }, formatMan(value)) : null,
    note ? h('p', { class: 'm-note' }, note) : null);
}

// ---------------------------------------------------------------------------
// ② 資金
// ---------------------------------------------------------------------------

const FUNDS_GROUPS = [
  { title: '1 回だけかかる初期費用', keys: ['prototype', 'unitCost', 'qty', 'packUnit', 'inbound', 'prep', 'ads', 'extra'] },
  { title: '予備費', keys: ['reservePct'] },
  { title: '毎月かかる費用（運転資金）', keys: ['monthlyFixed', 'months'] },
  { title: '比べる予算', keys: ['budget'] },
];

function productPicker(selectedId, onSelect) {
  const choices = PRODUCT_CHOICES.some((x) => x.id === selectedId)
    ? PRODUCT_CHOICES : [productChoice(selectedId), ...PRODUCT_CHOICES];
  return h('div', { class: 'product-choices', role: 'group', 'aria-label': '商品例を選ぶ' },
    choices.map((item) => h('button', {
      type: 'button', class: 'product-choice', 'aria-pressed': String(item.id === selectedId),
      onclick: () => onSelect(item.id),
    }, h('span', { class: 'product-icon', 'aria-hidden': 'true' }, item.icon),
    h('strong', {}, item.label))));
}

function renderFunds() {
  const root = $('funds-root');
  root.replaceChildren();
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const f = buildForm(FUNDS_GROUPS, FUNDS_FIELDS, state.funds, update);
  const budgetId = nextId('budget-simple');
  const budgetValue = h('strong', { class: 'choice-value' });
  const budgetRange = h('input', {
    id: budgetId, type: 'range', min: '0', max: '100', step: '1',
    oninput: (e) => {
      state.funds.budget = String(Number(e.target.value) * 10000);
      f.refs.budget.input.value = state.funds.budget;
      saveState(); update();
    },
  });
  const undecided = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
    state.funds.budget = state.funds.budget === '' ? FUNDS_EXAMPLE.budget : '';
    f.refs.budget.input.value = state.funds.budget;
    saveState(); update();
  } }, 'まだ決めていない');
  const planChoices = h('div', { class: 'plan-choices', role: 'group', 'aria-label': '最初につくる数量' },
    QUANTITY_PLANS.map((p) => h('button', {
      type: 'button', class: 'plan-choice', 'aria-pressed': String(state.fundsPlan === p.id),
      onclick: () => {
        state.fundsPlan = p.id;
        state.funds.qty = fundsForProduct(state.fundsProductId, p.id, state.funds.budget).qty;
        saveState(); renderFunds();
      },
    }, p.label, h('small', {}, `${fundsForProduct(state.fundsProductId, p.id, state.funds.budget).qty}個`))));
  const advanced = h('details', { class: 'advanced card' },
    h('summary', {}, '条件を見る・変える（原価や送料など）'),
    sourceBanner(state.fundsSource), f.form);
  root.append(
    h('p', { class: 'beginner-intro' }, '商品例を選ぶだけで試算できます。費用は説明用の仮定です。実際の見積や「始められる」保証ではありません。'),
    h('div', { class: 'card beginner-step' },
      h('h2', {}, '1 商品例を選ぶ'),
      productPicker(state.fundsProductId, (id) => {
        state.fundsProductId = id;
        state.fundsPlan = 'standard';
        state.funds = fundsForProduct(id, 'standard', state.funds.budget);
        state.fundsSource = { kind: 'example', text: '' };
        saveState(); renderFunds();
      }),
      h('p', { class: 'small' }, `いまの例：${productFor(state.fundsProductId).sample.name}`)),
    h('div', { class: 'card beginner-step' },
      h('h2', {}, '2 商品に使える予算'),
      h('div', { class: 'budget-head' }, h('label', { for: budgetId }, '予算を動かす'), budgetValue),
      budgetRange,
      h('div', { class: 'range-ends' }, h('span', {}, '0円'), h('span', {}, '100万円')),
      undecided,
      h('p', { class: 'small' }, '生活費を除いた金額です。未定でも必要な資金は見られます。')),
    h('div', { class: 'card beginner-step' },
      h('h2', {}, '3 最初につくる数'), planChoices,
      h('p', { class: 'small' }, '例の数量を基準に半分・同じ・2倍で試します。')),
    results,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
      state.fundsProductId = DEFAULT_PRODUCT_ID;
      state.fundsPlan = 'standard';
      state.funds = fundsForProduct(DEFAULT_PRODUCT_ID);
      state.fundsSource = { kind: 'example', text: '' };
      saveState(); renderFunds();
    } }, '例の数字に戻す')),
    advanced);

  function update() {
    const v = validateFields(FUNDS_FIELDS, state.funds);
    f.showErrors(v.errors);
    results.replaceChildren();
    const unknown = state.funds.budget === '';
    budgetRange.disabled = unknown;
    if (!unknown) budgetRange.value = String(Math.min(100, Number(state.funds.budget) / 10000));
    budgetValue.textContent = unknown ? '未定' : formatMan(Number(state.funds.budget)) || formatYen(Number(state.funds.budget));
    undecided.setAttribute('aria-pressed', String(unknown));
    planChoices.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(QUANTITY_PLANS[i].id === matchingPlan(state.fundsProductId, state.funds.qty))));
    if (!v.ok) { results.append(staleBox(v.errors, f.refs)); return; }
    const r = calcFunds(v.values);
    const bar = h('div', { class: 'bar', role: 'img', 'aria-label': '用意する合計の内訳' });
    const legend = h('ul', { class: 'legend' });
    r.breakdown.forEach((b, i) => {
      if (b.amount <= 0) return;
      const seg = h('span', { class: `c${i}` });
      seg.style.width = `${b.share * 100}%`;
      bar.append(seg);
      legend.append(h('li', {}, h('span', { class: `sw c${i}`, 'aria-hidden': 'true' }), h('span', { class: 'name' }, b.label), h('span', { class: 'amt' }, `${formatYen(b.amount)}（${formatPct(b.share)}）`)));
    });
    if (r.total === 0) legend.append(h('li', {}, 'すべて 0 円です'));

    let gap = null;
    if (r.budgetGap !== null) {
      gap = r.budgetGap >= 0
        ? h('p', { class: 'notice gap-good' }, h('strong', {}, `予算に対して ${formatYen(r.budgetGap)} の余裕`), '（使える予算 − 用意する合計）。余裕は在庫の追加や想定外に回せる分です。')
        : h('p', { class: 'notice gap-bad' }, h('strong', {}, `予算に対して ${formatYen(-r.budgetGap)} 不足`), '。数量・試作・広告の見直しか、予算の見直しが必要です。');
    }

    results.append(
      h('div', { class: 'card hero-result' },
        h('h2', {}, 'この例で用意する資金'),
        h('div', { class: 'big-number' }, formatYen(r.total)),
        gap || h('p', { class: 'notice banner-info' }, '予算は未定。必要な資金だけ見ています。'),
        h('p', { class: 'small' }, `初期費用 ${formatYen(r.initialTotal)} ＋ 売上が入る前の費用 ${formatYen(r.workingCapital)}`),
        h('button', { type: 'button', class: 'btn btn-gold', onclick: () => fundsToProfit(v.values) }, 'この数字で③利益を試す')),
      h('details', { class: 'card result-details' }, h('summary', {}, '内訳と計算に含まないものを見る'),
        bar, legend,
        h('div', { class: 'metric-grid' },
        metric('初期費用の合計', r.initialTotal, `予備費 ${formatYen(r.reserve)} を含む（予備費は初期費用 ${formatYen(r.reserveBase)} × ${v.values.reservePct}%）`),
        metric('運転資金枠', r.workingCapital, `毎月の固定費 × ${v.values.months} か月。予備費はかけず、初回の仕入れも重ねていません`)),
        h('h2', {}, '在庫は、すぐ現金に戻りません'),
        h('p', {}, `製造・包装・入庫物流の ${formatYen(r.inventoryAtCost)} は商品（在庫）に変わります。売れるまでお金は戻らず、売れ残れば戻らないこともあります。`),
        h('h3', {}, 'この合計に入っていないもの'),
        h('ul', {}, h('li', {}, '2 回目以降の再発注の費用'), h('li', {}, '税金'), h('li', {}, 'あなた自身の生活費・報酬'), h('li', {}, '販売手数料・送料などの費用と、入金待ちの立替資金（③も参照）')),
        h('p', { class: 'formula' }, '初期費用 ＝ 試作＋製造単価×数量＋包装単価×数量＋入庫物流＋撮影・販売準備＋初期広告＋追加費用＋予備費（それまでの合計×予備費率）／ 運転資金枠 ＝ 毎月の固定費×月数 ／ 用意する合計 ＝ 初期費用＋運転資金枠')));
  }
  update();
}

function fundsToProfit(values) {
  const { values: hand, inboundNote } = fundsToProfitHandoff(values);
  const next = { ...profitForProduct(state.fundsProductId), ...hand };
  const qty = Number(next.qtyPurchased);
  next.qtySold = String(Math.floor(qty / 2));
  state.profit = next;
  state.profitProductId = state.fundsProductId;
  state.profitSource = {
    kind: 'sample',
    text: `②から製造単価・包装単価・入庫物流（1 個あたり）・初回の仕入数・期間の固定費・1 回きりの費用を引き継ぎました。販売価格と売れた数は商品例の仮定です。②の初期広告予算は引き継がず、③の広告費／個と二重に数えません。${SAMPLE_NOTE}${inboundNote ? ' ' + inboundNote : ''}`,
  };
  saveState();
  go('#profit');
}

// ---------------------------------------------------------------------------
// ③ 利益
// ---------------------------------------------------------------------------

const PROFIT_GROUPS = [
  { title: '1 個の値段', keys: ['price'] },
  { title: '先に払う 1 個あたり（仕入れのときに初回数ぶん払う）', keys: ['unitCost', 'packUnit', 'inboundPerUnit'] },
  { title: '売れるたびにかかる 1 個あたり', keys: ['feePct', 'feeFixed', 'shipping', 'adPerSale', 'returnReserve'] },
  { title: '数量', keys: ['qtyPurchased', 'qtySold'] },
  { title: 'この期間の固定費と 1 回きりの費用', keys: ['periodFixed', 'oneTime'] },
];

function renderProfit() {
  const root = $('profit-root');
  root.replaceChildren();
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const priceId = nextId('price-simple');
  const price = h('input', {
    id: priceId, type: 'text', inputmode: 'decimal', autocomplete: 'off',
    'aria-label': 'いくらで売る？（1個）',
    oninput: (e) => { state.profit.price = e.target.value; f.refs.price.input.value = e.target.value; saveState(); update(); },
  });
  price.value = state.profit.price;
  const sliderId = nextId('sold-slider');
  const slider = h('input', {
    id: sliderId, type: 'range', min: '0', step: '1',
    oninput: (e) => { state.profit.qtySold = e.target.value; f.refs.qtySold.input.value = e.target.value; saveState(); update(); },
  });
  const sliderLabel = h('strong', { class: 'choice-value' });
  const f = buildForm(PROFIT_GROUPS, PROFIT_FIELDS, state.profit, update);
  const advanced = h('details', { class: 'advanced card' },
    h('summary', {}, '条件を見る・変える（原価や送料など）'),
    sourceBanner(state.profitSource), f.form);
  root.append(
    h('p', { class: 'beginner-intro' }, '商品例を選んで、売る値段と売れた数を動かすだけ。原価や手数料などは説明用の仮定です。'),
    h('div', { class: 'card beginner-step' },
      h('h2', {}, '1 商品例を選ぶ'),
      productPicker(state.profitProductId, (id) => {
        state.profitProductId = id;
        state.profit = profitForProduct(id);
        state.profitSource = { kind: 'example', text: '' };
        saveState(); renderProfit();
      }),
      h('p', { class: 'small' }, `いまの例：${productFor(state.profitProductId).sample.name}`)),
    h('div', { class: 'card beginner-step' },
      h('h2', {}, '2 いくらで売る？（1個）'),
      h('div', { class: 'input-wrap' }, price, h('span', { class: 'unit' }, '円'))),
    h('div', { class: 'card beginner-step' },
      h('div', { class: 'budget-head' }, h('label', { for: sliderId }, '3 何個売れたら？'), sliderLabel),
      slider,
      h('p', { class: 'small' }, '左で少なく、右で仕入れた数まで動かせます。')),
    results,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
      state.profitProductId = DEFAULT_PRODUCT_ID;
      state.profit = profitForProduct(DEFAULT_PRODUCT_ID);
      state.profitSource = { kind: 'example', text: '' };
      saveState(); renderProfit();
    } }, '例の数字に戻す')),
    advanced);

  function syncSlider(v) {
    const qtyOk = !v.errors.qtyPurchased;
    slider.disabled = !qtyOk;
    if (qtyOk) {
      slider.max = String(v.values.qtyPurchased);
      if (!v.errors.qtySold) slider.value = String(v.values.qtySold);
      sliderLabel.textContent = `${state.profit.qtySold || 0} 個 ／ 最大 ${v.values.qtyPurchased} 個`;
    } else sliderLabel.textContent = '仕入れた数を詳細で確認してください';
  }

  function update() {
    const v = validateProfit(state.profit);
    f.showErrors(v.errors);
    syncSlider(v);
    price.value = state.profit.price;
    results.replaceChildren();
    if (!v.ok) { results.append(staleBox(v.errors, f.refs)); return; }
    const x = v.values;
    const r = calcProfit(x);

    let be;
    if (r.breakEven.status === 'unreachable') {
      be = h('p', { class: 'notice gap-bad' }, h('strong', {}, '損益分岐：達成できません。'), `1 個売れて残る額が ${formatYen(r.unitMargin)} で、0 円以下のため、売るほど固定費を取り戻せません。価格か費用の見直しが必要です。`);
    } else if (r.breakEven.status === 'beyondStock') {
      be = h('p', { class: 'notice gap-bad' }, h('strong', {}, `損益分岐：${r.breakEven.qty.toLocaleString('ja-JP')} 個`), `。初回の仕入数 ${x.qtyPurchased.toLocaleString('ja-JP')} 個をすべて売っても届きません（この在庫の中では未達）。`);
    } else {
      be = h('p', { class: 'notice gap-good' }, h('strong', {}, `損益分岐：${r.breakEven.qty.toLocaleString('ja-JP')} 個`), `売れると、期間の固定費と 1 回きりの費用（合計 ${formatYen(r.fixedTotal)}）を取り戻せる計算です。初回の仕入数 ${x.qtyPurchased.toLocaleString('ja-JP')} 個の中に入っています。`);
    }

    results.append(
      h('div', { class: 'card hero-result' },
        h('h2', {}, 'この例で残る利益（この期間）'),
        h('div', { class: `big-number ${r.profit <= 0 ? 'neg' : ''}` }, formatYen(r.profit)),
        r.profit <= 0 ? h('p', { class: 'notice gap-bad' }, r.profit < 0 ? 'この条件では赤字です。値段や売れる数を動かしてみてください。' : 'この条件では利益は0円です。') : null,
        h('p', { class: 'small' }, '売れた分の費用と固定費・1回きりの費用を引いた試算。実際に売れる保証ではありません。')),
      h('div', { class: 'metric-grid' },
        metric('売上', r.revenue, `販売価格 × 売れた数`),
        metric('現金の増減', r.cashChange, '初回の仕入れを全数支払った後の試算。入金待ちは別'),
        h('div', { class: 'metric' },
          h('div', { class: 'm-label' }, '売れ残り'),
          h('div', { class: 'm-value' }, `${r.unsold.toLocaleString('ja-JP')} 個`),
          h('p', { class: 'm-note' }, `原価 ${formatYen(r.inventoryCost)}。この金額で売れる保証はありません。`)),
        metric('1個売れて残る額', r.unitMargin, '固定費・1回きりの費用を引く前')),
      h('details', { class: 'card result-details' }, h('summary', {}, '計算の内訳と注意を見る'),
        h('p', { class: 'small' }, `${x.qtySold.toLocaleString('ja-JP')} 個売れた（仕入 ${x.qtyPurchased.toLocaleString('ja-JP')} 個）ときの数字`),
        h('table', { class: 'unit-table' }, h('tbody', {},
          h('tr', {}, h('td', {}, '販売価格'), h('td', {}, formatYen(x.price))),
          h('tr', {}, h('td', {}, '− 先に払う1個あたり（製造＋包装＋入庫物流）'), h('td', {}, formatYen(r.L))),
          h('tr', {}, h('td', {}, '− 売れるたびの費用（手数料＋送料＋広告＋返品予備）'), h('td', {}, formatYen(r.V))),
          h('tr', { class: 'total' }, h('td', {}, '＝ 1個売れて残る額'), h('td', {}, formatYen(r.unitMargin))))),
        be,
        h('p', { class: 'formula' }, `利益 ${formatYen(r.profit)} − 現金の増減 ${formatYen(r.cashChange)} ＝ 売れ残りの原価 ${formatYen(r.inventoryCost)}`),
        h('p', { class: 'small' }, '税金・あなた自身の報酬・売れ残りの値下げや廃棄・2回目以降の仕入れは未計算です。②の初期広告予算は③へ自動で足しません。')));
  }
  update();
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

$('clear-storage').addEventListener('click', () => {
  state = defaultState();
  route(false);
  $('clear-status').textContent = '入力を消し、例の数字に戻しました。';
});
window.addEventListener('hashchange', () => route());
route(!!location.hash);
window.__kotaroReady = true;
