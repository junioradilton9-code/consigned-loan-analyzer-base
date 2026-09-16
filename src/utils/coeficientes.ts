// ============================================================
// TABELAS DE FATORES PRICE — PORTABILIDADE
// ============================================================

export type Convenio = 'governo' | 'siape' | 'inss';

export interface LinhaFator {
  dataBase: string;
  primeiroVenc: string;
  txCet: number;
  fatores: Record<number, number>;
  projetada?: boolean;
}

export interface TabelaFator {
  id: string;
  convenio: Convenio;
  codigo: string;
  nome: string;
  empregador: string;
  prazos: number[];
  tc: number;
  oficial: boolean;
  linhas: LinhaFator[];
}

const DATAS_BASE = [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
  '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
  '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
  '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14',
  '2026-09-15', '2026-09-16',
];

const VENC_GOV = DATAS_BASE.map((_, i) =>
  i < 10 ? '2026-10-10' : '2026-11-10'
);

const VENC_SIAPE = DATAS_BASE.map((_, i) =>
  i < 18 ? '2026-10-15' : '2026-11-15'
);

const VENC_INSS = DATAS_BASE.map((_, i) =>
  i < 13 ? '2026-10-07' : '2026-11-07'
);

function montar(
  id: string,
  convenio: Convenio,
  codigo: string,
  nome: string,
  empregador: string,
  vencs: string[],
  cets: number[],
  series: Record<number, number[]>,
  opts: { tc?: number; oficial?: boolean } = {}
): TabelaFator {
  const { tc = 0, oficial = true } = opts;
  const prazos = Object.keys(series).map(Number).sort((a, b) => a - b);
  return {
    id,
    convenio,
    codigo,
    nome,
    empregador,
    prazos,
    tc,
    oficial,
    linhas: DATAS_BASE.map((d, i) => {
      const fatores: Record<number, number> = {};
      prazos.forEach((p) => {
        const v = series[p][i];
        if (v) fatores[p] = v;
      });
      return {
        dataBase: d,
        primeiroVenc: vencs[i],
        txCet: cets[i],
        fatores,
      };
    }),
  };
}

function cet(...pares: [number, number][]): number[] {
  const out: number[] = [];
  pares.forEach(([valor, qtd]) => {
    for (let i = 0; i < qtd; i++) out.push(valor);
  });
  return out;
}

function gov(
  id: string,
  codigo: string,
  nome: string,
  f96: number[],
  cets: number[]
): TabelaFator {
  return montar(id, 'governo', codigo, nome, 'GOV RONDONIA', VENC_GOV, cets, {
    96: f96,
  });
}

export const TABELAS_GOVERNO: TabelaFator[] = [
  gov('gov-1', '775220', 'RFNGOVRONDONIA1DIGPORTAB',
    [0.02932, 0.02929, 0.02927, 0.02924, 0.02922, 0.02914, 0.02912, 0.02910,
     0.02907, 0.02905, 0.02973, 0.02970, 0.02968, 0.02965, 0.02963, 0.02953,
     0.02950, 0.02948, 0.02945, 0.02938, 0.02935, 0.02933],
    cet([36.63, 3], [36.63, 2], [36.64, 3], [36.62, 5], [36.63, 7])),
  gov('gov-2', '775221', 'RFNGOVRONDONIA2DIGPORTAB',
    [0.02706, 0.02704, 0.02702, 0.02700, 0.02698, 0.02692, 0.02690, 0.02688,
     0.02686, 0.02684, 0.02740, 0.02738, 0.02736, 0.02734, 0.02732, 0.02724,
     0.02722, 0.02720, 0.02717, 0.02711, 0.02709, 0.02707],
    cet([32.57, 3], [32.58, 5], [32.56, 3], [32.57, 9])),
  gov('gov-3', '775222', 'RFNGOVRONDONIA3DIGPORTAB',
    [0.02488, 0.02486, 0.02485, 0.02483, 0.02481, 0.02476, 0.02475, 0.02473,
     0.02471, 0.02470, 0.02516, 0.02514, 0.02513, 0.02511, 0.02509, 0.02502,
     0.02501, 0.02499, 0.02497, 0.02492, 0.02491, 0.02489],
    cet([28.63, 3], [28.63, 7], [28.62, 9], [28.63, 3])),
  gov('gov-4', '775223', 'RFNGOVRONDONIA4DIGPORTAB',
    [0.02445, 0.02444, 0.02442, 0.02441, 0.02439, 0.02434, 0.02432, 0.02431,
     0.02429, 0.02428, 0.02472, 0.02471, 0.02469, 0.02467, 0.02466, 0.02459,
     0.02457, 0.02456, 0.02454, 0.02449, 0.02448, 0.02446],
    cet([27.85, 3], [27.86, 4], [27.84, 3], [27.85, 9])),
  gov('gov-5', '775224', 'RFNGOVRONDONIA5DIGPORTAB',
    [0.02403, 0.02401, 0.02400, 0.02398, 0.02397, 0.02392, 0.02391, 0.02389,
     0.02388, 0.02386, 0.02429, 0.02427, 0.02426, 0.02424, 0.02422, 0.02416,
     0.02415, 0.02413, 0.02411, 0.02407, 0.02405, 0.02404],
    cet([27.08, 6], [27.09, 1], [27.07, 5], [27.08, 7])),
  gov('gov-6', '775225', 'RFNGOVRONDONIA6DIGPORTAB',
    [0.02319, 0.02318, 0.02316, 0.02315, 0.02314, 0.02309, 0.02308, 0.02307,
     0.02305, 0.02304, 0.02343, 0.02341, 0.02340, 0.02338, 0.02337, 0.02331,
     0.02330, 0.02328, 0.02327, 0.02323, 0.02321, 0.02320],
    cet([25.55, 5], [25.56, 2], [25.54, 4], [25.55, 8])),
  gov('gov-7', '775226', 'RFNGOVRONDONIA7DIGPORTAB',
    [0.02286, 0.02285, 0.02283, 0.02282, 0.02281, 0.02277, 0.02275, 0.02274,
     0.02272, 0.02271, 0.02309, 0.02307, 0.02306, 0.02305, 0.02303, 0.02298,
     0.02296, 0.02295, 0.02294, 0.02290, 0.02288, 0.02287],
    cet([24.95, 7], [24.94, 12])),
  gov('gov-8', '775227', 'RFNGOVRONDONIA8DIGPORTAB',
    [0.02270, 0.02268, 0.02267, 0.02266, 0.02264, 0.02260, 0.02259, 0.02258,
     0.02256, 0.02255, 0.02292, 0.02291, 0.02289, 0.02288, 0.02286, 0.02281,
     0.02280, 0.02278, 0.02277, 0.02273, 0.02272, 0.02270],
    cet([24.64, 4], [24.65, 3], [24.63, 3], [24.64, 9])),
  gov('gov-9', '775228', 'RFNGOVRONDONIA9DIGPORTAB',
    [0.02253, 0.02252, 0.02251, 0.02249, 0.02248, 0.02244, 0.02243, 0.02241,
     0.02240, 0.02239, 0.02275, 0.02274, 0.02272, 0.02271, 0.02270, 0.02264,
     0.02263, 0.02262, 0.02260, 0.02257, 0.02255, 0.02254],
    cet([24.34, 7], [24.33, 5], [24.34, 7])),
  gov('gov-10', '775232', 'RFNGOVRONDONIA10DIGPORTAB',
    [0.02237, 0.02236, 0.02234, 0.02233, 0.02232, 0.02228, 0.02227, 0.02225,
     0.02224, 0.02223, 0.02258, 0.02257, 0.02256, 0.02254, 0.02253, 0.02248,
     0.02247, 0.02245, 0.02244, 0.02240, 0.02239, 0.02237],
    cet([24.04, 10], [24.03, 6], [24.04, 6])),
];

