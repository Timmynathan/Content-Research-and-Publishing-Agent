// Embedded verbatim from assets/seo-best-practices.md,
// assets/content-evaluation-rubric.md, and
// assets/channel-formatting-rules.md rather than read from disk at
// runtime — a serverless function's bundle only includes files it
// statically imports, and a plain fs.readFileSync against a path
// outside api/ isn't reliably traced into the deployment. If any
// source file changes, update the matching constant here too.

export const SEO_BEST_PRACTICES = `
# SEO Best Practices

## Keyword Integration
- Get the primary keyword from the content idea.
- Include the primary keyword in the article title.
- Include the primary keyword in the first 100 words.
- Analyze strong competing or reference articles to identify long-tail and short-tail keywords.
- Use relevant secondary keywords in the body and section headers.

## Structure Optimization
- Use one H1 title.
- Use H2 section headers.
- Use H3 subheaders where needed.
- Use short paragraphs of 2 to 3 sentences.
- Let the depth of each main section reflect the strength and complexity of the source material.

## Content Enrichment
- Include 2 to 3 relevant internal or external links.
- Keep the writing readable for a broad audience.
- Include one contextually relevant image if the content needs one.
- Keep claims grounded in reviewed source material.
`.trim();

export const EVALUATION_RUBRIC = `
# Content Evaluation Rubric

Use this rubric to evaluate draft quality before a human approves the content.

## Evaluation Criteria
- Topic Relevance: The content answers the request and stays focused on the intended topic.
- Source Grounding: Claims, examples, and recommendations connect back to reviewed source material.
- Factual Consistency: The content avoids contradictions, unsupported claims, and invented details.
- Audience Fit: The content speaks to the target audience at the right level of depth.
- Tone: The style matches the brand and channel.
- SEO Fit: The article uses the primary keyword, relevant secondary keywords, clear headings, and useful links.
- Channel Fit: The content fits the format it is written for. At this stage that format is a long-form article, not yet an adapted channel post, so judge whether it reads as a complete, publishable article rather than a fragment or a listicle-shaped draft that doesn't match its own structure.
- Clarity: The content is easy to read, skimmable, and direct.
- Completeness: The output includes every required section.
`.trim();

export const LINKEDIN_FORMATTING_RULES = `
## LinkedIn Post
- Use the PAS copywriting structure: problem, agitation, solution.
- Keep paragraphs short.
- Use bullets or simple symbols when they improve clarity.
- Use a small number of relevant emojis only when they fit the brand voice.
- End with a clear call to action.
`.trim();

export const X_FORMATTING_RULES = `
## X Post
- Lead with the main benefit, insight, or hook.
- Keep the post focused on one core idea.
- Use line breaks for readability.
- Use no more than 1 to 2 relevant hashtags.
- Tag another account only if the tag adds value.
`.trim();

export const NEWSLETTER_FORMATTING_RULES = `
## Email Newsletter
- Use a strong subject line with a clear benefit or point of intrigue.
- Start with a short intro of 1 to 3 sentences.
- Make the main value section easy to skim with subheadings or bullets.
- Add an optional secondary item, such as a quick tip, link, or update.
- Include a clear call to action.
- Use a friendly sign-off.
- Write like you are speaking to a smart, busy reader who trusts you to send something useful.
- Keep the newsletter between 250 and 600 words.
`.trim();
