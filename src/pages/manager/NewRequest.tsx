import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { extractTextFromFile, addSourceUrl, ApiError } from "../../lib/api";
import Field from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import IconButton from "../../components/ui/IconButton";
import ErrorState from "../../components/ui/ErrorState";
import { CloseIcon } from "../../components/ui/icons";

const ACCEPTED_UPLOAD_TYPES = "application/pdf,image/png,image/jpeg,image/webp,image/gif";

let nextSourceUrlFieldId = 1;

export default function NewRequest() {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  // Each row needs a stable key independent of its text value (two empty
  // or duplicate-URL rows would otherwise collide) — an incrementing id
  // assigned once per row, not the url string itself.
  const [sourceUrls, setSourceUrls] = useState<{ id: number; value: string }[]>([
    { id: nextSourceUrlFieldId++, value: "" },
  ]);
  const [supportingMaterial, setSupportingMaterial] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("");
  // Off by default: most requests are routine and should just run
  // unattended straight through to ready_for_review. Ticking this is a
  // per-request choice to pause once sources are in, for anything
  // sensitive enough that a manager wants to see what was found before
  // tokens are spent drafting three articles from it.
  const [reviewSourcesBeforeDrafting, setReviewSourcesBeforeDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedFileName, setExtractedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateSourceUrl(id: number, value: string) {
    setSourceUrls((current) => current.map((s) => (s.id === id ? { ...s, value } : s)));
  }

  function addSourceUrlField() {
    setSourceUrls((current) => [...current, { id: nextSourceUrlFieldId++, value: "" }]);
  }

  function removeSourceUrlField(id: number) {
    setSourceUrls((current) => (current.length > 1 ? current.filter((s) => s.id !== id) : current));
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setExtracting(true);
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) {
        setExtractError(`Couldn't find any readable text in ${file.name}.`);
      } else {
        // Append rather than replace — a manager may upload more than
        // one file, or have already typed/pasted something in by hand.
        setSupportingMaterial((current) => (current.trim() ? `${current.trim()}\n\n${text.trim()}` : text.trim()));
        setExtractedFileName(file.name);
      }
    } catch (err) {
      setExtractError(err instanceof ApiError ? err.message : "Failed to extract text from the file.");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!idea.trim() || !targetAudience.trim()) {
      setError("Idea and target audience are required.");
      return;
    }

    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not signed in.");
      setSubmitting(false);
      return;
    }

    const keywordList = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const urls = [...new Set(sourceUrls.map((s) => s.value.trim()).filter(Boolean))];

    const { data, error: insertError } = await supabase
      .from("content_requests")
      .insert({
        idea: idea.trim(),
        target_audience: targetAudience.trim(),
        // Kept only as a quick-glance record of the first URL supplied —
        // every URL (including this one) is actually added as a proper
        // source row below, via the same path the "add a source" form
        // uses later. Nothing reads this column for scraping anymore
        // (see api/stages/research.ts).
        source_url: urls[0] ?? null,
        supporting_material: supportingMaterial.trim() || null,
        keywords: keywordList,
        tone: tone.trim() || null,
        review_sources_before_drafting: reviewSourcesBeforeDrafting,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setSubmitting(false);
      setError(insertError?.message ?? "Failed to create request.");
      return;
    }

    // Scraped in parallel, before navigating: research auto-starts the
    // instant the detail page loads, and it needs to see these rows
    // already there to count them toward its target and avoid searching
    // up duplicates of what the manager already supplied. A URL that
    // fails to scrape still gets recorded (fetch_ok: false, visible on
    // the detail page) rather than blocking the rest — this call only
    // throws for a genuine server error, not an unreachable URL.
    await Promise.all(
      urls.map((url) =>
        addSourceUrl(data.id, url).catch(() => {
          // Surfaced later as a failed-fetch row on the detail page —
          // nothing useful to show here that duplicates that.
        }),
      ),
    );

    setSubmitting(false);
    navigate(`/request/${data.id}`);
  }

  return (
    <div className="stack">
      <div className="page-header">
        <h1>New content request</h1>
        <p className="subtitle">
          Give the agent an idea, an audience, and, if you have one, a source to ground the research in.
        </p>
      </div>

      <form className="card stack" onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
        {error && <ErrorState message={error} />}

        <Field label="Content idea" htmlFor="idea" required>
          <textarea
            id="idea"
            className="ui-textarea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. Why mid-market SaaS teams are moving off point solutions and onto unified platforms"
            required
          />
        </Field>

        <Field label="Target audience" htmlFor="audience" required>
          <input
            id="audience"
            className="ui-input"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="e.g. VP of Marketing at Series B-D SaaS companies"
            required
          />
        </Field>

        <Field
          label="Source URLs (optional)"
          htmlFor="sourceUrl-0"
          hint="Each one is scraped and kept as a source before anything else runs."
        >
          <div className="stack stack-sm">
            {sourceUrls.map((s, i) => (
              <div key={s.id} className="row">
                <input
                  id={`sourceUrl-${i}`}
                  className="ui-input"
                  type="url"
                  value={s.value}
                  onChange={(e) => updateSourceUrl(s.id, e.target.value)}
                  placeholder="https://…"
                  style={{ flex: 1 }}
                />
                {sourceUrls.length > 1 && (
                  <IconButton label="Remove this URL" onClick={() => removeSourceUrlField(s.id)}>
                    <CloseIcon />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <Button type="button" variant="secondary" size="sm" onClick={addSourceUrlField}>
              Add another URL
            </Button>
          </div>
        </Field>

        <Field
          label="Supporting material (optional)"
          htmlFor="supportingMaterial"
          hint="Paste notes below, or upload a PDF or image (photo of a whiteboard, a screenshot, a scanned page) and the text will be pulled out automatically."
        >
          <div className="row" style={{ marginBottom: "var(--s2)" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_UPLOAD_TYPES}
              onChange={handleFileUpload}
              style={{ display: "none" }}
              id="supportingMaterialFile"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={extracting}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload PDF or image
            </Button>
            {extractedFileName && !extracting && (
              <span className="subtitle" style={{ margin: 0 }}>
                Added text from {extractedFileName}
              </span>
            )}
          </div>
          {extractError && <ErrorState message={extractError} />}
          <textarea
            id="supportingMaterial"
            className="ui-textarea"
            value={supportingMaterial}
            onChange={(e) => setSupportingMaterial(e.target.value)}
            placeholder="Paste any notes, quotes, or data the writer should be aware of."
          />
        </Field>

        <Field label="Keywords (optional, comma-separated)" htmlFor="keywords">
          <input
            id="keywords"
            className="ui-input"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="unified platform, tool consolidation, SaaS sprawl"
          />
        </Field>

        <Field label="Tone (optional)" htmlFor="tone">
          <input
            id="tone"
            className="ui-input"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="e.g. confident, plainspoken, a little contrarian"
          />
        </Field>

        <label className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={reviewSourcesBeforeDrafting}
            onChange={(e) => setReviewSourcesBeforeDrafting(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            Let me review sources before drafting
            <p className="subtitle" style={{ margin: 0 }}>
              Off by default — the request runs straight through to review with no stops. Turn this on to pause once
              sources are found, so you can check or adjust them before any drafts get written.
            </p>
          </span>
        </label>

        <div className="btn-row">
          <Button type="submit" variant="primary" loading={submitting}>
            Create request
          </Button>
        </div>
      </form>
    </div>
  );
}
