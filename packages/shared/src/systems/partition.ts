/**
 * Partição de um grafo de adjacência em `k` distritos contíguos e com população equilibrada.
 *
 * Etapas (determinísticas — o sorteio usa semente fixa):
 * 1. bisseção recursiva por árvore geradora (como o `recursive_tree_part` do GerryChain/MGGG):
 *    sorteia árvores geradoras mínimas do grafo — arestas que cruzam a fronteira de um grupo
 *    (município, região imediata, bairro) custam mais, então a árvore percorre cada grupo antes
 *    de sair dele — e corta a aresta cujos dois lados têm a população certa para o número de
 *    distritos de cada lado (dentro da meta), escolhendo o corte mais compacto (menor momento de
 *    inércia) e que menos divide grupos. Os dois lados são sempre conexos;
 * 2. recombinação — distrito fora da meta é unido a um vizinho e o par é redividido do mesmo
 *    jeito (como o ReCom do MGGG), deslocando o excesso de população ao longo de cadeias;
 * 3. busca local — move nós de fronteira entre distritos vizinhos enquanto isso reduz a
 *    função-objetivo (desvio populacional, com penalidade forte acima da meta, + momento de
 *    inércia + pedaços de cada grupo), sem nunca desconectar o distrito de origem.
 *
 * Inspirado nos critérios do PLS 86/2017 (contiguidade, compacidade, ±5%, excepcionalmente ±10%)
 * e da PEC 2/2025 (contiguidade, equilíbrio numérico e formação histórica). Ver docs/METHODOLOGY.md.
 */

export interface PartitionNode {
  /** Coordenadas projetadas (km). */
  x: number;
  y: number;
  /** Peso a equilibrar (população). */
  w: number;
  /** Identificadores de grupo por nível de coesão (ex.: [município, região imediata]); -1 = nenhum. */
  groups?: readonly number[];
}

export interface PartitionOptions {
  /** Meta de desvio relativo em relação à média (0,05 = ±5%). */
  tolerance?: number;
  /** Peso do momento de inércia (compacidade). */
  compactness?: number;
  /** Peso de cada pedaço extra de um grupo, por nível (mesma ordem de `PartitionNode.groups`). */
  cohesion?: readonly number[];
  /** Limite de passadas da busca local. */
  maxPasses?: number;
  /** Semente do sorteio das árvores. */
  seed?: number;
}

export interface Partition {
  /** Distrito (0..k-1) de cada nó, numerados do norte para o sul e do oeste para o leste. */
  assignment: Int32Array;
  count: number;
  /** Peso total de cada distrito. */
  weights: number[];
  /** Maior desvio relativo (fração) entre o peso de um distrito e a média. */
  maxDeviation: number;
}

interface KdPoint {
  id: number;
  x: number;
  y: number;
  w: number;
}

/**
 * Bisseção recursiva: corta o eixo de maior extensão no ponto que melhor reparte o peso
 * proporcionalmente ao número de partes de cada lado. Cada parte recebe ao menos um ponto.
 */
