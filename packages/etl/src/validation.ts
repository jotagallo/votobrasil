import {
  allocateOpenList,
  RULES_LEI_14211,
  RULES_STF_2024,
  type Dataset,
  type OpenListRules,
  type ValidationEntry,
} from '@votobr/shared';

export interface NamedRules {
  name: string;
  rules: OpenListRules;
}

export const CANDIDATE_RULES: NamedRules[] = [
  {
    name: 'STF 2024 (todos disputam as sobras; barreira individual de 10% do QE)',
    rules: RULES_STF_2024,
  },
  { name: 'Lei 14.211/2021 (barreiras de 80% e 20% do QE nas sobras)', rules: RULES_LEI_14211 },
];

/** Quantos eleitos oficiais o motor de apuração NÃO reproduz com as regras dadas. */
export function missingElected(ds: Dataset, rules: OpenListRules): number {
  const simulated = new Set(allocateOpenList(ds, rules).map((e) => ds.candidates[e.candidate]?.id));
  let missing = 0;
  for (const c of ds.candidates) {
    if ((c.status === 'QP' || c.status === 'MEDIA') && !simulated.has(c.id)) missing++;
  }
  return missing;
}

export function validateDataset(ds: Dataset, rules: OpenListRules): ValidationEntry {
  return { key: ds.key, seats: ds.seats, missing: missingElected(ds, rules) };
}
