import {
  computeMetrics,
  mergeResults,
  officialResult,
  partyVotes,
  simulate,
  type ChamberAreaRow,
  type ChamberResponse,
  type Dataset,
  type OfficeId,
  type SimulateResponse,
  type SimulationResult,
  type SimulationView,
  type SystemId,
  type UnitPoint,
} from '@votobr/shared';
import type { DataStore } from './data.js';

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

function view(result: SimulationResult, votes: Record<string, number>): SimulationView {
  const rest: SimulationResult = { ...result };
  delete rest.unitDistrict;
  delete rest.mapPoints;
  // `result.seats` inclui eventuais cadeiras excedentes do distrital misto.
  return { result: rest, metrics: computeMetrics(result.seatsByParty, votes, result.seats) };
}

function unitPoints(result: SimulationResult): UnitPoint[] | null {
  if (!result.mapPoints) return null;
  return result.mapPoints.map(([lon, lat, d, voters, mun]) => [
    round5(lon),
    round5(lat),
    d,
    voters,
    mun,
  ]);
}

export function simulateArea(ds: Dataset, system: SystemId): SimulateResponse {
  const votes = partyVotes(ds);
  const baseline = officialResult(ds);
  const scenario = system === 'atual' ? baseline : simulate(ds, system);
  return {
    office: ds.office,
    year: ds.year,
    area: ds.area,
    seats: ds.seats,
    electorate: ds.electorate,
    validVotes: ds.validVotes,
    system,
    baseline: view(baseline, votes),
    scenario: view(scenario, votes),
    partyVotes: votes,
    units: system === 'atual' ? null : unitPoints(scenario),
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Soma de todas as circunscrições de uma casa (Câmara dos Deputados e Assembleias). */
export async function simulateChamber(
  store: DataStore,
  office: OfficeId,
  system: SystemId,
): Promise<ChamberResponse> {
  const summary = store.meta.offices[office];
  const baselineParts: SimulationResult[] = [];
  const scenarioParts: SimulationResult[] = [];
  const votes: Record<string, number> = {};
  const areas: ChamberAreaRow[] = [];

  for (const area of summary.areas) {
    const key = store.keyOf(office, area.code);
    const ds = key ? await store.dataset(key) : null;
    if (!ds) throw new Error(`Dataset ausente: ${office}/${area.code}`);
    const baseline = officialResult(ds);
    const scenario = system === 'atual' ? baseline : simulate(ds, system);
    baselineParts.push(baseline);
    scenarioParts.push(scenario);
    for (const [party, v] of Object.entries(partyVotes(ds))) votes[party] = (votes[party] ?? 0) + v;
    areas.push({
      code: area.code,
      name: area.name,
      seats: ds.seats,
      scenarioSeats: scenario.seats,
      baseline: baseline.seatsByParty,
      scenario: scenario.seatsByParty,
    });
    await tick();
  }

  const mergedBaseline = mergeResults(`${summary.year}-${office}`, 'atual', baselineParts);
  const mergedScenario = mergeResults(`${summary.year}-${office}`, system, scenarioParts);
  const seats = mergedBaseline.seats;
  return {
    office,
    year: summary.year,
    system,
    seats,
    baseline: {
      seatsByParty: mergedBaseline.seatsByParty,
      metrics: computeMetrics(mergedBaseline.seatsByParty, votes, seats),
    },
    scenario: {
      seatsByParty: mergedScenario.seatsByParty,
      metrics: computeMetrics(mergedScenario.seatsByParty, votes, mergedScenario.seats),
    },
    partyVotes: votes,
    areas,
  };
}
