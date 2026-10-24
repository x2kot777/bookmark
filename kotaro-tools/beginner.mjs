import { CATEGORIES, FUNDS_EXAMPLE, PROFIT_EXAMPLE, sampleToFunds, sampleToProfit } from './logic.mjs';

export const PRODUCT_CHOICES = [
  { id: 'living', icon: '🧺', label: '収納ケース' },
  { id: 'pet', icon: '🐾', label: 'お散歩ポーチ' },
  { id: 'outdoor', icon: '🎒', label: '収納バッグ' },
];
export const DEFAULT_PRODUCT_ID = 'outdoor';
export const QUANTITY_PLANS = [
  { id: 'small', label: '少なく試す', factor: 0.5 },
  { id: 'standard', label: '例の数量', factor: 1 },
  { id: 'large', label: '多めに試す', factor: 2 },
];

export function productFor(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES.find((c) => c.id === DEFAULT_PRODUCT_ID);
}

export function productChoice(id) {
  return PRODUCT_CHOICES.find((c) => c.id === id) || {
    id, icon: '📦', label: productFor(id).name,
  };
}

export function fundsForProduct(id, plan = 'standard', budget = FUNDS_EXAMPLE.budget) {
  const category = productFor(id);
  const p = QUANTITY_PLANS.find((x) => x.id === plan) || QUANTITY_PLANS[1];
  const raw = sampleToFunds(category.sample);
  return { ...raw, qty: String(Math.max(1, Math.round(category.sample.qty * p.factor))), budget: String(budget ?? '') };
}

export function profitForProduct(id) {
  return sampleToProfit(productFor(id).sample);
}

export function matchingPlan(id, qty) {
  const base = productFor(id).sample.qty;
  const n = Number(qty);
  return QUANTITY_PLANS.find((p) => Math.max(1, Math.round(base * p.factor)) === n)?.id || 'custom';
}
