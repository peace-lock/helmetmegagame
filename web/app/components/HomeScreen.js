import { signInWithDiscord } from "../actions";

export default function HomeScreen({ turnLabel }) {
  return (
    <main className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center">
        <h1 className="wordmark text-5xl tracking-widest sm:text-6xl">Lifeweb</h1>
        <div className="wordmark-rule my-3" />
        <p className="text-sm tracking-[0.2em] uppercase text-muted">
          {turnLabel}
        </p>
      </div>

      <form action={signInWithDiscord}>
        <button type="submit" className="btn">
          Sign in with Discord
        </button>
      </form>
    </main>
  );
}
