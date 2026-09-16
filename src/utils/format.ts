export const fmtBRL = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtPct = (v: number, d = 4): string =>
  (v * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }) + '%';

export function parseNum(str: string): number {
  if (!str) return NaN;
  let s = String(str).trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}

export function formatarMoedaInput(valor: string): string {
  const dig = valor.replace(/\D/g, '');
  if (!dig) return '';
  const num = parseInt(dig, 10) / 100;
  return num.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
