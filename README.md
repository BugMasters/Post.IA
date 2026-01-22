This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Gemini validation

Export the API key in your shell (do not commit it):

```bash
export GEMINI_API_KEY="SUA_CHAVE_AQUI"
```

Como descobrir GEMINI_MODEL via ListModels:

```bash
curl -sS \
  "${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}/v1beta/models?key=${GEMINI_API_KEY}" \
  | jq -r '.models[]? | select(.supportedGenerationMethods | index("generateContent")) | .name'
```

Se der 404, rode ListModels e ajuste GEMINI_MODEL.

Comando ListModels usado no smoke test:

```bash
curl -sS "${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}/v1beta/models?key=${GEMINI_API_KEY}"
```

Using curl with the query param (same as the provider):

```bash
curl -sS \
  "${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}/v1beta/models/${GEMINI_MODEL:-gemini-2.0-flash-001}:generateContent?key=${GEMINI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Diga ola em uma frase curta."}]}]}'
```

Using curl with the `x-goog-api-key` header:

```bash
curl -sS \
  "${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}/v1beta/models/${GEMINI_MODEL:-gemini-2.0-flash-001}:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Diga ola em uma frase curta."}]}]}'
```

Internal smoke test:

```bash
node scripts/validate-gemini.mjs
```

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
