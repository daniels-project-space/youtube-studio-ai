import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ChannelDurationDraft } from "./ChannelDurationDraft";

function Fixture() {
  const [owner, setOwner] = useState(true);
  const [revision, setRevision] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [channel, setChannel] = useState("fixture-channel");
  return <><button onClick={() => setOwner(value => !value)}>Toggle owner access</button><button onClick={() => setRefresh(value => value + 1)}>Refresh unrelated data</button><button onClick={() => setRevision(value => value + 1)}>Change baseline</button><button onClick={() => setChannel("other-channel")}>Switch channel</button><span>{refresh}</span><ChannelDurationDraft key={channel} channelId={channel} baselineRevision={String(revision)} canRequest={owner} onRequestOwner={() => {}} /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