function siape(
  id: string,
  codigo: string,
  nome: string,
  cets: number[],
  series: Record<number, number[]>
): TabelaFator {
  return montar(id, 'siape', codigo, nome, 'SIAPE PORT', VENC_SIAPE, cets, series);
}

export const TABELAS_SIAPE: TabelaFator[] = [
  siape('siape-1', '775601', 'RFNSIAPEFED1DIGPORTAB',
    cet([25.14, 11], [25.15, 7], [25.14, 4]),
    { 96: [0.02304, 0.02302, 0.02301, 0.02300, 0.02298, 0.02294, 0.02293, 0.02291, 0.02290, 0.02289, 0.02284, 0.02283, 0.02282, 0.02280, 0.02279, 0.02273, 0.02272, 0.02271, 0.02311, 0.02307, 0.02306, 0.02304], 120: [0.02140, 0.02139, 0.02138, 0.02136, 0.02135, 0.02131, 0.02130, 0.02129, 0.02127, 0.02126, 0.02122, 0.02121, 0.02120, 0.02118, 0.02117, 0.02112, 0.02111, 0.02109, 0.02147, 0.02143, 0.02142, 0.02141] }),
  siape('siape-2', '775602', 'RFNSIAPEFED2DIGPORTAB',
    cet([24.79, 9], [24.80, 9], [24.79, 4]),
    { 96: [0.02285, 0.02283, 0.02282, 0.02281, 0.02279, 0.02275, 0.02274, 0.02272, 0.02271, 0.02270, 0.02266, 0.02264, 0.02263, 0.02262, 0.02260, 0.02255, 0.02254, 0.02252, 0.02292, 0.02288, 0.02287, 0.02285], 120: [0.02120, 0.02119, 0.02117, 0.02116, 0.02115, 0.02111, 0.02110, 0.02109, 0.02107, 0.02106, 0.02102, 0.02101, 0.02100, 0.02099, 0.02097, 0.02092, 0.02091, 0.02090, 0.02127, 0.02123, 0.02122, 0.02120] }),
  siape('siape-3', '775603', 'RFNSIAPEFED3DIGPORTAB',
    cet([24.34, 14], [24.35, 4], [24.33, 1], [24.34, 3]),
    { 96: [0.02260, 0.02259, 0.02257, 0.02256, 0.02255, 0.02251, 0.02249, 0.02248, 0.02247, 0.02245, 0.02241, 0.02240, 0.02239, 0.02237, 0.02236, 0.02231, 0.02230, 0.02228, 0.02267, 0.02263, 0.02262, 0.02260], 120: [0.02094, 0.02092, 0.02091, 0.02090, 0.02089, 0.02085, 0.02084, 0.02083, 0.02081, 0.02080, 0.02076, 0.02075, 0.02074, 0.02073, 0.02072, 0.02067, 0.02066, 0.02064, 0.02100, 0.02097, 0.02095, 0.02094] }),
  siape('siape-4', '775604', 'RFNSIAPEFED20K4DIGPORTAB',
    cet([23.89, 15], [23.90, 3], [23.88, 1], [23.89, 3]),
    { 96: [0.02235, 0.02234, 0.02233, 0.02231, 0.02230, 0.02226, 0.02225, 0.02224, 0.02222, 0.02221, 0.02217, 0.02216, 0.02215, 0.02213, 0.02212, 0.02207, 0.02206, 0.02204, 0.02242, 0.02238, 0.02237, 0.02236], 120: [0.02067, 0.02066, 0.02065, 0.02064, 0.02063, 0.02059, 0.02058, 0.02057, 0.02055, 0.02054, 0.02051, 0.02050, 0.02048, 0.02047, 0.02046, 0.02041, 0.02040, 0.02039, 0.02074, 0.02070, 0.02069, 0.02068] }),
  siape('siape-5', '775605', 'RFNSIAPEFED30K5DIGPORTAB',
    cet([23.59, 15], [23.60, 3], [23.58, 2], [23.59, 2]),
    { 96: [0.02219, 0.02218, 0.02216, 0.02215, 0.02214, 0.02210, 0.02209, 0.02207, 0.02206, 0.02205, 0.02201, 0.02200, 0.02199, 0.02197, 0.02196, 0.02191, 0.02190, 0.02189, 0.02226, 0.02222, 0.02221, 0.02219], 120: [0.02050, 0.02049, 0.02048, 0.02046, 0.02045, 0.02042, 0.02041, 0.02039, 0.02038, 0.02037, 0.02034, 0.02033, 0.02031, 0.02030, 0.02029, 0.02024, 0.02023, 0.02022, 0.02056, 0.02053, 0.02052, 0.02050] }),
  siape('siape-6', '775606', 'RFNSIAPEFED35K6DIGPORTAB',
    cet([23.29, 15], [23.30, 3], [23.28, 1], [23.29, 3]),
    { 96: [0.02202, 0.02201, 0.02200, 0.02199, 0.02197, 0.02194, 0.02193, 0.02191, 0.02190, 0.02189, 0.02185, 0.02184, 0.02183, 0.02181, 0.02180, 0.02175, 0.02174, 0.02173, 0.02209, 0.02205, 0.02204, 0.02203], 120: [0.02033, 0.02031, 0.02030, 0.02029, 0.02028, 0.02025, 0.02024, 0.02022, 0.02021, 0.02020, 0.02017, 0.02016, 0.02014, 0.02013, 0.02012, 0.02008, 0.02007, 0.02005, 0.02039, 0.02035, 0.02034, 0.02033] }),
  siape('siape-7', '775607', 'RFNSIAPEFED45K7DIGPORTAB',
    cet([0, 22]),
    { 120: [0.01990, 0.01989, 0.01987, 0.01986, 0.01985, 0.01982, 0.01981, 0.01980, 0.01979, 0.01978, 0.01974, 0.01973, 0.01972, 0.01971, 0.01970, 0.01966, 0.01965, 0.01964, 0.01995, 0.01992, 0.01991, 0.01990] }),
  siape('siape-8', '775608', 'RFNSIAPEFED50K8DIGPORTAB',
    cet([0, 22]),
    { 120: [0.01972, 0.01971, 0.01970, 0.01969, 0.01968, 0.01965, 0.01964, 0.01963, 0.01962, 0.01961, 0.01958, 0.01957, 0.01956, 0.01955, 0.01953, 0.01949, 0.01948, 0.01947, 0.01978, 0.01975, 0.01974, 0.01973] }),
  siape('siape-9', '775609', 'RFNSIAPEFED60K9DIGPORTAB',
    cet([0, 22]),
    { 120: [0.01947, 0.01946, 0.01945, 0.01944, 0.01943, 0.01940, 0.01939, 0.01938, 0.01937, 0.01936, 0.01933, 0.01931, 0.01931, 0.01930, 0.01929, 0.01924, 0.01923, 0.01922, 0.01953, 0.01949, 0.01948, 0.01947] }),
  siape('siape-10', '775610', 'RFNSIAPEFED50K10DIGPORTAB',
    cet([0, 22]),
    { 120: [0.01930, 0.01929, 0.01928, 0.01927, 0.01926, 0.01923, 0.01922, 0.01921, 0.01920, 0.01919, 0.01916, 0.01915, 0.01914, 0.01913, 0.01912, 0.01908, 0.01907, 0.01906, 0.01935, 0.01932, 0.01931, 0.01930] }),
];

