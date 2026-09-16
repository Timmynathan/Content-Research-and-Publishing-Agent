import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { extractTextFromFile, ApiError } from "../../lib/api";
import Field from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import ErrorState from "../../components/ui/ErrorState";

const ACCEPTED_UPLOAD_TYPES = "application/pdf,image/png,image/jpeg,image/webp,image/gif";

export default function NewRequest() {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [supportingMaterial, setSupportingMaterial] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedFileName, setExtractedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    const { data, error: insertError } = await supabase
      .from("content_requests")
      .insert({
        idea: idea.trim(),
        target_audience: targetAudience.trim(),
        source_url: sourceUrl.trim() || null,
        supporting_material: supportingMaterial.trim() || null,
        keywords: keywordList,
        tone: tone.trim() || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    setSubmitting(false);

    if (insertError || !data) {
      setError(insertError?.message ?? "Failed to create request.");
      return;
    }

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
          label="Source URL (optional)"
          htmlFor="sourceUrl"
          hint="If given, this is always scraped and kept as a source, before anything else."
        >
          <input
            id="sourceUrl"
            className="ui-input"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
          />
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

        <div className="btn-row">
          <Button type="submit" variant="primary" loading={submitting}>
            Create request
          </Button>
        </div>
      </form>
    </div>
  );
}
