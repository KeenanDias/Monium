Aurora Landing — Handoff Plan

1. Tech stack to replicate
   Concern Package Why
   Framework Next.js 16+ App Router Server Components + Lenis works cleanly here
   Smooth scroll lenis (~5KB) Industry standard for the "fly-through" feel
   Scroll-linked animation framer-motion useScroll + useTransform + useSpring
   Icons lucide-react Stroke-based, theme-aware
   Charts (if you keep dashboard previews) recharts
   Confetti canvas-confetti Fired on goal completion
   Install: npm i lenis framer-motion next-themes lucide-react

2. Smooth scrolling — the exact recipe
   Mount once at the root (e.g. in app/layout.tsx) inside <body>:

// components/lenis-provider.tsx
"use client"
import { useEffect } from "react"
import Lenis from "lenis"

declare global { interface Window { \_\_lenis?: Lenis } }

export function LenisProvider() {
useEffect(() => {
if (typeof window === "undefined") return
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    })
    window.__lenis = lenis

    let frame = 0
    const raf = (t: number) => { lenis.raf(t); frame = requestAnimationFrame(raf) }
    frame = requestAnimationFrame(raf)
    return () => { cancelAnimationFrame(frame); lenis.destroy(); delete window.__lenis }

}, [])
return null
}
Gotcha #1 — modals: Lenis hijacks the wheel event, so body { overflow: hidden } doesn't actually pause it. When you open a modal, call window.**lenis?.stop(); on close, window.**lenis?.start().

Gotcha #2 — nested scroll: any scrollable container inside a modal needs data-lenis-prevent attribute so Lenis releases that wheel range.

Gotcha #3 — SSR: gate any starfield / Math.random visuals behind a mounted flag, or you hit hydration mismatches.

3. Scroll-linked animation pattern (used in every scene)

const containerRef = useRef<HTMLDivElement>(null)
const { scrollYProgress } = useScroll({
target: containerRef,
offset: ["start start", "end end"],
})
// Smooth the raw scroll so transforms aren't jittery
const smooth = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.4 })

// Drive any value off `smooth`:
const opacity = useTransform(smooth, [0, 0.5, 1], [1, 1, 0])
const y = useTransform(smooth, [0, 1], [0, -200])
Each "scene" wraps in a tall <section className="relative h-[150vh]"> and uses sticky top-0 h-screen for the content inside — so the scroll bar drives the animation while the content stays pinned.

4. Page architecture — the "5-scene fly-through"
   The landing is one tall scroll container with five stacked scenes. Globally:

Background starfield (3 parallax z-depths) drifts via useTransform(scroll, [0,1], [0, 1500])
Mesh gradient blobs in emerald/teal/violet fade in and out across the scroll
Last scene morphs the theme dark → light for an "Arctic Dawn" CTA payoff
Scene 1 — Guardian / Hero
Headline: "Your AI financial coach — for paychecks that don't look like everyone else's."
Sub: Built for gig workers, freelancers, and anyone with irregular income. Aurora answers one question: how much can I safely spend today?
CTA: "Create your account" → /sign-up
Visual: large gradient orb (emerald → teal → violet), stars, "your daily Safe-to-Spend" number ticking
Scene 2 — Vault (Constellation of Trust)
Headline: "Your money's vault — encrypted, yours alone."
Body: AES-256-GCM encrypted PDF bank statements. Versioned keys. Stored in Supabase Storage, not your column logs. Nothing leaves your account.
Visual: an animated "vault" with constellation lines connecting trust pillars (encryption, never-sold, never-shared, deletable any time).
Scene 3 — Pulse (Streaks + Escrow)
Headline: "Stay under your daily limit. Build the streak. Sleep at night."
Body:
Budget Streak: every day you stay under your Daily Safe-to-Spend, the streak counts up. Tomorrow the daily-nudge cron tells you if yesterday went over.
Escrow: bills due in the next 7 days are protected upfront. Your daily limit reflects what's actually safe to spend, not what's still in the account.
Visual: animated flame (the streak), animated lock (escrow), with the daily number dropping when escrow kicks in.
Scene 4 — Chat (Cleo-style auto-typing)
Headline: "Just ask. Aurora knows your money."
Visual: a live-typing chat between user and Aurora demonstrating:
"Can I buy these $80 sneakers?" → Aurora checks STS, escrow, weekly velocity, gives a yes/no with the why
"Save $5000 for a car by December" → scripted ADD_GOAL flow with auto-detect of dates + amounts
"I just spent $40 on dinner" → logs a manual transaction, refreshes STS
Body: Aurora's chat is the product — not a feature. The chatbot triggers BroadcastChannel events that refresh dashboard metrics live across tabs.
Scene 5 — Arctic Dawn CTA
Theme morph: as the user scrolls into the final scene, the dark theme fades to light (the Arctic Dawn). Emotional payoff: the night is over, your money makes sense now.
Headline: "Start in under a minute."
Sub: Create your account and you're straight into the dashboard — no waitlist.
Form: name + email → bounces to /sign-up with both fields prefilled via URL params (?email_address=…&first_name=…). 5. Product facts every section can reference
The "one number" (Daily Safe-to-Spend)
The core promise. Math:

