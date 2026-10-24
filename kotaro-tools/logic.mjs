// 琥太郎 LINE 特典 3 ツール — 計算と好み探索の純関数（DOM・保存・通信なし）
// ブラウザ（dist/app.js）と node:test（tests/）の両方から import する。

// ---------------------------------------------------------------------------
// 入力の読み取り
// ---------------------------------------------------------------------------

export const LIMITS = {
  money: 10_000_000_000, // 100 億円
  int: 1_000_000, // 100 万個
  pct: 100,
  months: 60,
};

const FULLWIDTH = /[０-９．，－ー−]/g;
const FW_MAP = { '．': '.', '，': ',', '－': '-', 'ー': '-', '−': '-' };

function normalizeNumberText(raw) {
  return String(raw ?? '')
    .replace(FULLWIDTH, (c) => FW_MAP[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,\s円個%％]/g, '')
    .trim();
}

/** kind: 'money' | 'int' | 'pct' | 'months' */
export function inputModeFor(kind) {
  return kind === 'int' || kind === 'months' ? 'numeric' : 'decimal';
}

/**
 * 1 欄を読む。成功 {ok:true, value, empty} / 失敗 {ok:false, error}
 * def: { kind, optional?, max? }
 */
export function parseField(raw, def) {
  const s = normalizeNumberText(raw);
  if (s === '') {
    if (def.optional) return { ok: true, value: def.nullIfEmpty ? null : 0, empty: true };
    return { ok: false, error: '未入力です。0 のときは 0 を入れてください' };
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, error: '数字で入力してください' };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: '数字で入力してください' };
  if (v < 0) return { ok: false, error: 'マイナスは入れられません' };
  if ((def.kind === 'int' || def.kind === 'months') && !Number.isInteger(v)) {
    return { ok: false, error: def.kind === 'months' ? '月数は整数で入力してください' : '個数は整数で入力してください' };
  }
  const max = def.max ?? LIMITS[def.kind];
  if (def.kind === 'pct' && v > max) return { ok: false, error: `0〜${max} の範囲で入力してください` };
  if (v > max) return { ok: false, error: `大きすぎます（上限 ${max.toLocaleString('ja-JP')}）` };
  return { ok: true, value: v === 0 ? 0 : v, empty: false };
}

