const RENDER_ENGINE_URL = "https://render-engine-sable.vercel.app/";

/** Studio owns planning and frozen inputs. Render Engine owns render routing and progress. */
export default function RenderEnginePage() {
  return (
    <main>
      <h1>Render Engine</h1>
      <p>Queued render work and fleet progress are shown in Render Engine.</p>
      <p><a href={RENDER_ENGINE_URL}>Open Render Engine</a></p>
    </main>
  );
}
