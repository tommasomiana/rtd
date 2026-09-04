const axios = require('axios');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

/**
 * Calls the Anthropic Messages API with the web_search tool enabled.
 * web_search is a server-side tool — Anthropic's API performs the search
 * and continues generating internally, so a single request here returns
 * the model's final answer (no manual tool-use loop needed on our end).
 */
async function callClaude(userPrompt) {
  const res = await axios.post(
    API_URL,
    {
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 60000,
    }
  );

  // The response mixes block types (text, server_tool_use, web_search_tool_result)
  // — only the text blocks make up the model's actual answer.
  const textBlocks = (res.data.content || []).filter((b) => b.type === 'text').map((b) => b.text);
  return textBlocks.join('\n').trim();
}

// Strips a ```json fence if the model wrapped its answer in one despite
// being told not to, then parses. Returns null on any failure so callers
// can handle a bad/empty agent response gracefully instead of crashing.
function parseJsonSafe(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[agent] Failed to parse JSON from model response:', e.message);
    console.error('[agent] Raw response was:', text.slice(0, 500));
    return null;
  }
}

// Searches the web for events matching a free-text query (e.g. "Brunch
// Electronik 2026 Barcelona") and returns up to 3 candidate matches for
// the user to confirm before we go looking for the full lineup.
async function findEventCandidates(query) {
  const prompt = `Search the web to find real electronic music / club / festival events matching this query: "${query}"

Identify up to 3 candidate events that best match. For each, include the event title, date, venue/location, a source URL (the page you found it on — Resident Advisor, Dice.fm, an official festival site, Instagram, etc.), and the source name.

Respond with ONLY valid JSON, no other text, no markdown code fences, in exactly this shape:
{"candidates":[{"title":"...","date":"...","venue":"...","url":"...","source":"..."}]}

If you can't find any confident matches, respond with:
{"candidates":[]}`;

  const text = await callClaude(prompt);
  const parsed = parseJsonSafe(text);
  if (!parsed || !Array.isArray(parsed.candidates)) return [];
  return parsed.candidates.slice(0, 3);
}

// Given a confirmed event candidate, searches the web for its full artist
// lineup.
async function findLineupForEvent(candidate) {
  const prompt = `Search the web to find the complete artist/DJ lineup for this specific event:

Title: ${candidate.title}
Date: ${candidate.date || 'unknown'}
Venue: ${candidate.venue || 'unknown'}
Source: ${candidate.url || 'unknown'}

List every performing artist/DJ by name — no hosts, no venue names, no stage names used as section headers, no generic labels. Deduplicate the list.

Respond with ONLY valid JSON, no other text, no markdown code fences, in exactly this shape:
{"eventTitle":"...","artists":["Name1","Name2","..."]}

If you can't find a lineup at all, respond with:
{"eventTitle":"${candidate.title.replace(/"/g, '\\"')}","artists":[]}`;

  const text = await callClaude(prompt);
  const parsed = parseJsonSafe(text);
  if (!parsed || !Array.isArray(parsed.artists)) {
    return { eventTitle: candidate.title, artists: [] };
  }
  return { eventTitle: parsed.eventTitle || candidate.title, artists: parsed.artists };
}

module.exports = { findEventCandidates, findLineupForEvent };