/** fields: [{key, kind, optional?}] → {ok, values, errors} */
export function validateFields(fields, raw) {
  const values = {};
  const errors = {};
  for (const f of fields) {
    const r = parseField(raw?.[f.key], f);
    if (r.ok) values[f.key] = r.value;
    else errors[f.key] = r.error;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

// ---------------------------------------------------------------------------
// ② 商品づくり資金シミュレーター
// ---------------------------------------------------------------------------

export const FUNDS_FIELDS = [
  { key: 'prototype', label: '試作費', unit: '円', kind: 'money', help: 'サンプル取り寄せ・試作品づくりにかかるお金' },
  { key: 'unitCost', label: '製造単価', unit: '円/個', kind: 'money', help: '工場に払う 1 個あたりの代金' },
  { key: 'qty', label: '初回の数量', unit: '個', kind: 'int', help: '最初に作る（仕入れる）個数' },
  { key: 'packUnit', label: '包装単価', unit: '円/個', kind: 'money', help: '箱・袋・ラベルなど 1 個あたり' },
  { key: 'inbound', label: '入庫物流費（初回分の合計）', unit: '円', kind: 'money', help: '工場から倉庫・自宅へ運ぶ送料など' },
  { key: 'prep', label: '撮影・販売準備費', unit: '円', kind: 'money', help: '商品写真・説明文・販売ページの準備' },
  { key: 'ads', label: '初期広告予算', unit: '円', kind: 'money', help: '売り始めに使うと決めた広告費の枠' },
  { key: 'extra', label: '追加費用（任意）', unit: '円', kind: 'money', optional: true, help: '検品・認証取得など、上にない 1 回きりの費用' },
  { key: 'reservePct', label: '予備費率', unit: '%', kind: 'pct', help: '想定外に備える上乗せ。上の初期費用の合計にかける' },
  { key: 'monthlyFixed', label: '毎月の継続固定費', unit: '円/月', kind: 'money', help: 'ツール代・倉庫代など、売れても売れなくても毎月かかる費用' },
  { key: 'months', label: '運転資金の月数', unit: 'か月', kind: 'months', help: '売上が入る前に何か月分の固定費を用意しておくか' },
  { key: 'budget', label: '使える予算（任意）', unit: '円', kind: 'money', optional: true, nullIfEmpty: true, help: '生活費を除いて、商品に回せるお金。入れると不足・余裕が出ます' },
];

/** 説明用の仮定（相場・実績ではない） */
export const FUNDS_EXAMPLE = {
  prototype: '30000', unitCost: '600', qty: '200', packUnit: '50', inbound: '15000',
  prep: '20000', ads: '30000', extra: '', reservePct: '10', monthlyFixed: '5000', months: '3', budget: '300000',
};

/** values は validateFields 済みの数値。途中で丸めない */
export function calcFunds(v) {
  const manufacturing = v.unitCost * v.qty;
  const packaging = v.packUnit * v.qty;
  const items = [
    { key: 'prototype', label: '試作', amount: v.prototype },
    { key: 'manufacturing', label: '製造（初回仕入）', amount: manufacturing },
    { key: 'packaging', label: '包装', amount: packaging },
    { key: 'inbound', label: '入庫物流', amount: v.inbound },
    { key: 'prep', label: '撮影・販売準備', amount: v.prep },
    { key: 'ads', label: '初期広告', amount: v.ads },
    { key: 'extra', label: '追加費用', amount: v.extra ?? 0 },
  ];
  const reserveBase = items.reduce((s, i) => s + i.amount, 0);
  const reserve = reserveBase * (v.reservePct / 100);
  const initialTotal = reserveBase + reserve;
  const workingCapital = v.monthlyFixed * v.months; // 予備費率はかけない・初回仕入も重ねない
  const total = initialTotal + workingCapital;
  const breakdown = [
    ...items,
    { key: 'reserve', label: '予備費', amount: reserve },
    { key: 'working', label: '運転資金枠', amount: workingCapital },
  ].map((i) => ({ ...i, share: total > 0 ? i.amount / total : 0 }));
  const budgetGap = v.budget === null || v.budget === undefined ? null : v.budget - total; // 正 = 余裕 / 負 = 不足
  return {
    manufacturing, packaging, reserveBase, reserve, initialTotal, workingCapital, total,
    inventoryAtCost: manufacturing + packaging + v.inbound, // 在庫として寝るお金（すぐ現金にならない）
    breakdown, budgetGap,
  };
}

/** ② → ③ の引き継ぎ値（文字列。③の入力欄にそのまま入る）。初期広告は広告/個へ入れない */
export function fundsToProfitHandoff(v) {
  let inboundPerUnit = '0';
  let inboundNote = '';
  if (v.qty > 0) {
    inboundPerUnit = String(v.inbound / v.qty); // ツール間でも途中丸めをしない
  } else if (v.inbound > 0) {
    inboundNote = '初回の数量が 0 のため、入庫物流の 1 個あたりは 0 円で入れました。必要なら直してください。';
  }
  return {
    values: {
      unitCost: String(v.unitCost),
      packUnit: String(v.packUnit),
      inboundPerUnit,
      qtyPurchased: String(v.qty),
      periodFixed: String(v.monthlyFixed * v.months),
      oneTime: String(v.prototype + v.prep + (v.extra ?? 0)),
    },
    inboundNote,
  };
}

// ---------------------------------------------------------------------------
// ③ 利益まる見えシミュレーター
// ---------------------------------------------------------------------------

export const PROFIT_FIELDS = [
  { key: 'price', label: '販売価格', unit: '円', kind: 'money', help: 'お客さんが払う 1 個の値段' },
  { key: 'unitCost', label: '製造単価', unit: '円/個', kind: 'money', help: '工場に払う 1 個あたりの代金' },
  { key: 'packUnit', label: '包装単価', unit: '円/個', kind: 'money', help: '箱・袋・ラベルなど' },
  { key: 'inboundPerUnit', label: '入庫物流（1 個あたり）', unit: '円/個', kind: 'money', help: '工場→倉庫の送料を 1 個あたりに割った額' },
  { key: 'feePct', label: '販売手数料率', unit: '%', kind: 'pct', help: '販売先に払う、売上に対する割合' },
  { key: 'feeFixed', label: '1 注文の固定手数料', unit: '円', kind: 'money', help: '1 注文ごとに定額でかかる手数料（1 注文 1 個の前提）' },
  { key: 'shipping', label: 'お客さんへの送料', unit: '円/個', kind: 'money', help: '売れた 1 個を届ける送料' },
  { key: 'adPerSale', label: '広告費（売れた 1 個あたり）', unit: '円/個', kind: 'money', help: '1 個売るのにかかった広告費の平均' },
  { key: 'returnReserve', label: '返品などの予備', unit: '円/個', kind: 'money', help: '返品・破損の想定支出。販売数ぶん実際に支払う仮定で計算' },
  { key: 'qtyPurchased', label: '初回の仕入数', unit: '個', kind: 'int', help: '先に作って（仕入れて）お金を払う個数' },
  { key: 'qtySold', label: '売れた数', unit: '個', kind: 'int', help: '期間中に売れた個数（仕入数まで）' },
  { key: 'periodFixed', label: '期間の固定費', unit: '円', kind: 'money', help: 'この期間にかかるツール代・倉庫代など' },
  { key: 'oneTime', label: '試作など 1 回きりの費用', unit: '円', kind: 'money', help: '試作・撮影など。ここで 1 回だけ数えます' },
];

export const PROFIT_EXAMPLE = {
  price: '2980', unitCost: '600', packUnit: '50', inboundPerUnit: '75', feePct: '15', feeFixed: '0',
  shipping: '450', adPerSale: '200', returnReserve: '50', qtyPurchased: '200', qtySold: '120',
  periodFixed: '15000', oneTime: '50000',
};

/** 欄ごとの検査 + 売れた数 ≤ 仕入数 */
export function validateProfit(raw) {
  const r = validateFields(PROFIT_FIELDS, raw);
  if (!r.errors.qtySold && !r.errors.qtyPurchased && r.values.qtySold > r.values.qtyPurchased) {
    r.errors.qtySold = `売れた数が初回の仕入数（${r.values.qtyPurchased} 個）を超えています。在庫にない分は売れません`;
    r.ok = false;
  }
  return r;
}

export function calcProfit(v) {
  const L = v.unitCost + v.packUnit + v.inboundPerUnit; // 先に初回数ぶん払う 1 個あたり
  const V = v.price * (v.feePct / 100) + v.feeFixed + v.shipping + v.adPerSale + v.returnReserve; // 売れるたびに出る
  const revenue = v.price * v.qtySold;
  const unitMargin = v.price - L - V;
  const fixedTotal = v.periodFixed + v.oneTime;
  const profit = revenue - (L + V) * v.qtySold - fixedTotal;
  const cashChange = revenue - L * v.qtyPurchased - V * v.qtySold - fixedTotal;
  const unsold = v.qtyPurchased - v.qtySold;
  const inventoryCost = L * unsold;
  const marginRate = revenue > 0 ? profit / revenue : null;
  return {
    L, V, revenue, unitMargin, fixedTotal, profit, cashChange, unsold, inventoryCost, marginRate,
    breakEven: breakEven(fixedTotal, unitMargin, v.qtyPurchased),
  };
}

/** status: 'unreachable'（単位利益 ≤ 0）| 'withinStock' | 'beyondStock' */
export function breakEven(fixedTotal, unitMargin, qtyPurchased) {
  if (!(unitMargin > 0)) return { status: 'unreachable', qty: null };
  const ratio = fixedTotal / unitMargin;
  // 浮動小数の誤差（例 1000/0.1 = 10000.000000000002）で 1 個多くならないようにする
  const qty = Math.max(0, Math.ceil(ratio - Number.EPSILON * 4 * Math.max(1, ratio)));
  return { status: qty <= qtyPurchased ? 'withinStock' : 'beyondStock', qty };
}

// ---------------------------------------------------------------------------
// ① 好みから見つける商品カテゴリー（AI 未接続）
// ---------------------------------------------------------------------------

export const BUDGET_LEVELS = [
  { id: 1, label: '10 万円未満' },
  { id: 2, label: '10〜30 万円' },
  { id: 3, label: '30〜100 万円' },
  { id: 4, label: '100 万円以上' },
];
export const HOURS_LEVELS = [
  { id: 1, label: '週 3 時間未満' },
  { id: 2, label: '週 3〜7 時間' },
  { id: 3, label: '週 7〜15 時間' },
  { id: 4, label: '週 15 時間以上' },
];
export const STORAGE_LEVELS = [
  { id: 1, label: '棚 1 段ぶんくらい', help: '小さな箱がいくつか置ける' },
  { id: 2, label: '部屋の一角（段ボール 5〜10 箱）', help: '' },
  { id: 3, label: '倉庫や外部の保管サービスを使う前提', help: '大きい物・量が多くても置ける' },
];
export const INTERESTS = [
  { id: 'living', label: '収納・生活雑貨' },
  { id: 'pet', label: 'ペット' },
  { id: 'outdoor', label: 'アウトドア・スポーツ' },
  { id: 'fashion', label: 'ファッション小物' },
  { id: 'stationery', label: '文具・ホビー' },
  { id: 'beautytool', label: '美容まわりの道具' },
  { id: 'cosmetic', label: '化粧品・スキンケア' },
  { id: 'food', label: '食品・飲み物' },
  { id: 'gadget', label: 'ガジェット・電気小物' },
  { id: 'kids', label: 'ベビー・キッズ' },
  { id: 'interior', label: 'インテリア・家具' },
];
export const AVOIDS = [
  { id: 'food', label: '食品・口に入る物', help: '食品衛生などの確認が要る' },
  { id: 'cosmetic', label: '化粧品・肌に塗る物', help: '化粧品の制度の確認が要る' },
  { id: 'electric', label: '電気製品・電池入り', help: '電気の安全基準の確認が要る' },
  { id: 'kids', label: '子ども向け', help: '安全基準・表示の確認が要る' },
  { id: 'fragile', label: '割れ物', help: '梱包・破損の手間' },
  { id: 'bulky', label: '大きい・重い物', help: '送料・保管が重い' },
];

export const TRAITS = [
  { id: 'notice', label: '小さな不便に気づく', help: '「ここ、少し変えたい」が目に入る' },
  { id: 'style', label: '見た目や雰囲気を考える', help: '色や形の違いを楽しめる' },
  { id: 'try', label: '使って違いを試す', help: '手に取って比べたくなる' },
  { id: 'listen', label: '人の「困った」を聞く', help: '誰かの話から発想が広がる' },
];
export const JOYS = [
  { id: 'ease', label: '毎日が少し楽になる' },
  { id: 'delight', label: '使うたび気分が上がる' },
  { id: 'share', label: '誰かと楽しめる' },
  { id: 'discover', label: '新しい体験が広がる' },
];
export const MATCH_QUESTIONS = [
  { key: 'interests', type: 'multi', title: 'つい見てしまうものは？', note: '好きなものをいくつでも。まだ分からなければ選ばず進めます。', options: INTERESTS },
  { key: 'trait', type: 'single', title: 'どんなとき「自分らしい」と感じる？', note: '深く考えず、今の気分でひとつ選んでください。', options: TRAITS },
  { key: 'joy', type: 'single', title: 'つくったものが届いたら、何がうれしい？', note: '正解はありません。いちばん心が動くものをひとつ。', options: JOYS },
];

/**
 * flags: このカテゴリーが当てはまる「避けたい扱い」
 * minBudget / minHours / storage: 条件ルール（レベル id 以上が必要）
 * 旧試作の条件メタデータは表示や選定には使わない。需要・競争の情報ではない。
 */
export const CATEGORIES = [
  {
    id: 'living', name: '収納・生活雑貨', interest: 'living', flags: [],
    minBudget: 1, minHours: 1, storage: 2,
    fit: '小さめ・軽めの物が多く、少ない数から始めやすい分野', cautions: ['似た商品が多くなりやすく、違いの出し方を考える必要がある'],
    checks: ['サンプルで寸法・素材・耐久を確かめる', '食器や調理道具など口に触れる物にするなら、食品に触れる器具の基準の対象か確認する'],
    sample: { name: '引き出し用の仕切りケース（説明用）', unitCost: 400, packUnit: 40, qty: 200, inbound: 12000, price: 1980 },
  },
  {
    id: 'pet', name: 'ペット用品（フード以外）', interest: 'pet', flags: [],
    minBudget: 1, minHours: 2, storage: 2,
    fit: 'お散歩グッズ・お手入れ道具など、食べ物以外なら食品の確認を避けられる', cautions: ['動物がかじる・なめる物は素材の安全確認が増える', '犬猫などで寸法の種類が増えやすい'],
    checks: ['サンプルで縫製・金具・素材を確かめる', 'かじる物・口に入る物にするなら素材と基準を確認する'],
    sample: { name: 'お散歩用ポーチ（説明用）', unitCost: 550, packUnit: 40, qty: 150, inbound: 12000, price: 2480 },
  },
  {
    id: 'outdoor', name: 'アウトドア・スポーツ小物', interest: 'outdoor', flags: [],
    minBudget: 2, minHours: 2, storage: 2,
    fit: '使う場面がはっきりしていて、写真や説明で良さを伝えやすい', cautions: ['季節で動きが変わりやすい', 'かさばる物は保管と送料が増える'],
    checks: ['実際の使用場面で試作品を試す', '強度・耐荷重などを表示するなら根拠を確認する'],
    sample: { name: '折りたたみの小物収納バッグ（説明用）', unitCost: 900, packUnit: 60, qty: 150, inbound: 18000, price: 3480 },
  },
  {
    id: 'fashion', name: 'ファッション小物', interest: 'fashion', flags: [],
    minBudget: 1, minHours: 2, storage: 1,
    fit: '小さく軽い物が多く、棚 1 段でも置きやすい', cautions: ['好みが分かれ、色・サイズの種類が増えやすい', '金属は肌に触れるため素材の確認が要る'],
    checks: ['色ごとのサンプルで見た目と質感を確かめる', '金属アレルギー表示など素材の説明を確認する'],
    sample: { name: '布製のミニポーチ（説明用）', unitCost: 350, packUnit: 30, qty: 200, inbound: 8000, price: 1680 },
  },
  {
    id: 'stationery', name: '文具・ホビー', interest: 'stationery', flags: [],
    minBudget: 1, minHours: 1, storage: 1,
    fit: '小さく軽く、少ない数で試しやすい', cautions: ['単価が低めになりやすく、送料と手数料の割合が大きくなりがち'],
    checks: ['サンプルで書き味・使い心地を確かめる', '子どもが使う想定にするなら子ども向けの安全基準も確認する'],
    sample: { name: 'ペンケース型の文具収納（説明用）', unitCost: 300, packUnit: 30, qty: 200, inbound: 8000, price: 1480 },
  },
  {
    id: 'beautytool', name: '美容まわりの道具（化粧品そのものは除く）', interest: 'beautytool', flags: [],
    minBudget: 1, minHours: 2, storage: 1,
    fit: 'ブラシ・ポーチ・収納など道具なら、化粧品の制度とは別に考えやすい', cautions: ['表示や広告表現は商品分類と内容に応じて確認が必要', '肌に触れる道具は素材の確認が要る'],
    checks: ['サンプルで肌ざわり・耐久を確かめる', '説明文で効果をうたわない書き方を確認する'],
    sample: { name: 'メイクブラシ収納ケース（説明用）', unitCost: 450, packUnit: 40, qty: 200, inbound: 10000, price: 1980 },
  },
  {
    id: 'cosmetic', name: '化粧品・スキンケア', interest: 'cosmetic', flags: ['cosmetic'],
    minBudget: 3, minHours: 3, storage: 2,
    fit: '使用感・成分・表示内容を調査する前提の候補です', cautions: ['製造・販売に必要な許可や届出の確認が要る', '成分表示や広告表現の決まりが多い'],
    checks: ['委託先の工場が必要な許可を持っているか確認する', '表示・広告表現の決まりを確認する', '試作品で使用感・安定性を確かめる'],
    sample: { name: 'ハンドクリーム（説明用）', unitCost: 500, packUnit: 80, qty: 300, inbound: 15000, price: 2480 },
  },
  {
    id: 'food', name: '食品・飲み物', interest: 'food', flags: ['food'],
    minBudget: 3, minHours: 3, storage: 2,
    fit: '保存条件・賞味期限・表示内容を調査する前提の候補です', cautions: ['賞味期限があり、売れ残りが損になりやすい', '温度管理が要る物は保管・配送が難しい'],
    checks: ['製造・販売に必要な許可と表示の決まりを確認する', '賞味期限と保管温度を確認する', '試作品で味・日持ちを確かめる'],
    sample: { name: '個包装のお茶（説明用）', unitCost: 300, packUnit: 60, qty: 300, inbound: 15000, price: 1680 },
  },
  {
    id: 'gadget', name: 'ガジェット・電気小物', interest: 'gadget', flags: ['electric'],
    minBudget: 3, minHours: 2, storage: 1,
    fit: '小さい物が多く、機能で違いを説明しやすい', cautions: ['電気の安全基準（例: PSE）や電池の扱いの確認が要る', '不良・初期故障の対応が発生しやすい'],
    checks: ['電気の安全基準の対象か、必要な検査・表示を確認する', 'リチウム電池入りなら配送の制限を確認する', '試作品で動作・発熱を確かめる'],
    sample: { name: 'ケーブル収納ポーチ付き充電スタンド（説明用）', unitCost: 1200, packUnit: 80, qty: 150, inbound: 15000, price: 3980 },
  },
  {
    id: 'kids', name: 'ベビー・キッズ用品', interest: 'kids', flags: ['kids'],
    minBudget: 2, minHours: 3, storage: 2,
    fit: '使う場面がはっきりしていて、選ぶ理由を伝えやすい', cautions: ['子ども向けの安全基準や年齢表示の確認が要る', '小さな部品・口に入る物はより慎重な確認が要る'],
    checks: ['子ども向けの安全基準（例: 玩具の安全基準）の対象か確認する', '対象年齢・注意表示を確認する', '試作品で角・部品・素材を確かめる'],
    sample: { name: '布製のおでかけ用収納（説明用）', unitCost: 700, packUnit: 50, qty: 150, inbound: 12000, price: 2780 },
  },
  {
    id: 'interior', name: 'インテリア・家具', interest: 'interior', flags: ['bulky', 'fragile'],
    minBudget: 3, minHours: 2, storage: 3,
    fit: '見た目で選ばれやすく、写真で伝えやすい', cautions: ['大きい・重い物は保管と送料が重い', '割れ物は梱包と破損対応の手間がある'],
    checks: ['梱包状態で落下・破損を確かめる', '送料（サイズ・重さ）を見積もる', '組み立て品は説明書と部品を確認する'],
    sample: { name: '木製の卓上ラック（説明用）', unitCost: 1500, packUnit: 150, qty: 100, inbound: 30000, price: 4980 },
  },
];

const INTEREST_LABEL = Object.fromEntries(INTERESTS.map((x) => [x.id, x.label]));
const TRAIT_LABEL = Object.fromEntries(TRAITS.map((x) => [x.id, x.label]));
const JOY_LABEL = Object.fromEntries(JOYS.map((x) => [x.id, x.label]));
const CATEGORY_VIBES = {
  living: { traits: ['notice', 'listen'], joys: ['ease'], cue: '暮らしの小さな不便から、使いやすい形を想像できるかも。' },
  pet: { traits: ['listen', 'try'], joys: ['share', 'ease'], cue: '動物と過ごす時間の「もう少し」を見つけられるかも。' },
  outdoor: { traits: ['try', 'notice'], joys: ['discover'], cue: '外で使ってみたい道具を思い浮かべられるかも。' },
  fashion: { traits: ['style', 'try'], joys: ['delight'], cue: '身につけたくなる色や形を考えるのが楽しいかも。' },
  stationery: { traits: ['notice', 'style'], joys: ['ease', 'delight'], cue: '毎日使う小物に、自分らしい工夫を足せるかも。' },
  beautytool: { traits: ['style', 'try'], joys: ['delight', 'ease'], cue: '支度の時間を楽しくする道具を想像できるかも。' },
  cosmetic: { traits: ['style', 'try'], joys: ['delight'], cue: '使うときの気分や手ざわりに目を向けられるかも。' },
  food: { traits: ['try', 'listen'], joys: ['share', 'discover'], cue: '誰かと味わいたい時間から発想できるかも。' },
  gadget: { traits: ['try', 'notice'], joys: ['ease', 'discover'], cue: '使ってみて分かる小さな便利さが気になるかも。' },
  kids: { traits: ['listen', 'notice'], joys: ['share', 'ease'], cue: '親子の毎日にある「あったらいいな」を拾えるかも。' },
  interior: { traits: ['style', 'notice'], joys: ['delight', 'ease'], cue: '部屋の空気が変わる形や素材を考えられるかも。' },
};

/** 好みを答えたか。興味は未選択でも進められる。 */
export function isMatchComplete(a) {
  return Array.isArray(a?.interests) && a.interests.every((x) => x in INTEREST_LABEL)
    && a?.trait in TRAIT_LABEL && a?.joy in JOY_LABEL;
}

/** 興味・楽しみ方が重なった分野を3つ示す遊びのヒント。適性・需要の判定ではない。 */
export function matchCategories(a) {
  if (!isMatchComplete(a)) throw new Error('回答が揃っていません');
  const interests = new Set(a.interests);
  const ranked = CATEGORIES.map((category, order) => {
    const vibe = CATEGORY_VIBES[category.id];
    const chosenInterest = interests.has(category.interest);
    const traitOverlap = vibe.traits.includes(a.trait);
    const joyOverlap = vibe.joys.includes(a.joy);
    const reasons = [];
    if (chosenInterest) reasons.push(`好きなものに「${INTEREST_LABEL[category.interest]}」を選んだ`);
    if (traitOverlap) reasons.push(`「${TRAIT_LABEL[a.trait]}」という楽しみ方と接点がある`);
    if (joyOverlap) reasons.push(`「${JOY_LABEL[a.joy]}」という気持ちとつながる`);
    if (!reasons.length) reasons.push('まだ選んでいない分野にも、面白い発見があるかも');
    return { category, reasons, cue: vibe.cue, rank: (chosenInterest ? 4 : 0) + (traitOverlap ? 2 : 0) + (joyOverlap ? 1 : 0), order };
  });
  ranked.sort((x, y) => y.rank - x.rank || x.order - y.order);
  return { candidates: ranked.slice(0, 3).map(({ rank, order, ...item }) => item) };
}

/** どの候補でも必ず未調査として出す項目（このツールは調べていない） */
export const ALWAYS_UNRESEARCHED = [
  '需要（実際に探している人がいるか）',
  '競争（似た商品の数・価格・評価）',
  '仕入先の見積と最小発注量',
  '販売先の手数料・出品ルール',
];

/** 調査欄の項目。値は本人入力として扱い、ツールは検証しない */
export const RESEARCH_FIELDS = [
  { key: 'demand', label: '需要の根拠', type: 'text', help: '参照した URL や、自分で見た・聞いたこと（ツールは開いて確かめません）' },
  { key: 'competitorPrice', label: '似た商品の価格', type: 'money', help: '見つけた似た商品の販売価格（円）' },
  { key: 'quoteUnit', label: '見積もりの製造単価', type: 'money', help: '仕入先から出た 1 個あたりの見積（円）' },
  { key: 'moq', label: '最小発注量', type: 'int', help: '仕入先が受けてくれる最小の個数' },
  { key: 'sampleCheck', label: '試作品の確認', type: 'text', help: '取り寄せた・触った・気になった点など' },
  { key: 'ruleCheck', label: '規制・表示の確認', type: 'text', help: '調べた制度・問い合わせ先・結論など' },
];
export const RESEARCH_STATUSES = [
  { id: 'none', label: '未調査' },
  { id: 'doing', label: '調べ中' },
  { id: 'self', label: '自分で確認した（本人入力）' },
];

/** 調査欄の集計。「実証済み」は返さない（ツールは確かめていない） */
export function summarizeResearch(entry) {
  const counts = { none: 0, doing: 0, self: 0 };
  for (const f of RESEARCH_FIELDS) {
    const st = entry?.[f.key]?.status;
    counts[RESEARCH_STATUSES.some((s) => s.id === st) ? st : 'none'] += 1;
  }
  return { ...counts, total: RESEARCH_FIELDS.length, verifiedByTool: false };
}

/** 説明用サンプル → ② の入力（文字列） */
export function sampleToFunds(sample) {
  return {
    ...FUNDS_EXAMPLE,
    unitCost: String(sample.unitCost), packUnit: String(sample.packUnit), qty: String(sample.qty), inbound: String(sample.inbound),
  };
}

/** 説明用サンプル → ③ の入力（文字列）。売れた数は仕入数の半分（仮定） */
export function sampleToProfit(sample) {
  const perUnit = sample.inbound / sample.qty;
  return {
    ...PROFIT_EXAMPLE,
    price: String(sample.price), unitCost: String(sample.unitCost), packUnit: String(sample.packUnit),
    inboundPerUnit: String(perUnit), qtyPurchased: String(sample.qty), qtySold: String(Math.floor(sample.qty / 2)),
  };
}

/**
 * 本人入力の調査値（見積単価・最小発注量・似た商品の価格）を上書きした入力を返す。
 * 入っていない項目は base のまま。どれが本人入力かを used に返す。
 */
export function applyResearchOverrides(base, entry, target) {
  const out = { ...base };
  const used = [];
  const num = (key, kind) => {
    const r = parseField(entry?.[key]?.value, { kind, optional: true });
    return r.ok && !r.empty ? r.value : null;
  };
  const quote = num('quoteUnit', 'money');
  const moq = num('moq', 'int');
  const comp = num('competitorPrice', 'money');
  if (quote !== null) { out.unitCost = String(quote); used.push('見積もりの製造単価'); }
  if (moq !== null) { out[target === 'funds' ? 'qty' : 'qtyPurchased'] = String(moq); used.push('最小発注量 → 初回の数量'); }
  if (target === 'profit') {
    if (comp !== null) { out.price = String(comp); used.push('似た商品の価格 → 販売価格'); }
    const p = parseField(out.qtyPurchased, { kind: 'int' });
    const s = parseField(out.qtySold, { kind: 'int' });
    if (p.ok && s.ok && s.value > p.value) out.qtySold = String(p.value);
  }
  return { values: out, used };
}

// ---------------------------------------------------------------------------
// 表示用（表示だけ丸める）
// ---------------------------------------------------------------------------

export function formatYen(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const x = Object.is(v, -0) ? 0 : v;
  const abs = Math.abs(x);
  const digits = abs < 100 && !Number.isInteger(abs) ? 2 : 0;
  const rounded = Number(abs.toFixed(digits));
  const s = rounded.toLocaleString('ja-JP', { maximumFractionDigits: digits });
  return (x < 0 && rounded !== 0 ? '−' : '') + s + '円';
}

export function formatMan(v) {
  if (!Number.isFinite(v) || Math.abs(v) < 10000) return '';
  const man = Math.abs(v) / 10000;
  return `約${v < 0 ? '−' : ''}${man.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万円`;
}

export function formatPct(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`;
}
