import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// Afriforce Intelligence gateway, calling Gemini. This remains the
// single place GEMINI_API_KEY is read — it never reaches the browser.
// The frontend still posts {system, prompt} and parses the returned
// text as JSON itself, so provider swaps don't require touching the
// many prompt call-sites in components/AfriforceApp.jsx.
//
// Key format: Google is migrating Gemini API keys from "Standard" keys
// (AIza...) to "Auth" keys (AQ...), bound to a specific service account
// for tighter access control. Standard keys stop working entirely in
// September 2026. This gateway doesn't need to know or care which type
// GEMINI_API_KEY is — both are sent the same way, via the x-goog-api-key
// header below — so no code branching is needed, just use a current
// Auth key as the env var value.
//
// gemini-3.6-flash is confirmed current in Google's supported-models
// table (ai.google.dev/gemini-api/docs/interactions-overview) as of
// this writing — the Gemini 2.x line, including 2.5, has been fully
// shut down. It's a fast, inexpensive fit for the short JSON-generation
// tasks this app makes (profile analysis, assessments, opportunity
// generation, etc.). Swap MODEL below if Google ships a newer stable
// line, or split by task if some prompts need more reasoning than
// others (e.g. route business analysis to a Pro-tier model).
//
// This still calls the generateContent endpoint rather than Google's
// newer Interactions API. Google states generateContent "remains fully
// supported" even though Interactions is now the recommended default —
// kept here deliberately since generateContent's request/response shape
// is fully documented and verified, where Interactions' exact REST JSON
// shape wasn't confirmable at the time this was written. Worth
// revisiting later; don't switch without verifying the new shape first.
const MODEL = 'gemini-3.6-flash';

// Same rate-limiting caveat as before: this counts documents in
// Firestore rather than using an atomic counter, so it's a best-effort
// limiter, not an airtight one — two concurrent requests near the
// boundary could both slip through. Fine for an MVP deploy; swap in a
// dedicated limiter (e.g. Upstash Redis) before this handles real
// traffic.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  // .trim() guards against the single most common cause of this exact
  // failure: a stray trailing space or newline from copy-pasting the key
  // (e.g. out of a chat message or code block) into Vercel's env var
  // field. Gemini's API rejects a key with invisible extra characters
  // the same way it rejects a wrong one — with a generic 401, not a
  // helpful "your key has whitespace in it" message — so this is cheap
  // insurance even though the real fix is re-copying the key cleanly.
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 500 },
    );
  }
  if (!/^(AIza|AQ\.)/.test(apiKey)) {
    // Doesn't match either known Gemini key shape (Standard: AIza...,
    // Auth: AQ...) — almost certainly the wrong value got pasted into
    // this env var. Surface that immediately rather than letting it
    // fail as an opaque 401 from Gemini.
    return NextResponse.json(
      {
        error: `GEMINI_API_KEY doesn't look like a Gemini key (starts with "${apiKey.slice(0, 6)}...", ${apiKey.length} characters — expected it to start with "AIza" or "AQ."). Check what's actually saved in Vercel's Environment Variables.`,
      },
      { status: 500 },
    );
  }

  const usageRef = db.collection('users').doc(decoded.uid).collection('aiUsage');
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  try {
    const countSnap = await usageRef.where('createdAt', '>=', windowStart).count().get();
    if (countSnap.data().count >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: `Rate limit reached (${RATE_LIMIT_MAX} requests/hour). Try again shortly.` },
        { status: 429 },
      );
    }
  } catch (e) {
    // Fail OPEN, not closed: if Firestore is unreachable or not yet
    // provisioned (e.g. the database hasn't been created in the Firebase
    // Console), letting the AI request through is better than a silent,
    // undiagnosable 500 on every single request. Rate limiting is a
    // safety net, not core functionality — its own failure shouldn't
    // take down the feature it's protecting. The real error is still
    // logged so it's visible in Vercel's runtime logs.
    console.error('Rate-limit check failed (continuing without it):', e);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { system, prompt } = body || {};
  if (!prompt) {
    return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { maxOutputTokens: 1024 },
        }),
      },
    );

    // Record usage regardless of outcome — failed calls still cost quota
    // pressure and should count against the limit.
    usageRef.add({ createdAt: new Date().toISOString() }).catch(() => {});

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Gemini API error:', res.status, errText);
      // Surfaced to the client deliberately: Gemini's error body describes
      // *why* (invalid key, model not found, quota, safety block) and
      // never echoes the key itself, so this is safe to show and makes
      // failures self-diagnosable from the app's own error screen instead
      // of requiring a trip to Vercel's log viewer.
      let detail = errText.slice(0, 300);
      try {
        const parsed = JSON.parse(errText);
        detail = parsed?.error?.message || detail;
      } catch (e) {
        // errText wasn't JSON — use the raw (truncated) text as-is.
      }
      let hint = '';
      if (res.status === 401 || res.status === 403) {
        hint = ' Likely cause: GEMINI_API_KEY was pasted with extra whitespace, is the wrong value, or has an "Application restriction" (HTTP referrer/IP) in AI Studio/Cloud Console that blocks server-to-server calls — check the key was copied fresh from AI Studio and has no restrictions set.';
      }
      return NextResponse.json(
        { error: `Gemini request failed (HTTP ${res.status}): ${detail}${hint}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];

    if (!candidate) {
      console.error('Gemini returned no candidates:', JSON.stringify(data).slice(0, 500));
      return NextResponse.json({ error: 'AI request failed.' }, { status: 502 });
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      return NextResponse.json({ error: 'The response was blocked by safety filters.' }, { status: 502 });
    }

    // Filter out "thought" parts explicitly: Gemini 3.x models can
    // include internal reasoning as separate parts alongside the actual
    // answer (flagged with part.thought === true). Concatenating those
    // in with the real output is exactly what was producing malformed
    // JSON on the client (a stray fragment before or after the intended
    // answer). Only non-thought parts are the actual response.
    const text = (candidate.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || '')
      .join('\n');
    return NextResponse.json({ text });
  } catch (e) {
    console.error('AI gateway error:', e);
    return NextResponse.json({ error: 'AI request failed.' }, { status: 500 });
  }
}
