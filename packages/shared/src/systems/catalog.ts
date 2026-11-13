import type { SystemId } from '../types.js';

/** Metadados estáveis de cada sistema; os textos ficam nos arquivos de tradução (`systems.<id>.*`). */
export interface SystemInfo {
  id: SystemId;
  family: 'proporcional' | 'majoritario' | 'misto';
  usesDistricts: boolean;
  usesLists: boolean;
}

export const SYSTEMS: readonly SystemInfo[] = [
  { id: 'atual', family: 'proporcional', usesDistricts: false, usesLists: false },
  { id: 'lista-fechada', family: 'proporcional', usesDistricts: false, usesLists: true },
  { id: 'distritao', family: 'majoritario', usesDistricts: false, usesLists: false },
  { id: 'distrital-puro', family: 'majoritario', usesDistricts: true, usesLists: false },
  { id: 'distrital-misto', family: 'misto', usesDistricts: true, usesLists: true },
];

export const UF_CODES = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;
export type UfCode = (typeof UF_CODES)[number];

export const UF_NAMES: Record<UfCode, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapá',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Pará',
  PB: 'Paraíba',
  PE: 'Pernambuco',
  PI: 'Piauí',
  PR: 'Paraná',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondônia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'São Paulo',
  TO: 'Tocantins',
};

/** Código IBGE de cada UF (primeiros 2 dígitos dos códigos municipais). */
export const UF_IBGE: Record<UfCode, number> = {
  AC: 12,
  AL: 27,
  AM: 13,
  AP: 16,
  BA: 29,
  CE: 23,
  DF: 53,
  ES: 32,
  GO: 52,
  MA: 21,
  MG: 31,
  MS: 50,
  MT: 51,
  PA: 15,
  PB: 25,
  PE: 26,
  PI: 22,
  PR: 41,
  RJ: 33,
  RN: 24,
  RO: 11,
  RR: 14,
  RS: 43,
  SC: 42,
  SE: 28,
  SP: 35,
  TO: 17,
};

export function isSystemId(value: string): value is SystemId {
  return SYSTEMS.some((s) => s.id === value);
}

export function isUf(value: string): value is UfCode {
  return (UF_CODES as readonly string[]).includes(value);
}
