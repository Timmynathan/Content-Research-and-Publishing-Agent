import { useState } from "react";
import { addSourceUrl, pasteSource, ApiError } from "../lib/api";
import Field from "./ui/Field";
import Button from "./ui/Button";
import ErrorState from "./ui/ErrorState";

// Manager-only. Shown only before source selection has run (stage
// 'requested' or 'researching') — anything added here is picked up
// automatically by the next Claude selection pass, the same as an
// automatically-discovered source. This is the escape hatch for
// material the scraper can't reach: social posts, PDFs, paywalled
// articles, internal notes, interview transcripts.
export default function AddPasteSourceForms({
  requestId,
  onChanged,
}: {
  requestId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [addUrlValue, setAddUrlValue] = useState("");
  const [addUrlBusy, setAddUrlBusy] = useState(false);
  const [addUrlError, setAddUrlError] = useState<string | null>(null);

  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  async function handleAddUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!addUrlValue.trim()) return;
    setAddUrlBusy(true);
    setAddUrlError(null);
    try {
      await addSourceUrl(requestId, addUrlValue.trim());
      setAddUrlValue("");
      await onChanged();
    } catch (err) {
      setAddUrlError(err instanceof ApiError ? err.message : "Failed to add source.");
    } finally {
      setAddUrlBusy(false);
    }
  }

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setPasteBusy(true);
    setPasteError(null);
    try {
      await pasteSource(requestId, pasteText.trim(), pasteTitle.trim() || undefined);
      setPasteText("");
      setPasteTitle("");
      await onChanged();
    } catch (err) {
      setPasteError(err instanceof ApiError ? err.message : "Failed to add pasted source.");
    } finally {
      setPasteBusy(false);
    }
  }

  return (
    <div className="stack stack-sm">
      <details>
        <summary style={{ fontSize: 13, fontWeight: 500 }}>Add a source (paste a URL)</summary>
        <form onSubmit={handleAddUrl} className="row" style={{ marginTop: 8 }}>
          <input
            type="url"
            className="ui-input"
            value={addUrlValue}
            onChange={(e) => setAddUrlValue(e.target.value)}
            placeholder="https://…"
            style={{ flex: 1 }}
            required
          />
          <Button type="submit" variant="secondary" loading={addUrlBusy}>
            Add
          </Button>
        </form>
        {addUrlError && (
          <div style={{ marginTop: 6 }}>
            <ErrorState message={addUrlError} />
          </div>
        )}
      </details>

      <details>
        <summary style={{ fontSize: 13, fontWeight: 500 }}>
          Paste source material (for anything the scraper can't reach)
        </summary>
        <form onSubmit={handlePaste} className="stack stack-sm" style={{ marginTop: 8 }}>
          <Field label="Title (optional)" htmlFor="paste-title">
            <input
              id="paste-title"
              className="ui-input"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="e.g. Client interview notes"
            />
          </Field>
          <Field label="Text" htmlFor="paste-text">
            <textarea
              id="paste-text"
              className="ui-textarea"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste the article, post, or notes text here…"
              style={{ minHeight: 120 }}
              required
            />
          </Field>
          <div>
            <Button type="submit" variant="secondary" loading={pasteBusy}>
              Add pasted source
            </Button>
          </div>
        </form>
        {pasteError && (
          <div style={{ marginTop: 6 }}>
            <ErrorState message={pasteError} />
          </div>
        )}
      </details>
    </div>
  );
}
