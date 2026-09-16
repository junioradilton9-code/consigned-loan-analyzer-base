/**
 * Taxa mensal efetiva (Tabela Price) resolvida por bisseção.
 * Retorna 0 quando não há juros ou quando os dados são inconsistentes.
 */
export function calcularTaxaMensal(pv: number, pmt: number, n: number): number {
  // Entradas inválidas → sem taxa (evita NaN/Infinity propagando pela tela)
  if (!isFinite(pv) || !isFinite(pmt) || !isFinite(n)) return 0;
  if (pv <= 0 || pmt <= 0 || n <= 0) return 0;

  const total = pmt * n;
  // Sem juros (ou parcelas somam menos que o emprestado → taxa negativa, não suportada)
  if (total <= pv + 0.01) return 0;

  let lo = 1e-9;
  // Teto dinâmico: expande até cobrir a taxa real (contratos abusivos > 25% a.m.)
  let hi = 0.25;
  const pmtDe = (i: number) => {
    const f = Math.pow(1 + i, n);
    return (pv * i * f) / (f - 1);
  };
  let guard = 0;
  while (pmtDe(hi) < pmt && hi < 100 && guard++ < 80) hi *= 2;
  // Não retorna uma taxa artificial quando o intervalo não alcança a parcela.
  if (pmtDe(hi) < pmt) return 0;

  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const calc = pmtDe(mid);
    if (Math.abs(calc - pmt) < 1e-10) return mid;
    if (calc > pmt) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function saldoDevedor(pmt: number, i: number, n: number, pagos: number): number {
  if (![pmt, i, n, pagos].every(Number.isFinite) || pmt < 0 || n <= 0 || pagos < 0) return 0;
  const rest = n - pagos;
  if (rest <= 0) return 0;
  if (i < 1e-10) return pmt * rest;
  return (pmt * (1 - Math.pow(1 + i, -rest))) / i;
}

export interface Contrato {
  id: string;
  banco: string;
  valorLiberado: number;
  parcela: number;
  prazo: number;
  mesesPagos?: number;
  valorBrutoRestante?: number;
}

export interface ResultadoAnalise {
  taxa: number;
  taxaAA: number;
  sd: number;
  restantes: number;
  pagosUtilizados: number;
  brutoRestanteUtilizado: number;
  criterioSaldo: 'parcelasPagas' | 'valorBrutoRestante';
  totalPago: number;
  totalContrato: number;
  jurosTotal: number;
  jurosAVencer: number;
}

export function resolverBaseSaldo(c: Contrato) {
  const prazo = Math.max(0, c.prazo || 0);
  const usarBrutoRestante = typeof c.valorBrutoRestante === 'number' && c.valorBrutoRestante >= 0;

  if (usarBrutoRestante) {
    // Arredonda erro de ponto flutuante (80.00000000000001 → 80)
    const bruto = c.parcela > 0 ? Math.round(c.valorBrutoRestante! / c.parcela) : 0;
    // Clamp: nunca pode passar do prazo nem ser negativo
    const restantes = Math.min(prazo, Math.max(0, bruto));
    const pagos = prazo - restantes;
    return {
      restantes,
      pagos,
      brutoRestanteUtilizado: c.parcela * restantes,
      criterioSaldo: 'valorBrutoRestante' as const,
    };
  }

  const pagos = Math.min(prazo, Math.max(0, c.mesesPagos ?? 0));
  const restantes = prazo - pagos;
  return {
    restantes,
    pagos,
    brutoRestanteUtilizado: c.parcela * restantes,
    criterioSaldo: 'parcelasPagas' as const,
  };
}

export interface ResultadoConsolidado {
  qtd: number;
  liberadoTotal: number;
  parcelaMensal: number;
  sdTotal: number;
  taxaMedia: number;
  taxaMediaAA: number;
  totalPago: number;
  jurosTotal: number;
  jurosAVencer: number;
}

export function consolidar(lista: Contrato[]): ResultadoConsolidado {
  const a = lista.map((c) => ({ c, r: analisar(c) }));
  const tot = (fn: (x: { c: Contrato; r: ResultadoAnalise }) => number) => a.reduce((s, x) => s + fn(x), 0);
  const sdTotal = tot((x) => x.r.sd);
  const liberadoTotal = tot((x) => x.c.valorLiberado);
  const usarSD = sdTotal > 0.01;
  const pesos = usarSD ? sdTotal : liberadoTotal;
  const taxaMedia = pesos > 0 ? a.reduce((s, x) => s + x.r.taxa * (usarSD ? x.r.sd : x.c.valorLiberado), 0) / pesos : 0;
  return {
    qtd: lista.length,
    liberadoTotal,
    parcelaMensal: tot((x) => x.c.parcela),
    sdTotal,
    taxaMedia,
    taxaMediaAA: Math.pow(1 + taxaMedia, 12) - 1,
    totalPago: tot((x) => x.r.totalPago),
    jurosTotal: tot((x) => x.r.jurosTotal),
    jurosAVencer: tot((x) => x.r.jurosAVencer),
  };
}

export function agruparPorBanco(contratos: Contrato[]): Record<string, Contrato[]> {
  const grupos: Record<string, Contrato[]> = {};
  contratos.forEach((c) => {
    const chave = c.banco.trim().toLowerCase();
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(c);
  });
  return grupos;
}

export function analisar(c: Contrato): ResultadoAnalise {
  const taxa = calcularTaxaMensal(c.valorLiberado, c.parcela, c.prazo);
  const taxaAA = Math.pow(1 + taxa, 12) - 1;
  const base = resolverBaseSaldo(c);
  const sd = saldoDevedor(c.parcela, taxa, c.prazo, base.pagos);
  return {
    taxa,
    taxaAA,
    sd,
    restantes: base.restantes,
    pagosUtilizados: base.pagos,
    brutoRestanteUtilizado: base.brutoRestanteUtilizado,
    criterioSaldo: base.criterioSaldo,
    totalPago: c.parcela * base.pagos,
    totalContrato: c.parcela * c.prazo,
    jurosTotal: c.parcela * c.prazo - c.valorLiberado,
    jurosAVencer: c.parcela * base.restantes - sd,
  };
}
