import { highestAverages } from '@votobr/shared';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export interface ProportionalExample {
  parties: string[];
  votes: number[];
  seats: number;
  totalVotes: number;
  quotient: number;
  /** Cadeiras diretas do quociente partidário (parte inteira de votos / QE). */
  direct: number[];
  leftover: number;
  /** Total após distribuir as sobras pelo método D'Hondt (maiores médias). */
  final: number[];
  /** D'Hondt aplicado diretamente às 8 cadeiras (para comparação). */
  dhondt: number[];
}

/** Exemplo numérico do sistema proporcional com quociente eleitoral e sobras por D'Hondt. */
export function proportionalExample(
  votes: number[] = [100000, 80000, 30000, 20000],
  seats = 8,
  parties: string[] = ['A', 'B', 'C', 'D'],
): ProportionalExample {
  const totalVotes = sum(votes);
  const quotient = totalVotes / seats;
  const direct = votes.map((v) => Math.floor(v / quotient));
  const leftover = seats - sum(direct);
  return {
    parties,
    votes,
    seats,
    totalVotes,
    quotient,
    direct,
    leftover,
    final: highestAverages(votes, leftover, { initial: direct }),
    dhondt: highestAverages(votes, seats),
  };
}

export interface MixedExample {
  parties: string[];
  seats: number;
  districtSeats: number;
  districtWins: number[];
  listVotes: number[];
  /** Cadeiras a que cada partido tem direito: D'Hondt sobre o total, pelos votos de lista. */
  entitled: number[];
  /** Vagas preenchidas pela lista: direito proporcional menos as vitórias distritais. */
  fromList: number[];
  /** Total final; quem venceu mais distritos do que o direito proporcional mantém as vitórias. */
  final: number[];
  /** Cadeiras excedentes acrescidas à casa (PEC 2/2025, art. 45, § 4º). */
  overhang: number;
}

/** Exemplo do distrital misto da PEC 2/2025: metade em distritos, total proporcional. */
export function mixedExample(
  districtWins: number[] = [3, 2, 0],
  listVotes: number[] = [40, 35, 25],
  seats = 10,
  parties: string[] = ['A', 'B', 'C'],
): MixedExample {
  const entitled = highestAverages(listVotes, seats);
  const final = entitled.map((n, i) => Math.max(n, districtWins[i] ?? 0));
  return {
    parties,
    seats,
    districtSeats: sum(districtWins),
    districtWins,
    listVotes,
    entitled,
    fromList: final.map((n, i) => n - (districtWins[i] ?? 0)),
    final,
    overhang: sum(final) - seats,
  };
}
