export type FormatOption = "Apenas texto" | "Foto + texto" | "Apenas foto";

export interface BriefingSnapshot {
  goal: string;
  audience: string;
  audienceLevel: string;
  offer: string;
  differentiation: string;
  tone: string[];
  avoid: string[];
  cta: string;
}

export type PostVariant = {
  id: string;
  label: string;
  content: string;
};

const formatDescriptions: Record<FormatOption, string> = {
  "Apenas texto": "Texto limpo, pronto para publicação em feed ou thread.",
  "Foto + texto": "Legenda que acompanha uma imagem marcante.",
  "Apenas foto": "Foco na imagem com um comentário rápido e direto.",
};

const ctaClosings: Record<string, string> = {
  Comentar: "Peça para comentar o que mais ressoou.",
  Direct: "Convide a chamar no direct para próximos passos.",
  "Salvar/Compartilhar": "Sugira salvar ou compartilhar com alguém que precise desse insight.",
  Link: "Direcione a conferir o link e descobrir mais.",
  "Sem CTA": "Compartilhe livremente, sem pressionar por ação.",
};

const toneDescriptor = (tones: string[]) => {
  if (!tones.length) {
    return "Tom neutro e respeitoso";
  }

  if (tones.length === 1) {
    return `Tom ${tones[0].toLowerCase()}`;
  }

  return `Tom ${tones[0].toLowerCase()} e ${tones[1].toLowerCase()}`;
};

const audienceLevelDescriptors: Record<string, string> = {
  Leigo: "linguagem simples, exemplos do cotidiano e pouca maturidade técnica",
  Intermediário: "equilíbrio entre contexto estratégico e termos reconhecíveis",
  Técnico: "termos mais precisos, estruturas e dados que reforçam autoridade",
};

const audienceLevelSimplified: Record<string, string> = {
  Leigo: "clareza e analogias",
  Intermediário: "conexões com desafios reais",
  Técnico: "detalhes e passos bem definidos",
};

const buildAvoidLine = (avoid: string[]) =>
  avoid.length ? `Evito ${avoid.join(" e ").toLowerCase()}.` : "";

const ctaLine = (cta: string) => ctaClosings[cta] ?? `Faça a ação indicada: ${cta}.`;

const simplifyTone = (tone: string[]) => (tone.length ? tone.join(" e ").toLowerCase() : "tom natural");

export function generatePostVariants({
  theme,
  format,
  briefing,
}: {
  theme: string;
  format: FormatOption;
  briefing: BriefingSnapshot;
}): PostVariant[] {
  const toneIntro = toneDescriptor(briefing.tone);
  const audienceDescriptor =
    audienceLevelDescriptors[briefing.audienceLevel] ?? "voz clara";
  const avoidLine = buildAvoidLine(briefing.avoid);
  const simplifiedTone = simplifyTone(briefing.tone);
  const formatNote = formatDescriptions[format];
  const isAvoidingJargon = briefing.avoid.includes("Jargão");
  const baseCta = ctaLine(briefing.cta);

  const contextLines = [
    `${toneIntro}, com foco em ${briefing.audience} (${briefing.audienceLevel}).`,
    `${audienceDescriptor}.`,
    `${formatNote}`,
    avoidLine,
  ]
    .filter(Boolean)
    .join(" ");

  const variants: Array<{ id: string; label: string; build: () => string }> = [
    {
      id: "direct",
      label: "Direto",
      build: () =>
        [
          `Tema: ${theme}.`,
          `Meta: ${briefing.goal}.`,
          `Diferencial: ${briefing.differentiation}.`,
          `Oferta rápida: ${briefing.offer}.`,
          `Formato escolhido: ${format}.`,
          baseCta,
        ].join(" \n"),
    },
    {
      id: "story",
      label: "Storytelling",
      build: () =>
        [
          `Começo: ${briefing.audience} já cansou de ${theme.toLowerCase()} mal direcionado.`,
          `Virada: ${briefing.differentiation} mostrou que ${briefing.goal.toLowerCase()}.`,
          `Personagem: um profissional que valoriza ${briefing.offer.toLowerCase()} e busca ${theme.toLowerCase()}.`,
          `Lição: usei ${simplifiedTone} para ${theme.toLowerCase()} e a lição foi clara.`,
          baseCta,
        ].join(" "),
    },
    {
      id: "funny",
      label: "Engraçado",
      build: () =>
        [
          `Pausa: já tentou ${theme.toLowerCase()} enquanto o feed bombava de promessa vazia?`,
          `Reality check: ${briefing.differentiation.toLowerCase()} evita o drama e entrega ${briefing.offer.toLowerCase()}.`,
          `Tom: humor leve + ${simplifiedTone}.`,
          `${audienceLevelSimplified[briefing.audienceLevel] ?? "toques humanos"} para tirar o público do modo automático.`,
          baseCta,
        ].join(" "),
    },
    {
      id: "authority",
      label: "Autoridade",
      build: () =>
        [
          `Framework: 1) ${briefing.goal} com foco em ${theme.toLowerCase()} 2) ${briefing.differentiation} 3) ${briefing.offer}.`,
          `Detalho passos em ordem: 1) alinhar objetivo, 2) preparar ativo, 3) distribuir com ${contextLines.toLowerCase()}.`,
          baseCta,
        ].join(" "),
    },
    {
      id: "technical",
      label: "Técnico",
      build: () => {
        const detail = isAvoidingJargon
          ? "fluxos claros e exemplos práticos"
          : "KPIs medidos, APIs integradas e automações";
        return [
          `Explico ${theme.toLowerCase()} com ${detail}.`,
          `Audience: ${briefing.audience} (${briefing.audienceLevel}) exige ${audienceDescriptor}.`,
          `Ofereço ${briefing.offer} e ${briefing.differentiation} sem perder o ${toneIntro}.`,
          baseCta,
        ].join(" ");
      },
    },
    {
      id: "empathy",
      label: "Empático",
      build: () =>
        [
          `Entendo que ${briefing.audience.toLowerCase()} sente que ${theme.toLowerCase()} parece distante.`,
          `Solução: ${briefing.differentiation.toLowerCase()} entrega ${briefing.offer.toLowerCase()} com ${simplifiedTone}.`,
          `Promessa: ${briefing.goal} sem virar promessa vazia.${
            avoidLine ? " " + avoidLine : ""
          }`,
          baseCta,
        ].join(" "),
    },
  ];

  return variants.map((variant) => ({
    id: variant.id,
    label: variant.label,
    content: `${contextLines}\n\n${variant.build()}`.trim(),
  }));
}
