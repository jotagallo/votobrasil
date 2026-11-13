import type {
  CandidateRecord,
  CompetitorRecord,
  Dataset,
  OfficeId,
  AreaRecord,
  OfficialStatus,
  UnitRecord,
} from '@votobr/shared';

export interface CompetitorKey {
  /** `F<n>` para federações, `P<n>` para partidos isolados. */
  id: string;
  label: string;
  parties: string[];
}

/** Identifica o competidor (partido ou federação) a partir das colunas do TSE. */
export function competitorOf(
  row: (c: string) => string,
  partyColumn = 'SG_PARTIDO',
): CompetitorKey {
  const fed = row('NR_FEDERACAO');
  if (fed && fed !== '-1' && fed !== '#NULO') {
    const parties = row('DS_COMPOSICAO_FEDERACAO')
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    return { id: `F${fed}`, label: row('SG_FEDERACAO'), parties };
  }
  const party = row(partyColumn);
  return { id: `P${row('NR_PARTIDO')}`, label: party, parties: [party] };
}

export function statusOf(situation: string): OfficialStatus {
  switch (situation.toUpperCase()) {
    case 'ELEITO POR QP':
      return 'QP';
    case 'ELEITO POR MÉDIA':
    case 'ELEITO POR MEDIA':
      return 'MEDIA';
    case 'ELEITO':
      return 'MAJ';
    case 'SUPLENTE':
      return 'SUPLENTE';
    default:
      return 'NAO';
  }
}

interface CandidateAcc {
  rec: CandidateRecord;
  byUnit: Map<number, number>;
}

/** Acumula votos linha a linha e produz o `Dataset` compacto consumido pelo simulador. */
export class DatasetBuilder {
  readonly units: UnitRecord[] = [];
  private readonly unitIndex = new Map<string, number>();
  private readonly competitors: CompetitorRecord[] = [];
  private readonly compIndex = new Map<string, number>();
  private readonly legendUnits: Map<number, number>[] = [];
  private readonly candidates = new Map<string, CandidateAcc>();

  constructor(
    private readonly key: string,
    private readonly year: number,
    private readonly office: OfficeId,
    private readonly area: AreaRecord,
  ) {}

  unit(key: string, make: () => UnitRecord): number {
    let idx = this.unitIndex.get(key);
    if (idx === undefined) {
      idx = this.units.length;
      this.units.push(make());
      this.unitIndex.set(key, idx);
    }
    return idx;
  }

  hasUnit(key: string): boolean {
    return this.unitIndex.has(key);
  }

  unitOf(key: string): number | undefined {
    return this.unitIndex.get(key);
  }

  competitor(k: CompetitorKey): number {
    let idx = this.compIndex.get(k.id);
    if (idx === undefined) {
      idx = this.competitors.length;
      this.competitors.push({
        id: k.id,
        label: k.label,
        parties: k.parties,
        legend: 0,
        legendByParty: {},
        legendByUnit: [],
      });
      this.legendUnits.push(new Map());
      this.compIndex.set(k.id, idx);
    }
    return idx;
  }

  addCandidate(
    sq: string,
    info: { name: string; number: number; party: string; comp: number; status: OfficialStatus },
    unit: number,
    votes: number,
  ): void {
    let acc = this.candidates.get(sq);
    if (!acc) {
      acc = {
        rec: { id: sq, ...info, votes: 0, u: [] },
        byUnit: new Map(),
      };
      this.candidates.set(sq, acc);
    }
    acc.rec.votes += votes;
    if (votes > 0) acc.byUnit.set(unit, (acc.byUnit.get(unit) ?? 0) + votes);
  }

  addLegend(comp: number, party: string, unit: number, votes: number): void {
    if (votes <= 0) return;
    const c = this.competitors[comp] as CompetitorRecord;
    c.legend += votes;
    c.legendByParty[party] = (c.legendByParty[party] ?? 0) + votes;
    const m = this.legendUnits[comp] as Map<number, number>;
    m.set(unit, (m.get(unit) ?? 0) + votes);
  }

  build(): Dataset {
    const candidates: CandidateRecord[] = [];
    for (const { rec, byUnit } of this.candidates.values()) {
      const elected = rec.status === 'QP' || rec.status === 'MEDIA' || rec.status === 'MAJ';
      if (rec.votes <= 0 && !elected) continue;
      rec.u = [...byUnit.entries()].sort((a, b) => a[0] - b[0]).flat();
      candidates.push(rec);
    }
    candidates.sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
    const competitors = this.competitors.map((c, i) => ({
      ...c,
      legendByUnit: [...(this.legendUnits[i] as Map<number, number>).entries()]
        .sort((a, b) => a[0] - b[0])
        .flat(),
    }));
    const validVotes =
      candidates.reduce((a, c) => a + c.votes, 0) + competitors.reduce((a, c) => a + c.legend, 0);
    const seats = candidates.filter(
      (c) => c.status === 'QP' || c.status === 'MEDIA' || c.status === 'MAJ',
    ).length;
    return {
      schema: 1,
      key: this.key,
      year: this.year,
      office: this.office,
      area: this.area,
      seats,
      electorate: this.units.reduce((a, u) => a + u.voters, 0),
      validVotes,
      units: this.units,
      competitors,
      candidates,
    };
  }
}
