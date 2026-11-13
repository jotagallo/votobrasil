import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Divide uma linha CSV com separador `;` e campos opcionalmente entre aspas. */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  while (i <= n) {
    if (line.charCodeAt(i) === 34) {
      let j = i + 1;
      let s = '';
      for (;;) {
        const k = line.indexOf('"', j);
        if (k === -1) {
          s += line.slice(j);
          i = n + 1;
          break;
        }
        if (line.charCodeAt(k + 1) === 34) {
          s += line.slice(j, k + 1);
          j = k + 2;
          continue;
        }
        s += line.slice(j, k);
        i = k + 2;
        break;
      }
      out.push(s);
    } else {
      const k = line.indexOf(';', i);
      if (k === -1) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, k));
      i = k + 1;
    }
  }
  return out;
}

export type Row = (column: string) => string;

/**
 * Lê um CSV (ISO-8859-1, separador `;`) de dentro de um .zip sem descompactar em disco.
 * Requer o utilitário `unzip` (presente no macOS, Linux e nas imagens do GitHub Actions).
 */
export async function streamZipCsv(
  zipPath: string,
  member: string,
  onRow: (row: Row, fields: string[]) => void,
  /** Pré-filtro barato sobre a linha crua (evita o parse completo de linhas irrelevantes). */
  include?: (line: string) => boolean,
): Promise<number> {
  const child = spawn('unzip', ['-p', zipPath, member], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('latin1');
  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip ${member} saiu com código ${code}`)),
    );
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let header: Map<string, number> | null = null;
  let rows = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (header && include && !include(line)) continue;
    const fields = splitLine(line);
    if (!header) {
      header = new Map(fields.map((name, idx) => [name, idx]));
      continue;
    }
    const h = header;
    onRow((column) => {
      const idx = h.get(column);
      if (idx === undefined) throw new Error(`Coluna ausente em ${member}: ${column}`);
      return fields[idx] ?? '';
    }, fields);
    rows++;
  }
  await exited;
  return rows;
}

export function parseIntSafe(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Coordenadas do TSE usam vírgula decimal. */
export function parseCoord(value: string): number {
  const n = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}
