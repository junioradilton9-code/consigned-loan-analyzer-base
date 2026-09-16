// Marca d'água de sessão — identidade do usuário sobre toda a tela.
// Rastreia capturas de tela e desestimula a cópia.
// pointer-events:none → não interfere em nenhum clique.

export default function Watermark({ texto }: { texto: string }) {
  if (!texto) return null;
  const celulas = Array.from({ length: 120 }); // 10 × 12

  return (
    <div className="marca-dagua no-print" aria-hidden>
      {celulas.map((_, i) => (
        <span key={i}>{texto}</span>
      ))}
    </div>
  );
}