export function kdPartition(points: readonly KdPoint[], parts: number, size: number): Int32Array {
  const out = new Int32Array(size);
  let next = 0;
  const split = (pts: KdPoint[], n: number) => {
    if (n <= 1) {
      for (const p of pts) out[p.id] = next;
      next++;
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const byX = maxX - minX >= maxY - minY;
    const sorted = [...pts].sort(
      (a, b) => (byX ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x) || a.id - b.id,
    );
    const left = Math.floor(n / 2);
    const right = n - left;
    const total = sorted.reduce((a, p) => a + p.w, 0);
    const target = (total * left) / n;
    let cum = 0;
    let best = left;
    let bestGap = Infinity;
    for (let i = 1; i <= sorted.length - right; i++) {
      cum += sorted[i - 1]?.w ?? 0;
      if (i < left) continue;
      const gap = Math.abs(cum - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    split(sorted.slice(0, best), left);
    split(sorted.slice(best), right);
  };
  split([...points], Math.max(1, Math.min(parts, points.length)));
  return out;
}

/** Liga componentes desconexos (ilhas, municípios sem fronteira na malha) pelo par de nós mais próximo. */
export function connectComponents(
  nodes: readonly PartitionNode[],
  adjacency: readonly (readonly number[])[],
): number[][] {
  const adj = adjacency.map((list) => [...list]);
  for (;;) {
    const comp = new Int32Array(nodes.length).fill(-1);
    const sizes: number[] = [];
    for (let s = 0; s < nodes.length; s++) {
      if (comp[s] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [s];
      comp[s] = id;
      while (stack.length) {
        const i = stack.pop() as number;
        size++;
        for (const j of adj[i] ?? []) {
          if (comp[j] === -1) {
            comp[j] = id;
            stack.push(j);
          }
        }
      }
      sizes.push(size);
    }
    if (sizes.length <= 1) return adj;
    const main = sizes.indexOf(Math.max(...sizes));
    // Cada componente menor liga-se ao nó mais próximo fora dele.
    for (let c = 0; c < sizes.length; c++) {
      if (c === main) continue;
      let best = Infinity;
      let pair: [number, number] | null = null;
      for (let i = 0; i < nodes.length; i++) {
        if (comp[i] !== c) continue;
        const a = nodes[i] as PartitionNode;
        for (let j = 0; j < nodes.length; j++) {
          if (comp[j] === c) continue;
          const b = nodes[j] as PartitionNode;
          const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (d < best) {
            best = d;
            pair = [i, j];
          }
        }
      }
      if (pair) {
        adj[pair[0]]?.push(pair[1]);
        adj[pair[1]]?.push(pair[0]);
      }
    }
  }
}

/** Gerador pseudoaleatório determinístico (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Folgas sucessivas (múltiplos da meta) quando nenhuma árvore oferece um corte dentro da meta. */
const RELAX = [1, 2, 3, 5, 8] as const;
const MIN_TREES = 6;
/** Fração da meta admitida para um lado com mais de um distrito. */
const INNER = 0.3;
const MAX_TREES = 30;

interface Cut {
  left: number[];
  right: number[];
  parts: number;
  score: number;
}

type Cutter = (S: number[], parts: number, local?: boolean) => Cut;

/**
 * Corte de um conjunto conexo `S` em dois lados conexos com `parts` distritos ao todo: sorteia
 * árvores geradoras mínimas (pesos aleatórios + sobretaxa por fronteira de grupo) e escolhe a
 * aresta da árvore cujo corte equilibra a população de cada lado, com a menor inércia somada e
 * dividindo o mínimo de grupos. Sem corte dentro da meta, relaxa a folga aos poucos.
 */
function makeCutter(
  nodes: readonly PartitionNode[],
  adj: readonly (readonly number[])[],
  Q: number,
  tolerance: number,
  cutCost: readonly number[],
  rng: () => number,
): Cutter {
  const levels = cutCost.length;
  const pos = new Int32Array(nodes.length).fill(-1);
  const sameGroup = (u: number, v: number, l: number) => {
    const g = (nodes[u] as PartitionNode).groups?.[l] ?? -1;
    return g >= 0 && g === ((nodes[v] as PartitionNode).groups?.[l] ?? -1);
  };

  const bestCut = (S: number[], parts: number, local = false): Cut => {
    const m = S.length;
    S.forEach((v, p) => (pos[v] = p));
    // Arestas internas (em índices locais) e sobretaxa por fronteira de grupo.
    const eu: number[] = [];
    const ev: number[] = [];
    const extra: number[] = [];
    for (let p = 0; p < m; p++) {
      const u = S[p] as number;
      for (const v of adj[u] ?? []) {
        const q = pos[v] as number;
        if (q <= p) continue;
        eu.push(p);
        ev.push(q);
        let x = 0;
        for (let l = 0; l < levels; l++) if (!sameGroup(u, v, l)) x += 1;
        extra.push(x);
      }
    }
    const w = new Float64Array(m);
    const wx = new Float64Array(m);
    const wy = new Float64Array(m);
    const wr = new Float64Array(m);
    let W = 0;
    let SX = 0;
    let SY = 0;
    let SR = 0;
    for (let p = 0; p < m; p++) {
      const node = nodes[S[p] as number] as PartitionNode;
      w[p] = node.w;
      wx[p] = node.w * node.x;
      wy[p] = node.w * node.y;
      wr[p] = node.w * (node.x * node.x + node.y * node.y);
      W += w[p] as number;
      SX += wx[p] as number;
      SY += wy[p] as number;
      SR += wr[p] as number;
    }
    const inertiaOf = (p: number, sx: number, sy: number, r: number) =>
      p > 0 ? Math.max(0, r - (sx * sx + sy * sy) / p) : 0;
    const IS = Math.max(inertiaOf(W, SX, SY, SR), 1e-9);
    // Cota de referência: a global na bisseção; a média do próprio grupo na recombinação (um grupo
    // acima da cota só pode ser dividido por igual, e a melhora é julgada depois).
    const q = local ? W / parts : Q;

    const E = eu.length;
    const order = new Int32Array(E);
    const key = new Float64Array(E);
    const uf = new Int32Array(m);
    const head = new Int32Array(m);
    const nxt = new Int32Array(2 * m);
    const to = new Int32Array(2 * m);
    const parent = new Int32Array(m);
    const pre = new Int32Array(m);
    const subN = new Int32Array(m);
    const subW = new Float64Array(m);
    const subX = new Float64Array(m);
    const subY = new Float64Array(m);
    const subR = new Float64Array(m);
    const find = (x: number): number => {
      while (uf[x] !== x) {
        uf[x] = uf[uf[x] as number] as number;
        x = uf[x] as number;
      }
      return x;
    };

    let best: Cut | null = null;
    let fallback: Cut | null = null;
    let fallbackDev = Infinity;
    for (const relax of RELAX) {
      const eps = tolerance * relax;
      // Com folga maior, admite também cortes desiguais (ex.: 1 distrito × o resto).
      const span = relax === 1 ? 0 : parts;
      for (let attempt = 0; attempt < MAX_TREES; attempt++) {
        if (best && attempt >= MIN_TREES) break;
        // Árvore geradora mínima com pesos aleatórios + sobretaxas (Kruskal).
        // Nas rodadas mais folgadas, sem sobretaxa: árvores mais variadas destravam regiões em
        // "estrela" (um município-polo com vizinhos pequenos), onde nenhum corte único equilibra.
        const surcharge = relax <= 2 ? 1 : 0;
        for (let e = 0; e < E; e++) {
          order[e] = e;
          key[e] = rng() + surcharge * (extra[e] as number);
        }
        order.sort((a, b) => (key[a] as number) - (key[b] as number));
        for (let p = 0; p < m; p++) {
          uf[p] = p;
          head[p] = -1;
        }
        let edges = 0;
        for (let o = 0; o < E && edges < m - 1; o++) {
          const e = order[o] as number;
          const a = eu[e] as number;
          const b = ev[e] as number;
          const ra = find(a);
          const rb = find(b);
          if (ra === rb) continue;
          uf[ra] = rb;
          to[2 * edges] = b;
          nxt[2 * edges] = head[a] as number;
          head[a] = 2 * edges;
          to[2 * edges + 1] = a;
          nxt[2 * edges + 1] = head[b] as number;
          head[b] = 2 * edges + 1;
          edges++;
        }
        // Pré-ordem a partir da raiz 0 e somas das subárvores (pós-ordem = pré-ordem invertida).
        parent[0] = -1;
        let filled = 0;
        const stack = [0];
        while (stack.length) {
          const v = stack.pop() as number;
          pre[filled++] = v;
          for (let h = head[v] as number; h >= 0; h = nxt[h] as number) {
            const c = to[h] as number;
            if (c === parent[v]) continue;
            parent[c] = v;
            stack.push(c);
          }
        }
        const tin = new Int32Array(m);
        for (let i = 0; i < filled; i++) tin[pre[i] as number] = i;
        for (let i = filled - 1; i >= 0; i--) {
          const v = pre[i] as number;
          subN[v] = 1;
          subW[v] = w[v] as number;
          subX[v] = wx[v] as number;
          subY[v] = wy[v] as number;
          subR[v] = wr[v] as number;
          for (let h = head[v] as number; h >= 0; h = nxt[h] as number) {
            const c = to[h] as number;
            if (c === parent[v]) continue;
            subN[v] = (subN[v] as number) + (subN[c] as number);
            subW[v] = (subW[v] as number) + (subW[c] as number);
            subX[v] = (subX[v] as number) + (subX[c] as number);
            subY[v] = (subY[v] as number) + (subY[c] as number);
            subR[v] = (subR[v] as number) + (subR[c] as number);
          }
        }
        const take = (v: number, n1: number, score: number): Cut => {
          const inside = new Uint8Array(m);
          const start = tin[v] as number;
          for (let i = start; i < start + (subN[v] as number); i++) inside[pre[i] as number] = 1;
          const left: number[] = [];
          const right: number[] = [];
          for (let p = 0; p < m; p++) (inside[p] ? left : right).push(S[p] as number);
          return { left, right, parts: n1, score };
        };
        const half = parts / 2;
        for (let i = 1; i < filled; i++) {
          const v = pre[i] as number;
          const L = subW[v] as number;
          const R = W - L;
          const lo = Math.max(1, Math.ceil(L / (q * (1 + eps))), Math.floor(half) - span);
          const hi = Math.min(parts - 1, Math.floor(L / (q * (1 - eps))), Math.ceil(half) + span);
          for (let n1 = lo; n1 <= hi; n1++) {
            const n2 = parts - n1;
            if ((subN[v] as number) < n1 || m - (subN[v] as number) < n2) continue;
            const dl = L / (n1 * q) - 1;
            const dr = R / (n2 * q) - 1;
            // Um lado que ainda será dividido precisa de folga para os cortes seguintes.
            if (Math.abs(dl) > (n1 > 1 ? eps * INNER : eps)) continue;
            if (Math.abs(dr) > (n2 > 1 ? eps * INNER : eps)) continue;
            // Desvio em relação à média local: distribui a folga igualmente pelos dois lados.
            const tl = (n1 * W) / parts;
            const ll = L / tl - 1;
            const lr = R / (W - tl) - 1;
            const IL = inertiaOf(L, subX[v] as number, subY[v] as number, subR[v] as number);
            const IR = inertiaOf(
              R,
              SX - (subX[v] as number),
              SY - (subY[v] as number),
              SR - (subR[v] as number),
            );
            let score =
              (IL + IR) / IS + 10 * (ll * ll + lr * lr) + (0.5 * Math.abs(n1 - half)) / parts;
            const u = S[v] as number;
            const pu = S[parent[v] as number] as number;
            for (let l = 0; l < levels; l++) if (sameGroup(u, pu, l)) score += cutCost[l] as number;
            if (!best || score < best.score) best = take(v, n1, score);
          }
          if (!best) {
            // Sem corte admissível: guarda o de menor desvio para o caso extremo.
            const n1 = Math.min(parts - 1, Math.max(1, Math.round(L / q)));
            const dev = Math.max(Math.abs(L / (n1 * q) - 1), Math.abs(R / ((parts - n1) * q) - 1));
            if (
              dev < fallbackDev &&
              (subN[v] as number) >= n1 &&
              m - (subN[v] as number) >= parts - n1
            ) {
              fallbackDev = dev;
              fallback = take(v, n1, dev);
            }
          }
        }
      }
      if (best) break;
    }
    for (const v of S) pos[v] = -1;
    if (best) return best;
    if (fallback) return fallback;
    // Conjunto menor que o número de partes pedido (não deveria ocorrer): um nó por parte.
    return { left: S.slice(0, 1), right: S.slice(1), parts: 1, score: Infinity };
  };

  return bestCut;
}

/** Etapa 1: bisseção recursiva por árvores geradoras. O grafo precisa ser conexo. */
function treeBisection(cut: Cutter, n: number, count: number): Int32Array {
  const out = new Int32Array(n);
  let next = 0;
  const work: [number[], number][] = [[Array.from({ length: n }, (_, i) => i), count]];
  while (work.length) {
    const [S, parts] = work.pop() as [number[], number];
    if (parts <= 1 || S.length <= 1) {
      for (const v of S) out[v] = next;
      next++;
      continue;
    }
    const c = cut(S, parts);
    work.push([c.right, parts - c.parts], [c.left, c.parts]);
  }
  return out;
}

/**
 * Etapa 2 (recombinação, como o ReCom do MGGG): enquanto houver distrito fora da meta, junta-o a
 * um vizinho e redivide o par pelo mesmo corte em árvore, se isso reduzir o pior desvio do par.
 * Repetido, desloca o excesso de população ao longo de cadeias de distritos — o que movimentos
 * isolados de unidades não conseguem quando um município grande "tranca" a passagem.
 */
function recombine(
  cut: Cutter,
  nodes: readonly PartitionNode[],
  adj: readonly (readonly number[])[],
  a: Int32Array,
  count: number,
  Q: number,
  tolerance: number,
): void {
  const members = Array.from({ length: count }, () => [] as number[]);
  a.forEach((d, i) => members[d]?.push(i));
  const weight = (list: readonly number[]) =>
    list.reduce((acc, i) => acc + (nodes[i] as PartitionNode).w, 0);
  const dev = new Float64Array(count);
  for (let d = 0; d < count; d++) dev[d] = weight(members[d] as number[]) / Q - 1;
  const touching = (ds: readonly number[]) => {
    const out = new Set<number>();
    for (const d of ds) {
      for (const i of members[d] as number[]) {
        for (const j of adj[i] ?? []) out.add(a[j] as number);
      }
    }
    for (const d of ds) out.delete(d);
    return out;
  };
  /** Junta os distritos `ds` e os redivide; aplica só se o pior desvio do grupo diminuir. */
  const tryRedraw = (ds: readonly number[]): boolean => {
    const U = ds.flatMap((d) => members[d] as number[]);
    const pieces: number[][] = [];
    const work: [number[], number][] = [[U, ds.length]];
    while (work.length) {
      const [S, parts] = work.pop() as [number[], number];
      if (parts === 1) {
        pieces.push(S);
        continue;
      }
      const c = cut(S, parts, true);
      if (c.left.length === 0 || c.right.length === 0) return false;
      work.push([c.left, c.parts], [c.right, parts - c.parts]);
    }
    const after = pieces.map((list) => weight(list) / Q - 1);
    const before = Math.max(...ds.map((d) => Math.abs(dev[d] as number)));
    if (Math.max(...after.map(Math.abs)) >= before - 1e-6) return false;
    ds.forEach((d, i) => {
      members[d] = pieces[i] as number[];
      for (const v of members[d] as number[]) a[v] = d;
      dev[d] = after[i] as number;
    });
    return true;
  };
  const stuck = new Set<number>();
  for (let iter = 0; iter < count * 30; iter++) {
    let d = -1;
    for (let x = 0; x < count; x++) {
      if (stuck.has(x)) continue;
      if (d < 0 || Math.abs(dev[x] as number) > Math.abs(dev[d] as number)) d = x;
    }
    if (d < 0 || Math.abs(dev[d] as number) <= tolerance) return;
    // Primeiro os vizinhos que mais compensam (o mais leve para um distrito pesado e vice-versa).
    const sign = Math.sign(dev[d] as number);
    const byNeed = (list: Iterable<number>) =>
      [...list].sort((x, y) => sign * ((dev[x] as number) - (dev[y] as number)) || x - y);
    const near = byNeed(touching([d]));
    let improved = near.some((e) => tryRedraw([d, e]));
    // Um município pequeno pode ser o único elo entre três "bolsões" (ex.: Casimiro de Abreu entre
    // Rio das Ostras, Cabo Frio e Macaé): nenhum corte de um par equilibra; redesenha um trio.
    if (!improved) {
      triples: for (const e of near.slice(0, 6)) {
        for (const f of byNeed(touching([d, e])).slice(0, 8)) {
          if (tryRedraw([d, e, f])) {
            improved = true;
            break triples;
          }
        }
      }
    }
    if (improved) stuck.clear();
    else stuck.add(d);
  }
}

export function partitionGraph(
  nodes: readonly PartitionNode[],
  adjacency: readonly (readonly number[])[],
  k: number,
  options: PartitionOptions = {},
): Partition {
  const n = nodes.length;
  const count = Math.max(1, Math.min(k, n));
  const tolerance = options.tolerance ?? 0.05;
  const lambda = options.compactness ?? 0.15;
  const cohesion = options.cohesion ?? [];
  const maxPasses = options.maxPasses ?? 200;
  const adj = connectComponents(nodes, adjacency);
  const rng = mulberry32(options.seed ?? 0x5eed + count * 7919 + n);

  const Q0 = nodes.reduce((acc, p) => acc + p.w, 0) / count;
  const cutter = makeCutter(
    nodes,
    adj,
    Q0,
    tolerance,
    cohesion.map((c) => c * 10),
    rng,
  );
  const a = treeBisection(cutter, n, count);
  recombine(cutter, nodes, adj, a, count, Q0, tolerance);

  // Estado incremental por distrito: peso, somas ponderadas e segundo momento (inércia exata).
  const P = new Float64Array(count);
  const Sx = new Float64Array(count);
  const Sy = new Float64Array(count);
  const M = new Float64Array(count);
  const size = new Int32Array(count);
  const eps = 1e-6;
  const wOf = (i: number) => Math.max((nodes[i] as PartitionNode).w, eps);
  const add = (i: number, d: number, sign: 1 | -1) => {
    const p = nodes[i] as PartitionNode;
    const w = wOf(i);
    P[d] = (P[d] as number) + sign * w;
    Sx[d] = (Sx[d] as number) + sign * w * p.x;
    Sy[d] = (Sy[d] as number) + sign * w * p.y;
    M[d] = (M[d] as number) + sign * w * (p.x * p.x + p.y * p.y);
    size[d] = (size[d] as number) + sign;
  };

  // --- 2. Contiguidade -------------------------------------------------------------------------
  const stamp = new Int32Array(n);
  let epoch = 0;
  const repair = () => {
    for (let guard = 0; guard < n; guard++) {
      let changed = false;
      for (let d = 0; d < count; d++) {
        const members: number[] = [];
        for (let i = 0; i < n; i++) if (a[i] === d) members.push(i);
        const comps: number[][] = [];
        epoch++;
        for (const s of members) {
          if (stamp[s] === epoch) continue;
          const comp: number[] = [];
          const stack = [s];
          stamp[s] = epoch;
          while (stack.length) {
            const i = stack.pop() as number;
            comp.push(i);
            for (const j of adj[i] ?? []) {
              if (a[j] === d && stamp[j] !== epoch) {
                stamp[j] = epoch;
                stack.push(j);
              }
            }
          }
          comps.push(comp);
        }
        if (comps.length <= 1) continue;
        const weight = (c: number[]) => c.reduce((acc, i) => acc + wOf(i), 0);
        comps.sort((x, y) => weight(y) - weight(x) || (x[0] as number) - (y[0] as number));
        for (const comp of comps.slice(1)) {
          const touch = new Map<number, number>();
          for (const i of comp) {
            for (const j of adj[i] ?? []) {
              const t = a[j] as number;
              if (t !== d) touch.set(t, (touch.get(t) ?? 0) + 1);
            }
          }
          const target = [...touch.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0];
          if (target === undefined) continue;
          for (const i of comp) a[i] = target;
          changed = true;
        }
      }
      if (!changed) return;
    }
  };
  repair();
  for (let i = 0; i < n; i++) add(i, a[i] as number, 1);

  // --- 3. Busca local --------------------------------------------------------------------------
  const total = P.reduce((acc, v) => acc + v, 0);
  const Q = total / count;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of nodes) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  // Raio² de um disco com a área média de um distrito: normaliza a inércia entre estados.
  const R2 = Math.max(((maxX - minX) * (maxY - minY)) / count / Math.PI, 1e-6);
  const inertiaScale = lambda / (Q * R2);
  const penalty = (w: number) => {
    const dev = Math.abs(w - Q) / Q;
    const over = Math.max(0, dev - tolerance);
    return dev * dev + 60 * over * over;
  };
  const inertia = (p: number, sx: number, sy: number, m: number) =>
    p > eps ? m - (sx * sx + sy * sy) / p : 0;

  // Pedaços por grupo: contagem de nós de cada (nível, grupo, distrito).
  const levels = cohesion.length;
  const groupCount = Array.from({ length: levels }, () => new Map<number, number>());
  const gkey = (g: number, d: number) => g * count + d;
  for (let i = 0; i < n; i++) {
    const groups = (nodes[i] as PartitionNode).groups ?? [];
    for (let l = 0; l < levels; l++) {
      const g = groups[l] ?? -1;
      if (g < 0) continue;
      const map = groupCount[l] as Map<number, number>;
      const key = gkey(g, a[i] as number);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }

  const delta = (i: number, s: number, t: number): number => {
    const p = nodes[i] as PartitionNode;
    const w = wOf(i);
    const ps = P[s] as number;
    const pt = P[t] as number;
    let d = penalty(ps - w) + penalty(pt + w) - penalty(ps) - penalty(pt);
    const r2 = w * (p.x * p.x + p.y * p.y);
    const before =
      inertia(ps, Sx[s] as number, Sy[s] as number, M[s] as number) +
      inertia(pt, Sx[t] as number, Sy[t] as number, M[t] as number);
    const after =
      inertia(
        ps - w,
        (Sx[s] as number) - w * p.x,
        (Sy[s] as number) - w * p.y,
        (M[s] as number) - r2,
      ) +
      inertia(
        pt + w,
        (Sx[t] as number) + w * p.x,
        (Sy[t] as number) + w * p.y,
        (M[t] as number) + r2,
      );
    d += (after - before) * inertiaScale;
    const groups = p.groups ?? [];
    for (let l = 0; l < levels; l++) {
      const g = groups[l] ?? -1;
      if (g < 0) continue;
      const map = groupCount[l] as Map<number, number>;
      let pieces = 0;
      if ((map.get(gkey(g, s)) ?? 0) === 1) pieces--;
      if ((map.get(gkey(g, t)) ?? 0) === 0) pieces++;
      d += pieces * (cohesion[l] as number);
    }
    return d;
  };

  const move = (i: number, s: number, t: number) => {
    add(i, s, -1);
    add(i, t, 1);
    a[i] = t;
    const groups = (nodes[i] as PartitionNode).groups ?? [];
    for (let l = 0; l < levels; l++) {
      const g = groups[l] ?? -1;
      if (g < 0) continue;
      const map = groupCount[l] as Map<number, number>;
      map.set(gkey(g, s), (map.get(gkey(g, s)) ?? 0) - 1);
      map.set(gkey(g, t), (map.get(gkey(g, t)) ?? 0) + 1);
    }
  };

  /** O distrito `s` continua conexo sem o nó `i`? */
  const staysConnected = (i: number, s: number): boolean => {
    const inside = (adj[i] ?? []).filter((j) => a[j] === s);
    if (inside.length <= 1) return true;
    epoch++;
    stamp[i] = epoch;
    const want = new Set(inside);
    const start = inside[0] as number;
    stamp[start] = epoch;
    want.delete(start);
    const stack = [start];
    while (stack.length && want.size) {
      const v = stack.pop() as number;
      for (const j of adj[v] ?? []) {
        if (a[j] !== s || stamp[j] === epoch) continue;
        stamp[j] = epoch;
        want.delete(j);
        stack.push(j);
      }
    }
    return want.size === 0;
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const s = a[i] as number;
      if ((size[s] as number) <= 1) continue;
      let bestT = -1;
      let bestD = -1e-9;
      for (const j of adj[i] ?? []) {
        const t = a[j] as number;
        if (t === s) continue;
        const d = delta(i, s, t);
        if (d < bestD || (d === bestD && t < bestT)) {
          bestD = d;
          bestT = t;
        }
      }
      if (bestT < 0 || !staysConnected(i, s)) continue;
      move(i, s, bestT);
      moved++;
    }
    if (moved === 0) break;
  }

  // --- Numeração geográfica: faixas de norte a sul, cada uma de oeste para leste. -------------
  const centroids = Array.from({ length: count }, (_, d) => ({
    d,
    x: (Sx[d] as number) / Math.max(P[d] as number, eps),
    y: (Sy[d] as number) / Math.max(P[d] as number, eps),
  }));
  const perRow = Math.max(1, Math.round(Math.sqrt(count)));
  const byLat = [...centroids].sort((p, q) => q.y - p.y || p.x - q.x || p.d - q.d);
  const order: number[] = [];
  for (let r = 0; r < byLat.length; r += perRow) {
    order.push(
      ...byLat
        .slice(r, r + perRow)
        .sort((p, q) => p.x - q.x || p.d - q.d)
        .map((c) => c.d),
    );
  }
  const rename = new Int32Array(count);
  order.forEach((d, idx) => (rename[d] = idx));
  const assignment = new Int32Array(n);
  for (let i = 0; i < n; i++) assignment[i] = rename[a[i] as number] as number;
  const weights = new Array<number>(count).fill(0);
  for (let i = 0; i < n; i++) {
    const d = assignment[i] as number;
    weights[d] = (weights[d] ?? 0) + (nodes[i] as PartitionNode).w;
  }
  const mean = weights.reduce((acc, v) => acc + v, 0) / count;
  const maxDeviation = mean > 0 ? Math.max(...weights.map((v) => Math.abs(v - mean) / mean)) : 0;
  return { assignment, count, weights, maxDeviation };
}