function inss(
  id: string,
  codigo: string,
  nome: string,
  cets: number[],
  series: Record<number, number[]>
): TabelaFator {
  return montar(id, 'inss', codigo, nome, 'INSS — BANCO PAN', VENC_INSS, cets, series);
}

export const TABELAS_INSS: TabelaFator[] = [
  inss('inss-1', '701434', 'INSSNOVNORMALA',
    cet([26.23, 14], [26.22, 1], [26.23, 7]),
    { 96: [0.02359, 0.02358, 0.02357, 0.02355, 0.02351, 0.02349, 0.02348, 0.02346, 0.02345, 0.02340, 0.02339, 0.02337, 0.02336, 0.02334, 0.02374, 0.02372, 0.02371, 0.02369, 0.02365, 0.02363, 0.02362, 0.02360],
      108: [0.02268, 0.02267, 0.02265, 0.02264, 0.02260, 0.02258, 0.02257, 0.02256, 0.02254, 0.02250, 0.02248, 0.02247, 0.02246, 0.02244, 0.02282, 0.02280, 0.02279, 0.02278, 0.02273, 0.02272, 0.02270, 0.02269] }),
  inss('inss-2', '701435', 'INSSNOVNORMALB',
    cet([25.98, 14], [25.97, 1], [25.98, 7]),
    { 96: [0.02341, 0.02340, 0.02339, 0.02337, 0.02333, 0.02331, 0.02330, 0.02328, 0.02327, 0.02322, 0.02321, 0.02319, 0.02318, 0.02316, 0.02356, 0.02354, 0.02353, 0.02351, 0.02347, 0.02345, 0.02344, 0.02342],
      108: [0.02250, 0.02249, 0.02247, 0.02246, 0.02242, 0.02240, 0.02239, 0.02238, 0.02236, 0.02232, 0.02230, 0.02229, 0.02228, 0.02226, 0.02264, 0.02262, 0.02261, 0.02260, 0.02255, 0.02254, 0.02252, 0.02251] }),
  inss('inss-3', '701436', 'INSSNOVNORMALC',
    cet([25.72, 14], [25.71, 1], [25.72, 7]),
    { 96: [0.02323, 0.02322, 0.02321, 0.02319, 0.02315, 0.02313, 0.02312, 0.02310, 0.02309, 0.02304, 0.02303, 0.02301, 0.02300, 0.02298, 0.02338, 0.02336, 0.02335, 0.02333, 0.02329, 0.02327, 0.02326, 0.02324],
      108: [0.02232, 0.02231, 0.02229, 0.02228, 0.02224, 0.02222, 0.02221, 0.02220, 0.02218, 0.02214, 0.02212, 0.02211, 0.02210, 0.02208, 0.02246, 0.02244, 0.02243, 0.02242, 0.02237, 0.02236, 0.02234, 0.02233] }),
  inss('inss-4', '701437', 'INSSNOVNORMALD',
    cet([25.47, 14], [25.46, 1], [25.47, 7]),
    { 96: [0.02305, 0.02304, 0.02303, 0.02301, 0.02297, 0.02295, 0.02294, 0.02292, 0.02291, 0.02286, 0.02285, 0.02283, 0.02282, 0.02280, 0.02320, 0.02318, 0.02317, 0.02315, 0.02311, 0.02309, 0.02308, 0.02306],
      108: [0.02214, 0.02213, 0.02211, 0.02210, 0.02206, 0.02204, 0.02203, 0.02202, 0.02200, 0.02196, 0.02194, 0.02193, 0.02192, 0.02190, 0.02228, 0.02226, 0.02225, 0.02224, 0.02219, 0.02218, 0.02216, 0.02215] }),
  inss('inss-5', '701438', 'INSSNOVNORMALE',
    cet([25.21, 14], [25.20, 1], [25.21, 7]),
    { 96: [0.02287, 0.02286, 0.02285, 0.02283, 0.02279, 0.02277, 0.02276, 0.02274, 0.02273, 0.02268, 0.02267, 0.02265, 0.02264, 0.02262, 0.02302, 0.02300, 0.02299, 0.02297, 0.02293, 0.02291, 0.02290, 0.02288],
      108: [0.02196, 0.02195, 0.02193, 0.02192, 0.02188, 0.02186, 0.02185, 0.02184, 0.02182, 0.02178, 0.02176, 0.02175, 0.02174, 0.02172, 0.02210, 0.02208, 0.02207, 0.02206, 0.02201, 0.02200, 0.02198, 0.02197] }),
  inss('inss-6', '701439', 'INSSNOVNORMALF',
    cet([24.96, 14], [24.95, 1], [24.96, 7]),
    { 96: [0.02269, 0.02268, 0.02267, 0.02265, 0.02261, 0.02259, 0.02258, 0.02256, 0.02255, 0.02250, 0.02249, 0.02247, 0.02246, 0.02244, 0.02284, 0.02282, 0.02281, 0.02279, 0.02275, 0.02273, 0.02272, 0.02270],
      108: [0.02178, 0.02177, 0.02175, 0.02174, 0.02170, 0.02168, 0.02167, 0.02166, 0.02164, 0.02160, 0.02158, 0.02157, 0.02156, 0.02154, 0.02192, 0.02190, 0.02189, 0.02188, 0.02183, 0.02182, 0.02180, 0.02179] }),
  inss('inss-7', '701440', 'INSSNOVNORMALG',
    cet([24.70, 14], [24.69, 1], [24.70, 7]),
    { 96: [0.02251, 0.02250, 0.02249, 0.02247, 0.02243, 0.02241, 0.02240, 0.02238, 0.02237, 0.02232, 0.02231, 0.02229, 0.02228, 0.02226, 0.02266, 0.02264, 0.02263, 0.02261, 0.02257, 0.02255, 0.02254, 0.02252],
      108: [0.02160, 0.02159, 0.02157, 0.02156, 0.02152, 0.02150, 0.02149, 0.02148, 0.02146, 0.02142, 0.02140, 0.02139, 0.02138, 0.02136, 0.02174, 0.02172, 0.02171, 0.02170, 0.02165, 0.02164, 0.02162, 0.02161] }),
  inss('inss-8', '701441', 'INSSNOVNORMALH',
    cet([24.45, 14], [24.44, 1], [24.45, 7]),
    { 96: [0.02233, 0.02232, 0.02231, 0.02229, 0.02225, 0.02223, 0.02222, 0.02220, 0.02219, 0.02214, 0.02213, 0.02211, 0.02210, 0.02208, 0.02248, 0.02246, 0.02245, 0.02243, 0.02239, 0.02237, 0.02236, 0.02234],
      108: [0.02142, 0.02141, 0.02139, 0.02138, 0.02134, 0.02132, 0.02131, 0.02130, 0.02128, 0.02124, 0.02122, 0.02121, 0.02120, 0.02118, 0.02156, 0.02154, 0.02153, 0.02152, 0.02147, 0.02146, 0.02144, 0.02143] }),
  inss('inss-9', '701442', 'INSSNOVNORMALI',
    cet([24.19, 14], [24.18, 1], [24.19, 7]),
    { 96: [0.02215, 0.02214, 0.02213, 0.02211, 0.02207, 0.02205, 0.02204, 0.02202, 0.02201, 0.02196, 0.02195, 0.02193, 0.02192, 0.02190, 0.02230, 0.02228, 0.02227, 0.02225, 0.02221, 0.02219, 0.02218, 0.02216],
      108: [0.02124, 0.02123, 0.02121, 0.02120, 0.02116, 0.02114, 0.02113, 0.02112, 0.02110, 0.02106, 0.02104, 0.02103, 0.02102, 0.02100, 0.02138, 0.02136, 0.02135, 0.02134, 0.02129, 0.02128, 0.02126, 0.02125] }),
];

