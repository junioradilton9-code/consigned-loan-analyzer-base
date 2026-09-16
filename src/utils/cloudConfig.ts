// ═══════════════════════════════════════════════════════════════════
//  CONEXÃO COM O BANCO NA NUVEM (Supabase)
//
//  👉 É AQUI QUE VOCÊ COLOCA SUA CONEXÃO PARA OS DADOS FICAREM
//     SALVOS EM TODAS AS MÁQUINAS / NAVEGADORES.
//
//  SEM isso, cada navegador guarda os dados só nele (e você perde
//  ao abrir em outro lugar).
//
//  COMO PREENCHER (uma única vez):
//   1. Crie um projeto grátis em https://supabase.com
//   2. Em "SQL Editor", cole e execute o arquivo  supabase-schema.sql
//   3. Vá em  Project Settings → API  e copie:
//        - Project URL   → cole em SUPABASE_URL abaixo
//        - anon public   → cole em SUPABASE_ANON_KEY abaixo
//   4. Salve e faça o deploy novamente.
//
//  ALTERNATIVA (sem editar código): no Netlify, defina as variáveis
//  de ambiente  VITE_SUPABASE_URL  e  VITE_SUPABASE_ANON_KEY.
//  O app lê o ambiente antes deste arquivo.
// ═══════════════════════════════════════════════════════════════════

export interface CloudConfig {
  url: string;
  anonKey: string;
  ativo: boolean;
}

// ✅ CONEXÃO EMBUTIDA — compartilhada entre todas as máquinas/navegadores.
// O app conecta automaticamente em qualquer computador, sem precisar
// configurar nada na interface.
export const SUPABASE_URL: string = 'https://tnzwlbrqzgxadczyviqo.supabase.co';

export const SUPABASE_ANON_KEY: string = 'sb_publishable_5r0LjqXAI7Qt0lGYeTMRrg_H363KAE-';

/** Configuração embutida no código (compartilhada entre todas as máquinas) */
export function configDoArquivo(): CloudConfig {
  const url = (SUPABASE_URL || '').trim();
  const key = (SUPABASE_ANON_KEY || '').trim();
  return { url, anonKey: key, ativo: !!(url && key) };
}

/** Indica de onde a conexão veio — para mostrar status na tela */
export type OrigemConfig = 'ambiente' | 'arquivo' | 'navegador' | 'nenhuma';
