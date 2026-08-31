"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ChannelRow } from "@/lib/types";
import { ChannelAvatar } from "./ChannelArt";
import { useOperationsAccess } from "./OperationsAccess";
import { useOwnerId } from "@/lib/owner-context";
import styles from "./ChannelFolderWorkspace.module.css";

type FolderRow = { _id: string; name: string };
type FolderChannel = ChannelRow & { folder?: string };

export function ChannelFolderWorkspace({
  channels,
  folders,
  selectedFolder,
  onSelect,
}: {
  channels: FolderChannel[];
  folders: FolderRow[];
  selectedFolder: string | null;
  onSelect: (name: string | null) => void;
}) {
  const ownerId = useOwnerId();
  const access = useOperationsAccess();
  const createFolder = useMutation(api.folders.create);
  const renameFolder = useMutation(api.folders.rename);
  const removeFolder = useMutation(api.folders.remove);
  const updateChannel = useMutation(api.channels.updateChannel);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canEdit = access === "owner";

  const members = (name: string) => channels.filter((channel) => channel.folder === name);

  async function create() {
    const name = draftName.trim();
    if (!name || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await createFolder({ ownerId, name });
      setDraftName("");
      setCreateOpen(false);
      onSelect(name);
    } catch {
      setMessage("The folder could not be created. Owner editing may need to be enabled.");
    } finally {
      setBusy(false);
    }
  }

  async function rename(folder: FolderRow) {
    const name = renameDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await renameFolder({
        ownerId,
        folderId: folder._id as Id<"channelFolders">,
        name,
      });
      if (selectedFolder === folder.name) onSelect(name);
      setEditingId(null);
      setRenameDraft("");
    } catch {
      setMessage("The folder could not be renamed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(folder: FolderRow) {
    if (busy) return;
    if (armedRemove !== folder._id) {
      setArmedRemove(folder._id);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await removeFolder({
        ownerId,
        folderId: folder._id as Id<"channelFolders">,
      });
      if (selectedFolder === folder.name) onSelect(null);
      setArmedRemove(null);
    } catch {
      setMessage("The folder could not be removed. Its channels were not changed.");
    } finally {
      setBusy(false);
    }
  }

  async function dropChannel(event: React.DragEvent, folderName: string | null) {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData("text/channel-id");
    if (!id || !canEdit) return;
    setBusy(true);
    setMessage(null);
    try {
      await updateChannel({ channelId: id as Id<"channels">, folder: folderName ?? "" });
    } catch {
      setMessage("The channel could not be moved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.workspace} aria-labelledby="channel-folders-title">
      <header className={styles.header}>
        <div>
          <span>Fleet organization</span>
          <h2 id="channel-folders-title">Channel rooms</h2>
          <p>Group related shows without changing their pipeline, schedule, or YouTube destination.</p>
        </div>
        <button
          type="button"
          className="studio-button"
          data-variant="quiet"
          disabled={!canEdit || busy}
          title={canEdit ? "Create a channel room" : "Enable owner editing to create folders"}
          onClick={() => setCreateOpen((open) => !open)}
        >
          <FolderGlyph /> New room
        </button>
      </header>

      {createOpen ? (
        <form className={styles.inlineForm} onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label htmlFor="new-channel-folder">Room name</label>
          <input id="new-channel-folder" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={40} autoFocus />
          <button type="submit" className="studio-button" disabled={!draftName.trim() || busy}>Create room</button>
          <button type="button" className="studio-button" data-variant="quiet" onClick={() => { setCreateOpen(false); setDraftName(""); }}>Cancel</button>
        </form>
      ) : null}

      <div className={styles.shelf}>
        <button
          type="button"
          className={styles.allRoom}
          aria-pressed={selectedFolder === null}
          data-drag-over={dragOver === "__all" ? "true" : undefined}
          onClick={() => onSelect(null)}
          onDragOver={(event) => { event.preventDefault(); setDragOver("__all"); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(event) => void dropChannel(event, null)}
        >
          <span className={styles.folderMark} aria-hidden="true"><AllGlyph /></span>
          <span><strong>All channels</strong><small>Complete fleet</small></span>
          <i>{channels.length}</i>
        </button>

        {folders.map((folder) => {
          const roomChannels = members(folder.name);
          const editing = editingId === folder._id;
          return (
            <article
              key={folder._id}
              className={styles.room}
              data-selected={selectedFolder === folder.name ? "true" : undefined}
              data-drag-over={dragOver === folder.name ? "true" : undefined}
              onDragOver={(event) => { event.preventDefault(); setDragOver(folder.name); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => void dropChannel(event, folder.name)}
            >
              {editing ? (
                <form className={styles.renameForm} onSubmit={(event) => { event.preventDefault(); void rename(folder); }}>
                  <input aria-label={`Rename ${folder.name}`} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={40} autoFocus />
                  <button type="submit" disabled={!renameDraft.trim() || busy}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <button type="button" className={styles.roomMain} onClick={() => onSelect(selectedFolder === folder.name ? null : folder.name)} aria-pressed={selectedFolder === folder.name}>
                    <span className={styles.folderMark} aria-hidden="true"><FolderGlyph /></span>
                    <span className={styles.roomCopy}><strong>{folder.name}</strong><small>{roomChannels.length ? `${roomChannels.length} ${roomChannels.length === 1 ? "channel" : "channels"}` : "Ready for a channel"}</small></span>
                    <span className={styles.avatars} aria-hidden="true">
                      {roomChannels.slice(0, 3).map((channel) => (
                        <ChannelAvatar key={channel._id} imageKey={channel.identity?.imageKey} name={channel.name} palette={channel.identity?.palette} size={24} radius={7} />
                      ))}
                    </span>
                  </button>
                  {canEdit ? (
                    <details className={styles.roomMenu}>
                      <summary aria-label={`Manage ${folder.name}`}>•••</summary>
                      <div>
                        <button type="button" onClick={() => { setEditingId(folder._id); setRenameDraft(folder.name); setArmedRemove(null); }}>Rename</button>
                        <button type="button" data-danger={armedRemove === folder._id ? "true" : undefined} onClick={() => void remove(folder)}>
                          {armedRemove === folder._id ? "Confirm remove" : "Remove room"}
                        </button>
                        {armedRemove === folder._id ? <small>Channels will return to All channels.</small> : null}
                      </div>
                    </details>
                  ) : null}
                </>
              )}
            </article>
          );
        })}
      </div>
      <p className={styles.hint}>Drag a card into a room, or use its Manage panel on touch and keyboard devices.</p>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </section>
  );
}

function FolderGlyph() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h4l1.2 1.4H14v6.6H2v-8Z" stroke="currentColor" strokeWidth="1.2"/><path d="M2 7h12" stroke="currentColor" strokeWidth="1.2"/></svg>;
}

function AllGlyph() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2"/></svg>;
}