monthlyAvailable = monthlyIncome
− fixedBills
− totalMonthlyGoalBite // sum across enrolled goals
− safetyBuffer
− weightedEscrowBite // bills due in next 7 days
dailySafeToSpend = (monthlyAvailable − spentThisMonth) / daysRemainingInMonth
Edge cases:

isLowLiquidity: when spendableCash < $20, flag UI red
isPlaceholder: shown until user has either a bank link OR vault upload
Goal completion: when a goal is hit, its goalBite drops to $0 and the freed money returns to daily STS (with confetti)
Income selection (conservative)
Trust self-reported income by default
Only "upgrade" to observed income (from bank deposits) if it falls within 80–200% of self-reported (sanity band)
Vault statements normalize: a 33-day statement is ~1.085 months, a 90-day statement is ~3 months. Income is divided by the canonical span × 30.44 to get the monthly rate
Last-resort: cap at min(spending × 1.2, $2000) so the dashboard doesn't show $0
Goals
Multi-goal lineup with active enrollment toggle. Only enrolled goals bite into STS.
Plaid-verified savings: when a goal contribution is logged, Aurora looks for a transfer (checking → savings) in the last 72h. Match found → "verified." Otherwise it checks if savings balance grew by ≥ 90% of the contribution → "probable." Otherwise "pending."
Milestone timeline with confetti at 25/50/75/100%
Weighted escrow ramp: as a bill gets closer to due date, its bite into STS ramps up over the last 7 days instead of dropping suddenly on day 1
Budget Streak
Spent_d ≤ DailySTS_d for every day → streak counts up
Caps at min(60, days since user signed up) so Plaid sandbox's 2-year-old transactions can't inflate it
"Cooling down" visual state when today is already over budget but the historical streak isn't broken yet
Bank linking (current beta status)
Plaid: production access pending. Sandbox + Vault PDF are the working paths for the beta.
Vault PDF: upload bank statement → parser extracts transactions, balances, fixed bills. Multiple statements aggregate via greedy non-overlap (newest-first); 3 months of statements behave like 3 months of data instead of just the most recent.
Categories: rendered from either Plaid feed OR vault transactions, filtered to exclude transfers/credit-card/loan-payments so the donut total reconciles with "spent this month."
Notifications
Daily nudge SMS (Twilio): fires when projected discretionary spending (velocity × days-in-month) > monthly available. Dedup'd via last_predictive_nudge_date so the user isn't pestered daily.
Email (Resend): approval emails, denial emails. Falls back to manual when domain isn't verified yet.
Security / trust talking points
AES-256-GCM with key versioning (rotate keys, old data still decrypts)
Vault statements stored in Supabase Storage (encrypted bytes), not the row itself
Service-role keys never touch the browser
Clerk handles all auth; we never store passwords
User can delete account from settings — Supabase row + Clerk user + storage objects all cascade 6. Color system + visual language

--aurora-emerald: #34d399
--aurora-teal: #2dd4bf
--aurora-violet: #818cf8
--aurora-amber: #fbbf24 /_ used for streak flames + escrow locks _/
--obsidian-sky: #020617 /_ dark mode page bg _/
Visual motifs to keep:

Northern Lights gradient (emerald → teal → violet) on every primary CTA
Glass cards: bg-background/60 backdrop-blur-md border-border rounded-2xl
Animated stars (canvas, drifting, parallax 3 z-depths)
Flame for streaks, lock for escrow, sparkles for "open beta"
Heading shadow: text-shadow: 0 0 30px rgba(20, 184, 166, 0.25) (cyan halo) 7. Copy bank (steal verbatim or remix)
Hero: "Your money, in a new light."
Sub: "Aurora is the AI financial coach built for the way you actually earn — variable, gig-based, freelance, hustle."
The promise: "One number that tells you how much you can spend today without breaking your monthly plan."
STS card label: "Daily Safe-to-Spend"
Vault: "Encrypted in your private vault. We don't sell it, share it, or look at it."
Streak: "Stay under today. Watch the streak grow."
Chat: "Just ask Aurora. It knows your money."
CTA: "Start in under a minute" / "Create your account →"
Footer trust line: "Read-only access via Plaid · We never see your password · Delete your data anytime" 8. Things to remove / rebuild in the new project
The current waitlist form + access_requests flow can be cut — the new direction is sign-up-direct.
The BETA_OPEN=true env flag in lib/access-control.ts auto-approves on first sign-in; mirror that in the new project.
The "50 spots" / "closed beta" badges should become "Beta is live · sign up free" or whatever your new positioning is.
Anything Plaid-related on the landing should currently say "live bank sync coming soon" since production access isn't approved yet — push Vault PDF as the primary onboarding step. 9. What to verify after rebuild
Scroll feels buttery on a real machine (Lenis duration ~1.1 is the sweet spot)
prefers-reduced-motion short-circuits Lenis (accessibility — already in the snippet)
Theme morph at the bottom uses next-themes not a hard CSS flip
The starfield is canvas-based, not 50+ DOM <div>s with random positions (kills perf + hydrates badly)
CTA form prefills ?email_address=&first_name= into Clerk's sign-up route