const CFG_VENC: Record<Convenio, { diaVenc: number; minDias: number }> = {
  governo: { diaVenc: 10, minDias: 41 },
  siape: { diaVenc: 15, minDias: 35 },
  inss: { diaVenc: 7, minDias: 35 },
};

function paraData(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function paraIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diasEntre(a: string, b: string): number {
  return Math.round(
    (paraData(b).getTime() - paraData(a).getTime()) / 86400000
  );
}

function calcularVencimento(dataBase: string, conv: Convenio): string {
  const { diaVenc, minDias } = CFG_VENC[conv];
  const base = paraData(dataBase);
  for (let k = 1; k <= 6; k++) {
    const cand = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + k, diaVenc)
    );
    const isoCand = paraIso(cand);
    if (diasEntre(dataBase, isoCand) >= minDias) return isoCand;
  }
  return dataBase;
}

function fatorPrice(i: number, n: number): number {
  if (i < 1e-12) return 1 / n;
  const f = Math.pow(1 + i, n);
  return (i * f) / (f - 1);
}

function coeficiente(i: number, n: number, dc: number): number {
  return fatorPrice(i, n) / Math.pow(1 + i, (dc - 30) / 30);
}

function taxaImplicita(fator: number, n: number, dc: number): number {
  let lo = 1e-6;
  let hi = 0.2;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (coeficiente(mid, n, dc) > fator) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function gerarDiasUteis(inicioIso: string, anos: number): string[] {
  const out: string[] = [];
  const d = paraData(inicioIso);
  const fim = paraData(inicioIso);
  fim.setUTCFullYear(fim.getUTCFullYear() + anos);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= fim) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(paraIso(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function estenderTabela(tab: TabelaFator): TabelaFator {
  const oficiais = tab.linhas;
  const ref = oficiais[oficiais.length - 1];
  const dcRef = diasEntre(ref.dataBase, ref.primeiroVenc);
  const taxas: Record<number, number> = {};
  tab.prazos.forEach((p) => {
    const f = ref.fatores[p];
    if (f) taxas[p] = taxaImplicita(f, p, dcRef);
  });
  const novas: LinhaFator[] = gerarDiasUteis(ref.dataBase, 2).map((data) => {
    const venc = calcularVencimento(data, tab.convenio);
    const dc = diasEntre(data, venc);
    const fatores: Record<number, number> = {};
    tab.prazos.forEach((p) => {
      const i = taxas[p];
      if (i) fatores[p] = Number(coeficiente(i, p, dc).toFixed(5));
    });
    return {
      dataBase: data,
      primeiroVenc: venc,
      txCet: ref.txCet,
      fatores,
      projetada: true,
    };
  });
  return { ...tab, linhas: [...oficiais, ...novas] };
}

// ============================================================
// TABELAS BASE (oficiais + projetadas) e CAMADA DE PERSISTÊNCIA
// TABELAS_BASE = padrão de fábrica
// TABELAS      = base + customizações salvas no localStorage
// ============================================================

const TABELAS_BASE: Record<Convenio, TabelaFator[]> = {
  governo: TABELAS_GOVERNO.map(estenderTabela),
  siape: TABELAS_SIAPE.map(estenderTabela),
  inss: TABELAS_INSS.map(estenderTabela),
};

let usuarioCoeficientesAtual = 'global';

export function setUsuarioCoeficientes(usuarioId?: string): void {
  usuarioCoeficientesAtual = usuarioId || 'global';
  (['governo', 'siape', 'inss'] as Convenio[]).forEach((conv) => {
    TABELAS[conv] = aplicarCustomizadas(conv, usuarioCoeficientesAtual);
  });
}

export function getUsuarioCoeficientesAtual(): string {
  return usuarioCoeficientesAtual;
}

const chaveCustom = (conv: Convenio, usuarioId = usuarioCoeficientesAtual) =>
  usuarioId === 'global'
    ? `consig_tabelas_custom_${conv}`
    : `consig_tabelas_custom_${usuarioId}_${conv}`;

/**
 * Converte qualquer formato de data para ISO (YYYY-MM-DD).
 * As tabelas nativas usam ISO; a importação de planilhas costuma trazer
 * DD/MM/YYYY. Sem normalizar, o match por data-base falha e a tabela
 * importada nunca aparece na Portabilidade.
 */
export function normalizarDataISO(data: string): string {
  if (!data) return data;
  const s = String(data).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                 // já é ISO
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);      // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);          // DD/MM/YY
  if (m) {
    const aa = parseInt(m[3], 10);
    const ano = aa < 50 ? 2000 + aa : 1900 + aa;
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})[/](\d{1,2})[/](\d{1,2})$/);            // YYYY/MM/DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

/** Normaliza para ISO todas as datas das linhas de uma tabela */
export function normalizarTabela(t: TabelaFator): TabelaFator {
  return {
    ...t,
    linhas: (t.linhas || []).map((l) => ({
      ...l,
      dataBase: normalizarDataISO(l.dataBase),
      primeiroVenc: normalizarDataISO(l.primeiroVenc),
    })),
  };
}

function lerDelta(conv: Convenio, usuarioId = usuarioCoeficientesAtual): TabelaFator[] {
  try {
    const raw = localStorage.getItem(chaveCustom(conv, usuarioId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    // Normaliza datas de tabelas salvas em versões antigas (formato BR)
    return Array.isArray(arr) ? (arr as TabelaFator[]).map(normalizarTabela) : [];
  } catch {
    return [];
  }
}

function salvarDelta(conv: Convenio, delta: TabelaFator[], usuarioId = usuarioCoeficientesAtual): void {
  try {
    localStorage.setItem(chaveCustom(conv, usuarioId), JSON.stringify(delta));
  } catch {
    // quota cheia — ignora silenciosamente
  }
}

function aplicarCustomizadas(conv: Convenio, usuarioId = usuarioCoeficientesAtual): TabelaFator[] {
  // 1) Sempre parte das tabelas padrão do convênio
  const base = [...TABELAS_BASE[conv]];

  // 2) Aplica o escopo GLOBAL (quando o master aplica a "Todos os usuários"),
  //    para que QUALQUER usuário — inclusive os criados depois — herde.
  const globalDelta = lerDelta(conv, 'global');
  const removidasGlobal = new Set(globalDelta.filter((t: any) => t._removida).map(t => t.codigo));
  const baseSemGlobal = base.filter(t => !removidasGlobal.has(t.codigo));
  for (const t of globalDelta.filter((t: any) => !t._removida)) {
    const idx = baseSemGlobal.findIndex(x => x.codigo === t.codigo || x.nome === t.nome);
    if (idx >= 0) baseSemGlobal[idx] = t;
    else baseSemGlobal.push(t);
  }

  // 3) Se o usuário já é o próprio "global", retorna o que montamos
  if (usuarioId === 'global') return baseSemGlobal;

  // 4) Aplica o delta específico do usuário (por cima do global)
  const delta = lerDelta(conv, usuarioId);
  const removidas = new Set(delta.filter((t: any) => t._removida).map(t => t.codigo));
  const ativas = delta.filter((t: any) => !t._removida);
  const final = baseSemGlobal.filter(t => !removidas.has(t.codigo));

  for (const t of ativas) {
    const idx = final.findIndex(x => x.codigo === t.codigo || x.nome === t.nome);
    if (idx >= 0) final[idx] = t;
    else final.push(t);
  }
  return final;
}

export const TABELAS: Record<Convenio, TabelaFator[]> = {
  governo: aplicarCustomizadas('governo', usuarioCoeficientesAtual),
  siape: aplicarCustomizadas('siape', usuarioCoeficientesAtual),
  inss: aplicarCustomizadas('inss', usuarioCoeficientesAtual),
};

/**
 * Aplica uma tabela customizada em memória E persiste no localStorage.
 * Permanece salvo até uma nova substituição (ou restauração do padrão).
 */
export function aplicarTabelaCustomizada(conv: Convenio, tabela: TabelaFator, usuarioId = usuarioCoeficientesAtual): 'substituir' | 'adicionar' {
  // Datas SEMPRE em ISO — garante o match com as tabelas nativas
  const t0 = normalizarTabela(tabela);
  const arr = usuarioId === usuarioCoeficientesAtual ? TABELAS[conv] : aplicarCustomizadas(conv, usuarioId);
  const idx = arr.findIndex(t => t.codigo === t0.codigo || t.nome === t0.nome);
  const acao: 'substituir' | 'adicionar' = idx >= 0 ? 'substituir' : 'adicionar';
  if (idx >= 0) arr[idx] = t0;
  else arr.push(t0);

  const delta = lerDelta(conv, usuarioId);
  const dIdx = delta.findIndex(t => t.codigo === t0.codigo || t.nome === t0.nome);
  if (dIdx >= 0) delta[dIdx] = t0;
  else delta.push(t0);
  salvarDelta(conv, delta, usuarioId);
  if (usuarioId === usuarioCoeficientesAtual) TABELAS[conv] = aplicarCustomizadas(conv, usuarioId);
  return acao;
}

/** Restaura as tabelas oficiais padrão do convênio (remove customizações salvas) */
export function restaurarTabelasPadrao(conv: Convenio, usuarioId = usuarioCoeficientesAtual): number {
  const delta = lerDelta(conv, usuarioId);
  localStorage.removeItem(chaveCustom(conv, usuarioId));
  if (usuarioId === usuarioCoeficientesAtual) TABELAS[conv] = [...TABELAS_BASE[conv]];
  return delta.length;
}

/**
 * Espelha as tabelas customizadas vindas da nuvem: adiciona/atualiza as
 * recebidas e REMOVE as locais que não existem mais no banco.
 * Evita acúmulo quando outra máquina troca a remessa.
 */
export function sincronizarTabelasDaNuvem(
  conv: Convenio,
  remotas: TabelaFator[],
  usuarioId = usuarioCoeficientesAtual
): { aplicadas: number; removidas: number } {
  // Nuvem vazia = sem customizadas — limpa delta sem tocar nas nativas
  const normalizadas = remotas.map(normalizarTabela);
  const antes = lerDelta(conv, usuarioId).length;
  salvarDelta(conv, normalizadas, usuarioId);
  if (usuarioId === usuarioCoeficientesAtual) TABELAS[conv] = aplicarCustomizadas(conv, usuarioId);  // nativas + remotas
  return {
    aplicadas: normalizadas.length,
    removidas: Math.max(0, antes - normalizadas.length),
  };
}

export interface ResultadoSubstituicao {
  adicionadas: number;
  substituidas: number;
  removidas: number;
  /** Códigos das tabelas customizadas que foram descartadas */
  codigosRemovidos: string[];
}

/**
 * Substitui TODO o conjunto de tabelas customizadas do convênio pelo lote
 * informado — evitando acúmulo quando uma nova remessa usa códigos diferentes.
 *
 * @param manterAntigas  se true, as customizadas anteriores são mantidas
 *                       (modo "adicionar", útil para complementar)
 */
export function substituirLoteTabelas(
  conv: Convenio,
  novas: TabelaFator[],
  manterAntigas = false,
  usuarioId = usuarioCoeficientesAtual
): ResultadoSubstituicao {
  const anteriores = lerDelta(conv, usuarioId);
  const normalizadas = novas.map(normalizarTabela);

  let base: TabelaFator[];
  let removidas = 0;
  const codigosRemovidos: string[] = [];

  if (manterAntigas) {
    // Mantém as antigas; as novas sobrescrevem quando o código coincide
    base = [...anteriores];
    for (const nova of normalizadas) {
      const i = base.findIndex(t => t.codigo === nova.codigo);
      if (i >= 0) base[i] = nova;
      else base.push(nova);
    }
  } else {
    // ✅ Substituição limpa: descarta todas as customizadas anteriores
    const codigosNovos = new Set(normalizadas.map(t => t.codigo));
    anteriores.forEach(t => {
      if (!codigosNovos.has(t.codigo)) { removidas++; codigosRemovidos.push(t.codigo); }
    });
    base = normalizadas;
  }

  // Deduplica por código (proteção extra contra entradas repetidas no lote)
  const porCodigo = new Map<string, TabelaFator>();
  base.forEach(t => porCodigo.set(t.codigo, t));
  const finais = [...porCodigo.values()];

  salvarDelta(conv, finais, usuarioId);
  // Reconstrói o conjunto ativo: oficiais de fábrica + customizadas atuais
  if (usuarioId === usuarioCoeficientesAtual) TABELAS[conv] = aplicarCustomizadas(conv, usuarioId);

  const codigosAnteriores = new Set(anteriores.map(t => t.codigo));
  const substituidas = finais.filter(t => codigosAnteriores.has(t.codigo)).length;
  const adicionadas = finais.length - substituidas;

  return { adicionadas, substituidas, removidas, codigosRemovidos };
}

/**
 * Recoloca os fatores de uma tabela em novos prazos (na ordem em que
 * aparecem em cada linha). Usado para corrigir importações em que os
 * fatores foram associados ao prazo errado.
 *
 * Ex.: tabela com fatores em {96: x} e novosPrazos [108]  →  {108: x}
 */
export function remapearPrazos(conv: Convenio, codigo: string, novosPrazos: number[], usuarioId = usuarioCoeficientesAtual): boolean {
  const arr = usuarioId === usuarioCoeficientesAtual ? TABELAS[conv] : aplicarCustomizadas(conv, usuarioId);
  const idx = arr.findIndex(t => t.codigo === codigo);
  if (idx < 0 || !novosPrazos.length) return false;

  const original = arr[idx];
  const nova: TabelaFator = {
    ...original,
    prazos: [...novosPrazos].sort((a, b) => a - b),
    linhas: original.linhas.map(l => {
      // Valores dos fatores na ordem crescente do prazo antigo
      const valores = Object.keys(l.fatores)
        .map(Number)
        .sort((a, b) => a - b)
        .map(p => l.fatores[p]);
      const fatores: Record<number, number> = {};
      novosPrazos.forEach((p, i) => {
        if (valores[i] !== undefined) fatores[p] = valores[i];
      });
      return { ...l, fatores };
    }),
  };

  arr[idx] = nova;
  // Persiste no delta (mesmo para tabela oficial: vira customizada)
  const delta = lerDelta(conv, usuarioId);
  const dIdx = delta.findIndex(t => t.codigo === codigo);
  if (dIdx >= 0) delta[dIdx] = nova;
  else delta.push(nova);
  salvarDelta(conv, delta, usuarioId);
  if (usuarioId === usuarioCoeficientesAtual) TABELAS[conv] = aplicarCustomizadas(conv, usuarioId);
  return true;
}

/**
 * Remove uma tabela do convênio (customizada OU nativa).
 * Quando for nativa, a tabela é adicionada ao delta com flag de remoção
 * para que ela não reapareça ao recarregar.
 */
export function removerTabela(conv: Convenio, codigo: string, usuarioId = usuarioCoeficientesAtual): boolean {
  const arr = usuarioId === usuarioCoeficientesAtual ? TABELAS[conv] : aplicarCustomizadas(conv, usuarioId);
  const idx = arr.findIndex(t => t.codigo === codigo);
  if (idx < 0) return false;
  const removida = arr[idx];
  arr.splice(idx, 1);

  const delta = lerDelta(conv, usuarioId).filter(t => t.codigo !== codigo);

  if (removida.oficial) {
    // Persiste um marcador "removida" no delta, com lista de linhas vazia,
    // para que aplicarCustomizadas saiba que ela foi excluída intencionalmente.
    delta.push({ ...removida, oficial: false, linhas: [], prazos: [], _removida: true } as any);
  }

  salvarDelta(conv, delta, usuarioId);
  if (usuarioId === usuarioCoeficientesAtual) TABELAS[conv] = aplicarCustomizadas(conv, usuarioId);
  return true;
}

/** Diagnóstico: lista as tabelas do convênio com seus prazos e nº de linhas */
export function resumoTabelas(conv: Convenio, usuarioId = usuarioCoeficientesAtual): Array<{
  codigo: string; nome: string; prazos: number[]; linhas: number; oficial: boolean;
  /** Prazos que realmente possuem fator na primeira linha */
  prazosComFator: number[];
  /** Primeiras datas-base (para conferir o formato) */
  amostraDatas: string[];
  /** Amostra dos fatores da primeira linha */
  amostraFatores: Record<number, number>;
}> {
  return aplicarCustomizadas(conv, usuarioId).map(t => {
    const primeira = t.linhas[0];
    const prazosComFator = primeira
      ? Object.keys(primeira.fatores).map(Number).filter(p => primeira.fatores[p] > 0).sort((a, b) => a - b)
      : [];
    return {
      codigo: t.codigo,
      nome: t.nome,
      prazos: t.prazos,
      linhas: t.linhas.length,
      oficial: t.oficial,
      prazosComFator,
      amostraDatas: t.linhas.slice(0, 3).map(l => l.dataBase),
      amostraFatores: primeira ? primeira.fatores : {},
    };
  });
}

export function obterTabela(conv: Convenio, codigo: string, usuarioId = usuarioCoeficientesAtual): TabelaFator | undefined {
  return aplicarCustomizadas(conv, usuarioId).find(t => t.codigo === codigo);
}

/**
 * Verifica quais tabelas do convênio atendem uma data-base + prazo.
 * Serve para diagnosticar por que uma tabela não aparece na Portabilidade.
 */
export function diagnosticarCobertura(conv: Convenio, dataBase: string, prazo: number): Array<{
  codigo: string; temData: boolean; temFator: boolean; motivo: string;
}> {
  const iso = normalizarDataISO(dataBase);
  return TABELAS[conv].map(t => {
    const linha = t.linhas.find(l => normalizarDataISO(l.dataBase) === iso);
    const fator = linha?.fatores?.[prazo];
    return {
      codigo: t.codigo,
      temData: !!linha,
      temFator: !!fator,
      motivo: !linha
        ? `sem a data ${iso}`
        : !fator
          ? `sem fator para ${prazo} meses`
          : 'ok',
    };
  });
}

export const CONVENIOS: {
  id: Convenio;
  nome: string;
  icone: string;
  oficial: boolean;
}[] = [
  { id: 'governo', nome: 'Governo', icone: '🏛️', oficial: true },
  { id: 'siape', nome: 'SIAPE', icone: '🏢', oficial: true },
  { id: 'inss', nome: 'INSS', icone: '👴', oficial: true },
];

export function datasDisponiveis(convenio: Convenio): string[] {
  return datasComInfo(convenio).map((d) => d.data);
}

export interface DataInfo {
  data: string;
  projetada: boolean;
}

/**
 * Agrega as datas-base de TODAS as tabelas do convênio (não só da primeira).
 * Assim, tabelas importadas com datas próprias aparecem no seletor.
 * Uma data só é marcada como "projetada" se for projetada em todas as tabelas.
 */
export function datasComInfo(convenio: Convenio): DataInfo[] {
  const mapa = new Map<string, boolean>(); // data -> projetada
  TABELAS[convenio].forEach((t) =>
    t.linhas.forEach((l) => {
      const proj = !!l.projetada;
      // false (oficial) tem prioridade sobre true (projetada)
      mapa.set(l.dataBase, mapa.has(l.dataBase) ? (mapa.get(l.dataBase)! && proj) : proj);
    })
  );
  return [...mapa.entries()]
    .map(([data, projetada]) => ({ data, projetada }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

export function ehProjetada(convenio: Convenio, data: string): boolean {
  const info = datasComInfo(convenio).find((d) => d.data === data);
  return !!info?.projetada;
}

export function prazosDisponiveis(convenio: Convenio): number[] {
  const set = new Set<number>();
  TABELAS[convenio].forEach((t) => t.prazos.forEach((p) => set.add(p)));
  return [...set].sort((a, b) => a - b);
}

/** Exibe a data em DD/MM/AAAA (aceita ISO ou já em formato BR) */
export function formatarData(data: string): string {
  if (!data) return '';
  const iso = normalizarDataISO(data);
  const [a, m, d] = iso.split('-');
  return d && m && a ? `${d}/${m}/${a}` : data;
}
