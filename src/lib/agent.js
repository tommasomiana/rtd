const axios = require('axios');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };
// web_fetch retrieves the FULL content of a specific URL, unlike web_search
// which only returns indexed snippets — critical when a page's complete
// lineup isn't fully reflected in search-engine snippet text. It can only
// fetch URLs already present in the conversation (e.g. one we put in the
// prompt ourselves), not arbitrary URLs the model invents.
// max_content_tokens caps how much of a fetched page gets pulled into the
// conversation — full pages (nav, footer, ads, etc.) can otherwise cost far
// more input tokens than the actual lineup text is worth.
const WEB_FETCH_TOOL = {
  type: 'web_fetch_20260309',
  name: 'web_fetch',
  max_uses: 2,
  max_content_tokens: 15000,
  allowed_callers: ['direct'],
};

/**
 * Calls the Anthropic Messages API with the given server-side tools enabled.
 * These are server-side tools — Anthropic's API performs the search/fetch
 * and continues generating internally, so a single request here returns
 * the model's final answer (no manual tool-use loop needed on our end).
 */
async function callClaude(userPrompt, { tools = [WEB_SEARCH_TOOL], useWebFetch = false } = {}) {
  const headers = {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  // Some accounts/API versions still require this beta header for web_fetch;
  // harmless to include even if not strictly needed.
  if (useWebFetch) {
    headers['anthropic-beta'] = 'web-fetch-2025-09-10';
  }

  const res = await axios.post(
    API_URL,
    {
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: userPrompt }],
      tools,
    },
    { headers, timeout: 60000 }
  );

  if (res.data.stop_reason === 'max_tokens') {
    console.warn('[agent] Response was truncated by max_tokens — consider raising the limit further.');
  }
  if (res.data.usage?.server_tool_use) {
    console.log('[agent] Server tool use:', JSON.stringify(res.data.usage.server_tool_use));
  }

  const textBlocks = (res.data.content || []).filter((b) => b.type === 'text').map((b) => b.text);
  return textBlocks.join('\n').trim();
}

// Strips a ```json fence if present, and — more importantly — extracts
// just the outermost {...} object even if the model added explanatory
// text before or after it (despite being told not to). Returns null on
// any failure so callers can handle a bad/empty agent response gracefully
// instead of crashing.
function parseJsonSafe(text) {
  if (!text) return null;

  let candidate = text.replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch (e) {
    console.error('[agent] Failed to parse JSON from model response:', e.message);
    console.error('[agent] Raw response was:', text.slice(0, 1000));
    return null;
  }
}

// Searches the web for events matching a free-text query (e.g. "Brunch
// Electronik 2026 Barcelona") and returns up to 3 candidate matches for
// the user to confirm before we go looking for the full lineup.
async function findEventCandidates(query) {
  const prompt = `Find real electronic music/club/festival events matching: "${query}"

Up to 3 candidates. For each: title, date, venue, source URL, source name.

Respond with ONLY this JSON, nothing else:
{"candidates":[{"title":"...","date":"...","venue":"...","url":"...","source":"..."}]}

No matches: {"candidates":[]}`;

  const text = await callClaude(prompt);
  const parsed = parseJsonSafe(text);
  if (!parsed || !Array.isArray(parsed.candidates)) return [];
  return parsed.candidates.slice(0, 3);
}

// Given a confirmed event candidate, searches the web for its full artist
// lineup. Fetches the exact source URL directly when available (more
// reliable than search snippets, which can miss a lineup that's fully
// present on the page but not fully indexed) and falls back to a broader
// web search if that page doesn't have it or fetching fails.
async function findLineupForEvent(candidate) {
  const hasUrl = !!candidate.url;

  const prompt = `Find the full artist/DJ lineup for this event:

Title: ${candidate.title}
Date: ${candidate.date || 'unknown'}
Venue: ${candidate.venue || 'unknown'}
${hasUrl ? `\nFetch this URL directly first — it's the primary source: ${candidate.url}\nOnly search the web if that page lacks a full lineup.` : 'No source URL given — use web search.'}

List every performing artist/DJ (names only — no hosts, venues, or section headers). Deduplicate.

Respond with ONLY this JSON, nothing else:
{"eventTitle":"...","artists":["Name1","Name2","..."]}

No lineup found: {"eventTitle":"${candidate.title.replace(/"/g, '\\"')}","artists":[]}`;

  const text = await callClaude(prompt, {
    tools: hasUrl ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] : [WEB_SEARCH_TOOL],
    useWebFetch: hasUrl,
  });
  const parsed = parseJsonSafe(text);
  if (!parsed || !Array.isArray(parsed.artists)) {
    return { eventTitle: candidate.title, artists: [] };
  }
  return { eventTitle: parsed.eventTitle || candidate.title, artists: parsed.artists };
}

module.exports = { findEventCandidates, findLineupForEvent };
