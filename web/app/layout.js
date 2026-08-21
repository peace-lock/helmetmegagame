import { IBM_Plex_Mono, Source_Sans_3, Source_Serif_4, UnifrakturMaguntia } from "next/font/google";
import "./globals.css";
import { getOpenTurn } from "@/lib/turn";
import { resolveTheme } from "@/lib/turnFormat";
import TagsProvider from "./components/TagsProvider";
import ProductionRatesProvider from "./components/ProductionRatesProvider";
import ConfirmProvider from "./components/ConfirmProvider";

// Body/UI face. Pairs with Source Serif 4 as a designed superfamily.
const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Data only now (numbers, dice, IDs, audit rows), not body text — so 700 is
// dropped: nothing sets bold mono, and each weight is another font payload.
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const display = UnifrakturMaguntia({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata = {
  title: "Lifeweb",
  description: "Lifeweb — a barony amid the wasteland.",
};

// Theme/turn state is live game state fetched per-request, not something
// that should be statically prerendered (and prerendering would try to hit
// the database at build time, when it isn't reachable).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }) {
  const turn = await getOpenTurn();
  // LIFEWEB_THEME pins the whole environment to one theme, which is the only
  // way to see "limestone" — no turn phase maps to it. Leave it unset in
  // production so the theme keeps tracking dawn/dusk.
  const theme = resolveTheme(turn?.phase, process.env.LIFEWEB_THEME);

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${sans.variable} ${mono.variable} ${serif.variable} ${display.variable} h-full`}
    >
      <body className="h-full">
        {/* Two fixed, non-interactive atmosphere layers behind everything.
            They replace the old .scanlines, which sat at 0.06 opacity and was
            effectively invisible. Both composite once and never animate —
            CLAUDE.md is explicit that this must not feel like a laggy bot
            dashboard. */}
        <div className="grain" />
        <div className="vignette" />
        <ConfirmProvider>
          <TagsProvider>
            <ProductionRatesProvider>{children}</ProductionRatesProvider>
          </TagsProvider>
        </ConfirmProvider>
      </body>
    </html>
  );
}
