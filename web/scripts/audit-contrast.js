// WCAG AA gate for the design tokens in web/app/globals.css.
//
// Run with `npm run audit:contrast --workspace=web`. It parses the token
// values straight out of the stylesheet rather than duplicating them here, so
// it can never drift from what the app actually ships — edit a colour, re-run
// this, and it tells you what you broke.
//
// Two rules are the ones people break by accident:
//
//   * The surface ladder. --bg -> --surface -> --surface-raised must keep
//     ~1.20 contrast per step or .panel stops reading as a container. The one
//     documented exception is a light theme whose --surface is already
//     near-white: there is no headroom above it, so the raised tier is carried
//     by --e-3 shadow instead. See the limestone block in globals.css.
//   * --accent vs --accent-text. Text and outlines must use --accent-text;
//     --accent is a fill. Collapsing them back into one token is what made
//     every button in the app fail AA.

const fs = require("fs");
const path = require("path");

const CSS_PATH = path.join(__dirname, "..", "app", "globals.css");
const THEMES = ["dusk", "dawn", "limestone"];

const AA = 4.5; // WCAG AA, normal-size text
const LADDER_MIN = 1.2; // per-step surface separation
const BORDER_MIN = 1.9; // hairline vs the surface it sits on
const NEAR_WHITE = 0.85; // relative luminance above which raised is shadow-carried

function parseColor(value) {
  if (value.startsWith("#")) {
    const h = value.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)), a: 1 };
  }
  const inner = value.match(/rgba?\(([^)]+)\)/);
  if (!inner) return null;
  const parts = inner[1].split(",").map((s) => parseFloat(s.trim()));
  return { rgb: parts.slice(0, 3), a: parts[3] === undefined ? 1 : parts[3] };
}

// Flatten a translucent colour onto an opaque backdrop. Borders and field
// backgrounds are rgba, so comparing them raw would report nonsense.
function composite(fg, backdropRgb) {
  return fg.rgb.map((v, i) => v * fg.a + backdropRgb[i] * (1 - fg.a));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function readTokens(css, theme) {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`No [data-theme="${theme}"] block in globals.css`);
  const tokens = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function main() {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  let failures = 0;

  for (const theme of THEMES) {
    const t = readTokens(css, theme);
    const bg = parseColor(t["--bg"]).rgb;
    const surface = parseColor(t["--surface"]).rgb;
    const raised = parseColor(t["--surface-raised"]).rgb;

    const results = [];
    const gate = (label, actual, min) => {
      const ok = actual >= min;
      if (!ok) failures += 1;
      results.push(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(31)}${actual.toFixed(2)}  (min ${min})`);
    };

    gate("bg -> surface", contrast(bg, surface), LADDER_MIN);

    if (luminance(surface) > NEAR_WHITE) {
      results.push(
        `  n/a   ${"surface -> surface-raised".padEnd(31)}${contrast(surface, raised).toFixed(2)}  (shadow-carried: surface is near-white)`,
      );
    } else {
      gate("surface -> surface-raised", contrast(surface, raised), LADDER_MIN);
    }

    gate("border vs surface", contrast(composite(parseColor(t["--border"]), surface), surface), BORDER_MIN);

    for (const token of ["--text", "--muted", "--accent-text", "--danger", "--positive", "--warning"]) {
      gate(`${token} on surface`, contrast(composite(parseColor(t[token]), surface), surface), AA);
    }

    gate(
      "--on-accent on --accent-solid",
      contrast(parseColor(t["--on-accent"]).rgb, parseColor(t["--accent-solid"]).rgb),
      AA,
    );

    console.log(`\n=== ${theme} ===`);
    console.log(results.join("\n"));
  }

  if (failures) {
    console.error(`\n${failures} contrast gate(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll contrast gates hold.");
}

main();
