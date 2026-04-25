<!-- BEGIN:nextjs-agent-rules -->
# Next.js 14 Pages Router

This project uses Next.js 14 with the Pages Router (NOT the App Router). Key rules:
- All routes and pages live in `pages/`, not `app/`
- Router hook is `useRouter` from `next/router`, NOT `next/navigation`
- API routes use `(req: NextApiRequest, res: NextApiResponse)` handler pattern
- `<Link>` does NOT need an `<a>` child — just `<Link href="...">text</Link>`
- No `"use client"` or `"use server"` directives — all components are client-rendered
<!-- END:nextjs-agent-rules -->
