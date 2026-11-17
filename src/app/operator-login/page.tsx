import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OperatorLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE !== "1") redirect("/");
  const { error } = await searchParams;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <section style={{ width: "min(100%, 25rem)" }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 700 }}>YouTube Studio AI</h1>
        <p>Sign in to open your private workshop.</p>
        {error ? <p role="alert">That password was not accepted. Please try again.</p> : null}
        <form action="/api/auth/local-login" method="post" style={{ display: "grid", gap: "1rem" }}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256}
            style={{ padding: "0.8rem", color: "#f8fafc", background: "#171c2c", border: "1px solid #59647d", borderRadius: "0.5rem" }} />
          <button type="submit" className="studio-action studio-action-primary">Sign in</button>
        </form>
      </section>
    </main>
  );
}
