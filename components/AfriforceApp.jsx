'use client';

import React, { useState, useEffect, useRef } from 'react';
import { auth } from '@/lib/firebaseClient';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  ArrowRight, Check, ChevronRight, X, MapPin, Clock3, Briefcase,
  Home, Compass, User, BarChart3, Loader2, Send, RotateCcw, Store, Lightbulb
} from 'lucide-react';

/* ---------------------------------------------------------------------- */
/* Storage shim                                                            */
/* ---------------------------------------------------------------------- */
// Mirrors the get/set/delete/list interface the prototype used against
// the artifact sandbox's storage, backed by real API routes here.
// Kept as a drop-in so the rest of this file — every `storage.get(...)`,
// `storage.set(...)` etc. below — didn't need to change shape.
//
// Personal (shared:false) requests attach the current Firebase ID token
// so the API route can verify who's asking; shared:true GETs are public
// and skip this, matching what the routes actually require.
async function authHeader() {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

const storage = {
  async get(key, shared = false) {
    const headers = shared ? {} : await authHeader();
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}&shared=${shared}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('storage get failed');
    return res.json();
  },
  async set(key, value, shared = false) {
    const headers = await authHeader();
    const res = await fetch('/api/kv', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ key, value, shared }),
    });
    if (!res.ok) throw new Error('storage set failed');
    return res.json();
  },
  async delete(key, shared = false) {
    const headers = await authHeader();
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}&shared=${shared}`, { method: 'DELETE', headers });
    if (!res.ok) throw new Error('storage delete failed');
    return res.json();
  },
  async list(prefix = '', shared = false) {
    const res = await fetch(`/api/kv/list?prefix=${encodeURIComponent(prefix)}&shared=${shared}`);
    if (!res.ok) throw new Error('storage list failed');
    return res.json();
  },
};

/* ---------------------------------------------------------------------- */
/* Data + constants                                                       */
/* ---------------------------------------------------------------------- */

const GOALS = [
  { id: 'job', label: 'Find a job' },
  { id: 'freelance', label: 'Start freelancing' },
  { id: 'business', label: 'Start a business' },
  { id: 'grow', label: 'Grow my business' },
  { id: 'learn', label: 'Learn a valuable skill' },
  { id: 'income', label: 'Increase my income' },
];

const SKILL_SUGGESTIONS = [
  'Customer Service', 'Excel', 'Graphic Design', 'Sales', 'Social Media',
  'Writing', 'Accounting', 'Marketing', 'Coding', 'Data Entry',
  'Teaching', 'Tailoring', 'Logistics', 'Photography'
];

const COUNTRIES = ['Uganda', 'Kenya', 'Nigeria', 'Ghana', 'Tanzania', 'Rwanda', 'South Africa', 'Ethiopia', 'Senegal', 'Other'];
const LANGUAGES = ['English', 'Swahili', 'French', 'Luganda', 'Hausa', 'Yoruba', 'Amharic', 'Zulu', 'Portuguese'];
const TIME_OPTIONS = ['Less than 5 hrs/week', '5–10 hrs/week', '10–20 hrs/week', '20–40 hrs/week', 'Full time'];

// Invented test personas — development data only, never real users.
// Mirrors the persona set described in the build docs (young graduate,
// customer-service worker, freelancer, small-business owner) so the
// matching/recommendation logic can be exercised across different situations.
const PERSONAS = [
  {
    id: 'grad',
    name: 'Persona A — Recent graduate',
    blurb: 'Ghana · looking for a first job',
    intake: {
      goals: ['job', 'learn'],
      skills: [
        { name: 'Excel', selfLevel: 'Beginner' },
        { name: 'Writing', selfLevel: 'Intermediate' },
        { name: 'Social Media', selfLevel: 'Intermediate' },
      ],
      experienceText: 'Just finished a business administration diploma. No formal job yet, but I ran the social media page for my church youth group for a year.',
      country: 'Ghana', city: 'Accra', language: 'English',
      time: '20–40 hrs/week', capital: '',
    },
  },
  {
    id: 'cs',
    name: 'Persona B — Customer-service worker',
    blurb: 'Kenya · wants to earn more',
    intake: {
      goals: ['income', 'job'],
      skills: [
        { name: 'Customer Service', selfLevel: 'Advanced' },
        { name: 'Data Entry', selfLevel: 'Intermediate' },
      ],
      experienceText: 'Two years as a call-center agent for a telecom company. Handle complaints, upsell add-on plans, use a basic CRM daily.',
      country: 'Kenya', city: 'Nairobi', language: 'English',
      time: '10–20 hrs/week', capital: '',
    },
  },
  {
    id: 'freelance',
    name: 'Persona C — Freelance designer',
    blurb: 'Nigeria · wants more clients',
    intake: {
      goals: ['freelance', 'income'],
      skills: [
        { name: 'Graphic Design', selfLevel: 'Advanced' },
        { name: 'Social Media', selfLevel: 'Intermediate' },
      ],
      experienceText: 'Self-taught designer, made flyers and logos for local businesses for the past year using Canva and Photoshop. No formal clients outside my neighborhood yet.',
      country: 'Nigeria', city: 'Lagos', language: 'English',
      time: '20–40 hrs/week', capital: '',
    },
  },
  {
    id: 'biz',
    name: 'Persona D — Small shop owner',
    blurb: 'Uganda · wants to grow the business',
    intake: {
      goals: ['grow', 'business'],
      skills: [
        { name: 'Sales', selfLevel: 'Advanced' },
        { name: 'Tailoring', selfLevel: 'Advanced' },
      ],
      experienceText: 'Run a small tailoring shop from home for three years, mostly word-of-mouth customers. Want to reach more customers and maybe sell online.',
      country: 'Uganda', city: 'Kampala', language: 'English',
      time: 'Full time', capital: '150',
    },
  },
];

const LOADING_MESSAGES = [
  'Reading through what you shared…',
  'Looking at your strongest skills…',
  'Comparing that with real opportunities…',
  'Putting together your next move…',
];

/* ---------------------------------------------------------------------- */
/* AI helper                                                              */
/* ---------------------------------------------------------------------- */

// Finds the JSON value in `text` most likely to be the model's actual
// answer, tolerating stray content around or alongside it — a preamble,
// a duplicated fragment, or (as seen in practice) a leftover empty `{}`
// artifact from thinking content that slipped past the server-side
// filter. Scans for *every* top-level balanced {...} / [...] span
// (properly skipping brace/bracket characters inside quoted strings)
// and returns the longest one: a stray artifact like `{}` is trivially
// small, while the real answer is substantial, so length is a reliable
// way to tell them apart without knowing the expected shape in advance.
function extractJsonSlice(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const relativeStart = text.slice(i).search(/[{[]/);
    if (relativeStart === -1) break;
    const start = i + relativeStart;
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) break; // Nothing balances from here on — stop scanning.
    spans.push(text.slice(start, end + 1));
    i = end + 1;
  }
  if (!spans.length) throw new Error('No JSON value found in AI response');
  spans.sort((a, b) => b.length - a.length);
  return spans[0];
}

async function callOnce(system, prompt) {
  // Calls our own server-side AI Gateway (app/api/intelligence/route.js,
  // which talks to Gemini) rather than any AI provider directly — the API
  // key lives only on the server. Requires a signed-in Firebase user; the
  // gateway verifies the ID token and returns 401 otherwise.
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch('/api/intelligence', {
    method: 'POST',
    headers,
    body: JSON.stringify({ system, prompt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `AI request failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  const cleaned = (data.text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Full response wasn't clean JSON on its own — try pulling just the
    // first balanced JSON value out of it before giving up entirely.
    return JSON.parse(extractJsonSlice(cleaned));
  }
}

// Best-effort diagnostic: the last error message from a failed AI call,
// so a failure screen can show *why* rather than just "something went
// wrong" — genuinely useful when the only way to see server logs is a
// phone browser. This is intentionally simple (a single shared variable,
// not per-call-site tracking) — if two AI calls fail around the same
// moment, whichever finishes last wins. That's an acceptable trade for a
// diagnostic aid; it's not relied on for correctness anywhere.
let lastAiError = null;

async function askAfriforce(system, prompt) {
  try {
    const result = await callOnce(system, prompt);
    lastAiError = null;
    return result;
  } catch (e) {
    // One safe retry — a single malformed response or transient network
    // error shouldn't be treated the same as Afriforce Intelligence
    // actually being unavailable.
    try {
      await new Promise((r) => setTimeout(r, 600));
      const result = await callOnce(system, prompt);
      lastAiError = null;
      return result;
    } catch (e2) {
      lastAiError = e2?.message || 'Unknown error';
      console.error('Afriforce Intelligence error (after retry):', e2);
      return null;
    }
  }
}

const SYSTEM = 'You are Afriforce Intelligence, an economic-opportunity analyst helping African users turn their skills, time and resources into real work, income or businesses. Be concrete, specific to what the person told you, warm but plain-spoken. Never guarantee income or employment. Respond with ONLY valid JSON — no markdown fences, no commentary before or after.';

/* ---------------------------------------------------------------------- */
/* Small UI atoms                                                         */
/* ---------------------------------------------------------------------- */

function Thread({ step, total }) {
  return (
    <div className="af-thread">
      {Array.from({ length: total }).map((_, i) => (
        <React.Fragment key={i}>
          <div className={`af-node ${i < step ? 'done' : ''} ${i === step - 1 ? 'active' : ''}`}>
            {i < step - 1 ? <Check size={11} strokeWidth={3} /> : null}
          </div>
          {i < total - 1 && <div className={`af-line ${i < step - 1 ? 'done' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button type="button" className={`af-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function StatusPill({ status }) {
  const map = {
    'Strong match': 'strong',
    'Good match': 'good',
    'Partial match': 'partial',
    'Needs preparation': 'prep',
  };
  return <span className={`af-pill ${map[status] || 'partial'}`}>{status}</span>;
}

function LoadingSequence() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % LOADING_MESSAGES.length), 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="af-loading" role="status" aria-live="polite">
      <div className="af-loading-thread" aria-hidden="true">
        {LOADING_MESSAGES.map((_, idx) => (
          <div key={idx} className={`af-loading-dot ${idx <= i ? 'lit' : ''}`} />
        ))}
      </div>
      <p className="af-loading-text">{LOADING_MESSAGES[i]}</p>
    </div>
  );
}

function ErrorState({ message, detail, onRetry, onBack }) {
  return (
    <div className="af-error-state" role="alert">
      <p>{message || "Afriforce Intelligence is temporarily unavailable. Your information is safe."}</p>
      {detail && (
        <p className="af-error-detail">
          Technical detail (for troubleshooting): <code>{detail}</code>
        </p>
      )}
      <div className="af-error-actions">
        {onRetry && <button className="af-btn af-btn-primary" onClick={onRetry}>Try again</button>}
        {onBack && <button className="af-btn af-btn-ghost" onClick={onBack}>Go back</button>}
      </div>
    </div>
  );
}

function BottomNav({ screen, go, hasProfile }) {
  if (!hasProfile) return null;
  const items = [
    { id: 'dashboard', label: 'Home', icon: Home },
    { id: 'opportunities', label: 'Opportunities', icon: Compass },
    { id: 'skills', label: 'My Path', icon: Briefcase },
    { id: 'business', label: 'Business', icon: Store },
    { id: 'progress', label: 'Profile', icon: User },
  ];
  return (
    <nav className="af-bottomnav">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`af-navitem ${screen === id ? 'active' : ''}`} onClick={() => go(id)}>
          <Icon size={20} strokeWidth={screen === id ? 2.4 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------------------- */
/* Landing                                                                 */
/* ---------------------------------------------------------------------- */

function Landing({ onStart, onTryPersona, onEmployer, onAdmin }) {
  return (
    <div className="af-landing">
      <div className="af-hero">
        <span className="af-eyebrow">Afriforce</span>
        <h1 className="af-h1">Africa has talent.<br />Afriforce turns it into opportunity.</h1>
        <p className="af-lead">
          Tell us what you can do, what you have and where you want to go.
          We'll help you find a realistic next step — a job, freelance work,
          or a business worth trying.
        </p>
        <div className="af-cta-row">
          <button className="af-btn af-btn-primary" onClick={onStart}>
            Start your journey <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div className="af-personas">
        <span className="af-label">Development data — sample profiles for testing</span>
        <p className="af-hint" style={{ marginTop: 4, marginBottom: 12 }}>
          Skip onboarding and see how recommendations differ for four invented profiles.
        </p>
        <div className="af-persona-grid">
          {PERSONAS.map((p) => (
            <button key={p.id} className="af-persona-card" onClick={() => onTryPersona(p)}>
              <span className="af-persona-name">{p.name}</span>
              <span className="af-persona-blurb">{p.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="af-how">
        <div className="af-how-item">
          <span className="af-how-index">Discover</span>
          <p>Understand what you're already good at.</p>
        </div>
        <div className="af-line-v" />
        <div className="af-how-item">
          <span className="af-how-index">Build</span>
          <p>Strengthen the skills that open doors.</p>
        </div>
        <div className="af-line-v" />
        <div className="af-how-item">
          <span className="af-how-index">Connect</span>
          <p>See opportunities that actually fit you.</p>
        </div>
        <div className="af-line-v" />
        <div className="af-how-item">
          <span className="af-how-index">Act</span>
          <p>Always know your next move.</p>
        </div>
      </div>

      <div className="af-trust">
        <p><strong>Worth knowing:</strong> Afriforce's suggestions are estimates built from what you tell us, not guarantees of income or employment. You stay in control of your information at every step.</p>
      </div>

      <div className="af-employer-link">
        <button className="af-linklike" onClick={onEmployer}>Hiring? Explore Afriforce for Employers <ChevronRight size={14} /></button>
      </div>

      <div className="af-admin-link">
        <button className="af-tinylink" onClick={onAdmin}>Internal: Admin overview</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Onboarding                                                              */
/* ---------------------------------------------------------------------- */

function Onboarding({ intake, setIntake, onComplete }) {
  const [step, setStep] = useState(1);
  const [skillInput, setSkillInput] = useState('');

  const toggleGoal = (id) => {
    setIntake((prev) => ({
      ...prev,
      goals: prev.goals.includes(id) ? prev.goals.filter((g) => g !== id) : [...prev.goals, id],
    }));
  };

  const addSkill = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setIntake((prev) => (prev.skills.find((s) => s.name.toLowerCase() === trimmed.toLowerCase())
      ? prev
      : { ...prev, skills: [...prev.skills, { name: trimmed, selfLevel: 'Intermediate' }] }));
    setSkillInput('');
  };

  const removeSkill = (name) => {
    setIntake((prev) => ({ ...prev, skills: prev.skills.filter((s) => s.name !== name) }));
  };

  const canNext = () => {
    if (step === 1) return intake.goals.length > 0;
    if (step === 2) return intake.skills.length > 0;
    if (step === 3) return intake.experienceText.trim().length > 0;
    if (step === 4) return intake.country && intake.language;
    if (step === 5) return intake.time;
    return true;
  };

  return (
    <div className="af-onboard">
      <div className="af-onboard-head">
        <Thread step={step} total={5} />
        <span className="af-step-label">Step {step} of 5</span>
      </div>

      {step === 1 && (
        <div className="af-step">
          <h2>What would you like Afriforce to help you achieve?</h2>
          <p className="af-hint">Choose as many as apply.</p>
          <div className="af-chip-grid">
            {GOALS.map((g) => (
              <Chip key={g.id} label={g.label} active={intake.goals.includes(g.id)} onClick={() => toggleGoal(g.id)} />
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="af-step">
          <h2>What can you already do?</h2>
          <p className="af-hint">Add a few skills — formal or informal, it all counts.</p>
          <div className="af-skill-input-row">
            <input
              className="af-input"
              placeholder="Type a skill and press enter"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSkill(skillInput)}
            />
            <button className="af-btn af-btn-ghost" onClick={() => addSkill(skillInput)}>Add</button>
          </div>
          <div className="af-suggest-row">
            {SKILL_SUGGESTIONS.filter((s) => !intake.skills.find((k) => k.name === s)).slice(0, 8).map((s) => (
              <Chip key={s} label={s} onClick={() => addSkill(s)} />
            ))}
          </div>
          {intake.skills.length > 0 && (
            <div className="af-selected-skills">
              {intake.skills.map((s) => (
                <span key={s.name} className="af-tag">
                  {s.name}
                  <button onClick={() => removeSkill(s.name)} aria-label={`Remove ${s.name}`}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="af-step">
          <h2>What have you done before?</h2>
          <p className="af-hint">Jobs, freelance work, a family business, volunteering — write it in your own words.</p>
          <textarea
            className="af-textarea"
            rows={5}
            placeholder="e.g. I've spent two years helping customers at a shop and managing our social media page…"
            value={intake.experienceText}
            onChange={(e) => setIntake((p) => ({ ...p, experienceText: e.target.value }))}
          />
        </div>
      )}

      {step === 4 && (
        <div className="af-step">
          <h2>Where are you, and what language works best?</h2>
          <div className="af-field">
            <label>Country</label>
            <select className="af-input" value={intake.country} onChange={(e) => setIntake((p) => ({ ...p, country: e.target.value }))}>
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="af-field">
            <label>City / region</label>
            <input className="af-input" value={intake.city} onChange={(e) => setIntake((p) => ({ ...p, city: e.target.value }))} placeholder="e.g. Kampala" />
          </div>
          <div className="af-field">
            <label>Preferred language</label>
            <select className="af-input" value={intake.language} onChange={(e) => setIntake((p) => ({ ...p, language: e.target.value }))}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <p className="af-microhint">Afriforce currently works in English. We're building toward more African languages.</p>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="af-step">
          <h2>How much time can you realistically commit?</h2>
          <div className="af-chip-grid">
            {TIME_OPTIONS.map((t) => (
              <Chip key={t} label={t} active={intake.time === t} onClick={() => setIntake((p) => ({ ...p, time: t }))} />
            ))}
          </div>
          <div className="af-field" style={{ marginTop: 20 }}>
            <label>Do you have any starting capital? (optional)</label>
            <input className="af-input" placeholder="e.g. around $50, or leave blank" value={intake.capital} onChange={(e) => setIntake((p) => ({ ...p, capital: e.target.value }))} />
          </div>
        </div>
      )}

      <div className="af-onboard-footer">
        {step > 1 && <button className="af-btn af-btn-ghost" onClick={() => setStep((s) => s - 1)}>Back</button>}
        <button
          className="af-btn af-btn-primary"
          disabled={!canNext()}
          onClick={() => (step === 5 ? onComplete() : setStep((s) => s + 1))}
        >
          {step === 5 ? 'See my profile' : 'Continue'} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                               */
/* ---------------------------------------------------------------------- */

function Dashboard({ intake, econProfile, nextAction, onStartAction, actionBusy, go, askText, setAskText, onAsk, askAnswer, askBusy }) {
  const firstName = 'there';
  return (
    <div className="af-screen">
      <p className="af-greeting">Good to see you.</p>
      <p className="af-greeting-sub">{econProfile?.recommendedPath}</p>

      <div className="af-card af-nextmove">
        <span className="af-label">Your next move</span>
        {nextAction ? (
          <>
            <h3>{nextAction.title}</h3>
            <p className="af-nextmove-why">{nextAction.why}</p>
            <div className="af-nextmove-meta">
              <span><Clock3 size={13} /> {nextAction.effort}</span>
              <span>{nextAction.benefit}</span>
            </div>
            <button className="af-btn af-btn-primary" disabled={actionBusy} onClick={onStartAction}>
              {actionBusy ? <Loader2 size={16} className="af-spin" /> : <>Start now <ArrowRight size={16} /></>}
            </button>
          </>
        ) : (
          <p className="af-nextmove-why">Preparing your next step…</p>
        )}
      </div>

      <div className="af-section-head">
        <span className="af-label">Opportunities for you</span>
        <button className="af-linklike" onClick={() => go('opportunities')}>See all <ChevronRight size={14} /></button>
      </div>
      <div className="af-oplist-preview">
        {(econProfile?.opportunityAreas || []).slice(0, 3).map((area, i) => (
          <div className="af-card af-op-mini" key={i}>
            <p>{area}</p>
          </div>
        ))}
      </div>

      <div className="af-section-head" style={{ marginTop: 28 }}>
        <span className="af-label">Ask Afriforce</span>
      </div>
      <div className="af-card af-ask">
        <div className="af-ask-row">
          <input
            className="af-input"
            placeholder="What are you trying to figure out?"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAsk()}
          />
          <button className="af-btn af-btn-ghost af-ask-send" onClick={onAsk} disabled={askBusy} aria-label="Send question">
            {askBusy ? <Loader2 size={16} className="af-spin" /> : <Send size={16} />}
          </button>
        </div>
        {askAnswer && <p className="af-ask-answer">{askAnswer}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Skills / assessment                                                     */
/* ---------------------------------------------------------------------- */

function SkillsPage({ skills, onAssess, onFreelance }) {
  return (
    <div className="af-screen">
      <h2 className="af-page-title">My skills</h2>
      <p className="af-hint">Practical assessments strengthen your profile more than self-reporting alone.</p>
      <div className="af-skill-list">
        {skills.map((s) => (
          <div className="af-card af-skill-row" key={s.name}>
            <div>
              <h4>{s.name}</h4>
              <p className="af-skill-meta">Self-reported: {s.selfLevel}</p>
              {s.assessed ? (
                <p className="af-skill-meta strong">Afriforce assessment: {s.assessedLevel} — {s.evidenceStatus}</p>
              ) : (
                <p className="af-skill-meta">Not yet assessed</p>
              )}
            </div>
            <div className="af-skill-actions">
              <button className="af-btn af-btn-ghost af-btn-sm" onClick={() => onAssess(s.name)}>
                {s.assessed ? 'Reassess' : 'Assess skill'}
              </button>
              <button className="af-btn af-btn-ghost af-btn-sm af-btn-quiet" onClick={() => onFreelance(s.name)}>
                Offer as a service
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssessmentFlow({ skillName, question, answer, setAnswer, busy, onSubmit, result, onDone }) {
  if (result) {
    return (
      <div className="af-screen">
        <span className="af-label">Your result</span>
        <h2 className="af-page-title">{skillName} — {result.level}</h2>
        <div className="af-card">
          <p><strong>What you demonstrated:</strong> {result.demonstrated}</p>
          <p style={{ marginTop: 10 }}><strong>Where you can improve:</strong> {result.improve}</p>
          <p className="af-microhint" style={{ marginTop: 14 }}>This is an AI-assessed estimate, not a formal certification.</p>
        </div>
        <button className="af-btn af-btn-primary" style={{ marginTop: 18 }} onClick={onDone}>
          Continue <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="af-screen">
      <span className="af-label">Skill assessment</span>
      <h2 className="af-page-title">Let's see what you can actually do with {skillName}.</h2>
      {question ? (
        <>
          <div className="af-card">
            <p>{question.scenario}</p>
            <p style={{ marginTop: 10, fontWeight: 600 }}>{question.question}</p>
          </div>
          <textarea
            className="af-textarea"
            rows={5}
            placeholder="Write how you'd handle it…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <button className="af-btn af-btn-primary" disabled={busy || !answer.trim()} onClick={onSubmit}>
            {busy ? <Loader2 size={16} className="af-spin" /> : <>Submit <ArrowRight size={16} /></>}
          </button>
        </>
      ) : (
        <LoadingSequence />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Freelance                                                               */
/* ---------------------------------------------------------------------- */

function FreelancePage({ skillName, pkg, onBack }) {
  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← Back to skills</button>
      <span className="af-label">Afriforce Freelance</span>
      <h2 className="af-page-title" style={{ marginTop: 6 }}>Turning {skillName} into a service</h2>
      {!pkg ? (
        <LoadingSequence />
      ) : (
        <>
          <div className="af-card">
            <span className="af-label">Service</span>
            <h3 style={{ marginTop: 6, fontSize: 17 }}>{pkg.serviceName}</h3>
            <p style={{ marginTop: 8 }}>{pkg.description}</p>
          </div>
          <div className="af-card">
            <span className="af-label">Pricing scenario</span>
            <p style={{ marginTop: 6, color: 'var(--ink)' }}>{pkg.pricingScenario}</p>
            <p className="af-microhint">A starting scenario, not a guaranteed rate — adjust as you learn what clients will pay.</p>
          </div>
          <div className="af-card">
            <span className="af-label">Finding your first clients</span>
            <ul className="af-bullets">{(pkg.firstSteps || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div className="af-card">
            <span className="af-label">Draft proposal</span>
            <p style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{pkg.proposalDraft}</p>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Employer                                                                 */
/* ---------------------------------------------------------------------- */

function EmployerIntake({ form, setForm, onSubmit, busy, onBack, error }) {
  const [skillInput, setSkillInput] = useState('');
  const addSkill = (name) => {
    const trimmed = name.trim();
    if (!trimmed || form.skills.includes(trimmed)) return;
    setForm((p) => ({ ...p, skills: [...p.skills, trimmed] }));
    setSkillInput('');
  };
  const removeSkill = (name) => setForm((p) => ({ ...p, skills: p.skills.filter((s) => s !== name) }));

  const canSubmit = form.role.trim() && form.skills.length > 0;

  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← Back to Afriforce</button>
      <span className="af-label">Afriforce for Employers</span>
      <h2 className="af-page-title" style={{ marginTop: 6 }}>What are you hiring for?</h2>

      <div className="af-field">
        <label>Role title</label>
        <input className="af-input" placeholder="e.g. Customer Support Associate" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} />
      </div>
      <div className="af-field">
        <label>Industry</label>
        <input className="af-input" placeholder="e.g. Fintech, retail, logistics" value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} />
      </div>
      <div className="af-field">
        <label>Required skills</label>
        <div className="af-skill-input-row">
          <input className="af-input" placeholder="Type a skill and press enter" value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSkill(skillInput)} />
          <button className="af-btn af-btn-ghost" onClick={() => addSkill(skillInput)}>Add</button>
        </div>
        {form.skills.length > 0 && (
          <div className="af-selected-skills">
            {form.skills.map((s) => (
              <span key={s} className="af-tag">{s}<button onClick={() => removeSkill(s)} aria-label={`Remove ${s}`}><X size={12} /></button></span>
            ))}
          </div>
        )}
      </div>
      <div className="af-field">
        <label>Location</label>
        <input className="af-input" placeholder="e.g. Lagos, Nigeria" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
      </div>
      <div className="af-field">
        <label>Work model</label>
        <div className="af-chip-grid">
          {['Remote', 'Hybrid', 'Onsite'].map((m) => (
            <Chip key={m} label={m} active={form.workModel === m} onClick={() => setForm((p) => ({ ...p, workModel: m }))} />
          ))}
        </div>
      </div>

      {busy ? <LoadingSequence /> : (
        <>
          {error && <p className="af-inline-error">Couldn't generate matches just now — try again.</p>}
          <button className="af-btn af-btn-primary" disabled={!canSubmit} onClick={onSubmit}>
            Find matching talent <ArrowRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function EmployerResults({ jobDescription, candidates, onBack }) {
  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← New search</button>

      <div className="af-card">
        <span className="af-label">Job description</span>
        <h3 style={{ marginTop: 8, fontSize: 17 }}>{jobDescription?.title}</h3>
        <p style={{ marginTop: 8 }}>{jobDescription?.summary}</p>
        <ul className="af-bullets" style={{ marginTop: 8 }}>
          {(jobDescription?.responsibilities || []).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      <span className="af-label">Matching talent</span>
      <p className="af-microhint" style={{ margin: '4px 0 14px' }}>A mix of real Afriforce members who opted into visibility and invented sample profiles used to fill out preview results.</p>
      <div className="af-op-list">
        {candidates.map((c, i) => (
          <div className="af-card af-candidate-card" key={i}>
            <div className="af-op-top">
              <div>
                <h4>{c.name}</h4>
                <p className="af-skill-meta">{c.headline}</p>
              </div>
              <StatusPill status={c.matchLevel} />
            </div>
            <p className="af-op-why">{c.why}</p>
            <div className="af-op-skills">
              {(c.have || []).map((h) => <span key={h} className="af-tag good"><Check size={11} /> {h}</span>)}
              {(c.need || []).map((n) => <span key={n} className="af-tag need">{n}</span>)}
            </div>
            <div className="af-op-meta">
              <span>{c.experience}</span>
              <span>{c.availability}</span>
            </div>
            <span className={`af-source-badge ${c.isReal ? 'real' : ''}`}>{c.isReal ? 'Afriforce member' : 'Sample preview'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Opportunities                                                           */
/* ---------------------------------------------------------------------- */

function OpportunitiesPage({ opportunities }) {
  const [tab, setTab] = useState('All');
  const tabs = ['All', 'Jobs', 'Freelance', 'Business', 'Learning'];
  const filtered = tab === 'All' ? opportunities : opportunities.filter((o) => o.category === tab);

  return (
    <div className="af-screen">
      <h2 className="af-page-title">Your opportunity radar</h2>
      <div className="af-tabs">
        {tabs.map((t) => (
          <button key={t} className={`af-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {!opportunities.length && <LoadingSequence />}
      <div className="af-op-list">
        {filtered.map((o, i) => (
          <div className="af-card af-op-card" key={i}>
            <div className="af-op-top">
              <h4>{o.title}</h4>
              <StatusPill status={o.matchLevel} />
            </div>
            <p className="af-op-why">{o.why}</p>
            <div className="af-op-skills">
              {(o.have || []).map((h) => <span key={h} className="af-tag good"><Check size={11} /> {h}</span>)}
              {(o.need || []).map((n) => <span key={n} className="af-tag need">{n}</span>)}
            </div>
            <div className="af-op-meta">
              <span><MapPin size={13} /> {o.remote ? 'Remote' : o.location}</span>
              <span className="af-microhint">AI estimate — preview data</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Progress / profile                                                      */
/* ---------------------------------------------------------------------- */

function ProgressPage({
  intake, econProfile, skills, actionsCompleted, opportunities, onReset,
  displayName, setDisplayName, visible, onToggleVisible, visibleBusy, onSignOut,
}) {
  const assessedCount = skills.filter((s) => s.assessed).length;
  return (
    <div className="af-screen">
      <h2 className="af-page-title">Your story</h2>

      <div className="af-card">
        <span className="af-label">What I'm good at</span>
        <ul className="af-bullets">
          {(econProfile?.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </div>

      <div className="af-card">
        <span className="af-label">What I'm working toward</span>
        <p>{intake.goals.map((g) => GOALS.find((x) => x.id === g)?.label).join(', ')}</p>
      </div>

      <div className="af-card">
        <span className="af-label">Worth strengthening</span>
        <ul className="af-bullets">
          {(econProfile?.skillGaps || []).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </div>

      <div className="af-progress-stats">
        <div className="af-stat"><span className="af-stat-num">{assessedCount}</span><span>skills assessed</span></div>
        <div className="af-stat"><span className="af-stat-num">{actionsCompleted}</span><span>actions completed</span></div>
        <div className="af-stat"><span className="af-stat-num">{opportunities.length}</span><span>opportunities found</span></div>
      </div>

      <div className="af-card af-visibility">
        <span className="af-label">Visible to employers</span>
        <p style={{ marginTop: 6 }}>
          Turning this on shares a lightweight version of your profile — display name, headline, skills, location and availability —
          with anyone using Afriforce for Employers. It does not share your full onboarding answers. This is genuinely shared, not a preview.
        </p>
        {visible && (
          <input
            className="af-input"
            style={{ marginTop: 12 }}
            placeholder="Display name shown to employers"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <button className="af-btn af-btn-ghost" style={{ marginTop: 12 }} disabled={visibleBusy} onClick={onToggleVisible}>
          {visibleBusy ? <Loader2 size={14} className="af-spin" /> : (visible ? 'Turn off visibility' : 'Make my profile visible')}
        </button>
      </div>

      <button className="af-btn af-btn-ghost" style={{ marginTop: 10 }} onClick={onReset}>
        <RotateCcw size={14} /> Start over with a new profile
      </button>
      <button className="af-btn af-btn-ghost" style={{ marginTop: 10 }} onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Business builder                                                        */
/* ---------------------------------------------------------------------- */

function BusinessPage({
  input, setInput, onAnalyze, busy, ideas,
  selected, onSelect, foundation, foundationBusy, onBack, onActivate, error,
}) {
  if (foundation) {
    return (
      <div className="af-screen">
        <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← Back to ideas</button>
        <span className="af-label">Business foundation</span>
        <h2 className="af-page-title">{selected?.title}</h2>

        <div className="af-card">
          <span className="af-label">Name ideas</span>
          <ul className="af-bullets">{(foundation.names || []).map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
        <div className="af-card">
          <span className="af-label">Value proposition</span>
          <p style={{ marginTop: 6, color: 'var(--ink)' }}>{foundation.valueProposition}</p>
        </div>
        <div className="af-card">
          <span className="af-label">Pricing approach</span>
          <p style={{ marginTop: 6, color: 'var(--ink)' }}>{foundation.pricingModel}</p>
        </div>
        <div className="af-card">
          <span className="af-label">Getting your first customers</span>
          <ul className="af-bullets">{(foundation.marketingIdeas || []).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
        <div className="af-card">
          <span className="af-label">Validate before you spend</span>
          <p className="af-hint" style={{ marginBottom: 8 }}>Test demand before committing capital.</p>
          <ul className="af-bullets">{(foundation.validationSteps || []).map((v, i) => <li key={i}>{v}</li>)}</ul>
        </div>
        <p className="af-microhint" style={{ marginBottom: 16 }}>These are AI-generated scenarios based on assumptions, not verified market data or guaranteed outcomes.</p>
        <button className="af-btn af-btn-primary" onClick={() => onActivate(selected, foundation)}>
          Start running this business <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  if (ideas.length) {
    return (
      <div className="af-screen">
        <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← Start over</button>
        <h2 className="af-page-title">A few realistic directions</h2>
        <p className="af-hint" style={{ marginBottom: 16 }}>Based on what you told us. Pick one to build it out further.</p>
        <div className="af-op-list">
          {ideas.map((idea, i) => (
            <div className="af-card af-biz-card" key={i}>
              <h4>{idea.title}</h4>
              <p className="af-op-why">{idea.why}</p>
              <div className="af-biz-grid">
                <div><span className="af-label">Target customer</span><p>{idea.targetCustomer}</p></div>
                <div><span className="af-label">Startup cost</span><p>{idea.startupCost}</p></div>
                <div><span className="af-label">Revenue model</span><p>{idea.revenueModel}</p></div>
                <div><span className="af-label">Main risk</span><p>{idea.majorRisks}</p></div>
              </div>
              <p className="af-hint" style={{ marginTop: 10 }}><strong>First 30 days:</strong> {idea.first30Days}</p>
              <button className="af-btn af-btn-primary" style={{ marginTop: 12 }} disabled={foundationBusy} onClick={() => onSelect(idea)}>
                {foundationBusy && selected?.title === idea.title ? <Loader2 size={16} className="af-spin" /> : <>Build this business <ArrowRight size={16} /></>}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="af-screen">
      <span className="af-label">Afriforce Business</span>
      <h2 className="af-page-title" style={{ marginTop: 6 }}>What do you want to build?</h2>
      <p className="af-hint" style={{ marginBottom: 14 }}>Tell us what you have — money, time, skills, location — in your own words.</p>
      <textarea
        className="af-textarea"
        rows={4}
        placeholder='e.g. "I have $200, live in Kampala, and know how to sell clothes"'
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {busy ? <LoadingSequence /> : (
        <>
          {error && <p className="af-inline-error">Couldn't analyze that just now — try again.</p>}
          <button className="af-btn af-btn-primary" disabled={!input.trim()} onClick={onAnalyze}>
            Analyze my opportunity <ArrowRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Business Copilot                                                        */
/* ---------------------------------------------------------------------- */

function CopilotPage({ business, onUpdateMetrics, onExplore, insight, insightBusy, onGetInsight, askText, setAskText, onAsk, askAnswer, askBusy }) {
  const { name, metrics } = business;
  const profit = metrics.revenue - metrics.expenses;
  const prevProfit = metrics.prevRevenue - metrics.prevExpenses;
  const profitChange = prevProfit !== 0 ? (((profit - prevProfit) / Math.abs(prevProfit)) * 100).toFixed(0) : null;

  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onExplore} style={{ marginBottom: 14 }}>← Explore a different idea</button>
      <span className="af-label">My business</span>
      <h2 className="af-page-title" style={{ marginTop: 6 }}>{name}</h2>
      <p className="af-microhint" style={{ marginBottom: 16 }}>Sample starting numbers for testing — replace with your real figures.</p>

      <div className="af-progress-stats">
        <div className="af-stat">
          <span className="af-stat-num">${profit}</span>
          <span>profit this month{profitChange !== null ? ` (${profitChange > 0 ? '+' : ''}${profitChange}%)` : ''}</span>
        </div>
        <div className="af-stat"><span className="af-stat-num">{metrics.customers}</span><span>customers this month</span></div>
      </div>

      <div className="af-card">
        <span className="af-label">This month's numbers</span>
        <div className="af-metric-grid">
          <div className="af-field">
            <label>Revenue ($)</label>
            <input className="af-input" type="number" value={metrics.revenue} onChange={(e) => onUpdateMetrics({ ...metrics, revenue: Number(e.target.value) || 0 })} />
          </div>
          <div className="af-field">
            <label>Expenses ($)</label>
            <input className="af-input" type="number" value={metrics.expenses} onChange={(e) => onUpdateMetrics({ ...metrics, expenses: Number(e.target.value) || 0 })} />
          </div>
          <div className="af-field">
            <label>Customers</label>
            <input className="af-input" type="number" value={metrics.customers} onChange={(e) => onUpdateMetrics({ ...metrics, customers: Number(e.target.value) || 0 })} />
          </div>
        </div>
      </div>

      <div className="af-card">
        <span className="af-label">AI insight</span>
        {insight ? (
          <>
            <p style={{ marginTop: 8, color: 'var(--ink)' }}>{insight.insight}</p>
            <p style={{ marginTop: 8, fontWeight: 600, color: 'var(--indigo)' }}>{insight.suggestion}</p>
          </>
        ) : (
          <p style={{ marginTop: 6 }}>Get a read on what these numbers suggest.</p>
        )}
        <button className="af-btn af-btn-ghost" style={{ marginTop: 12 }} disabled={insightBusy} onClick={onGetInsight}>
          {insightBusy ? <Loader2 size={14} className="af-spin" /> : 'Refresh insight'}
        </button>
      </div>

      <div className="af-card af-ask">
        <span className="af-label">Ask about your business</span>
        <div className="af-ask-row" style={{ marginTop: 10 }}>
          <input
            className="af-input"
            placeholder="e.g. Why did my profit fall?"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAsk()}
          />
          <button className="af-btn af-btn-ghost af-ask-send" onClick={onAsk} disabled={askBusy} aria-label="Send question">
            {askBusy ? <Loader2 size={16} className="af-spin" /> : <Send size={16} />}
          </button>
        </div>
        {askAnswer && <p className="af-ask-answer">{askAnswer}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Admin                                                                    */
/* ---------------------------------------------------------------------- */

function AdminPage({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await storage.list('talent:', true);
        const keys = list?.keys || [];
        const fetched = await Promise.all(keys.map((k) => storage.get(k, true).catch(() => null)));
        const parsed = fetched
          .filter(Boolean)
          .map((r) => { try { return JSON.parse(r.value); } catch (e) { return null; } })
          .filter(Boolean);
        setMembers(parsed);
      } catch (e) {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const skillCounts = {};
  const locationCounts = {};
  members.forEach((m) => {
    (m.have || []).forEach((s) => { skillCounts[s] = (skillCounts[s] || 0) + 1; });
    if (m.location) locationCounts[m.location] = (locationCounts[m.location] || 0) + 1;
  });
  const topSkills = Object.entries(skillCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← Back to Afriforce</button>
      <span className="af-label">Internal — Admin overview</span>
      <h2 className="af-page-title" style={{ marginTop: 6 }}>Real data only</h2>
      <p className="af-hint" style={{ marginBottom: 18 }}>
        This reads the actual shared talent records created when someone turns on "Visible to employers." Nothing here is invented.
      </p>

      {loading && <LoadingSequence />}
      {!loading && error && <p className="af-hint">Couldn't load records right now.</p>}

      {!loading && !error && (
        <>
          <div className="af-progress-stats">
            <div className="af-stat"><span className="af-stat-num">{members.length}</span><span>visible members</span></div>
            <div className="af-stat"><span className="af-stat-num">{topSkills.length}</span><span>distinct skills seen</span></div>
            <div className="af-stat"><span className="af-stat-num">{topLocations.length}</span><span>locations seen</span></div>
          </div>

          <div className="af-card">
            <span className="af-label">Most common skills among visible members</span>
            {topSkills.length ? (
              <ul className="af-bullets" style={{ marginTop: 8 }}>
                {topSkills.map(([s, n]) => <li key={s}>{s} — {n}</li>)}
              </ul>
            ) : <p style={{ marginTop: 8 }}>No visible members yet.</p>}
          </div>

          <div className="af-card">
            <span className="af-label">Locations</span>
            {topLocations.length ? (
              <ul className="af-bullets" style={{ marginTop: 8 }}>
                {topLocations.map(([l, n]) => <li key={l}>{l} — {n}</li>)}
              </ul>
            ) : <p style={{ marginTop: 8 }}>No visible members yet.</p>}
          </div>

          <div className="af-card">
            <span className="af-label">Members</span>
            {members.length ? (
              <div className="af-skill-list" style={{ marginTop: 8 }}>
                {members.map((m, i) => (
                  <div key={i} className="af-admin-member">
                    <strong>{m.name}</strong>
                    <span className="af-skill-meta">{m.headline}{m.location ? ` · ${m.location}` : ''}</span>
                    <span className="af-skill-meta">{(m.have || []).join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : <p style={{ marginTop: 8 }}>Nobody has opted into visibility yet — turn it on from the Profile tab to see a record here.</p>}
          </div>

          <p className="af-microhint">
            In a real deployment this view would sit behind employee authentication and would never expose full onboarding answers — only what members explicitly opted to share.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Auth                                                                     */
/* ---------------------------------------------------------------------- */

function firebaseAuthErrorMessage(e) {
  const code = e?.code || '';
  const map = {
    'auth/email-already-in-use': 'An account with that email already exists — try signing in instead.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/invalid-email': 'Enter a valid email.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts — wait a moment and try again.',
    'auth/network-request-failed': 'Network error — check your connection and try again.',
  };
  return map[code] || e?.message || 'Something went wrong.';
}

function AuthScreen({ onSuccess, onCancel, suggestedRole }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState(suggestedRole === 'employer' ? 'employer' : 'seeker');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!email.includes('@')) { setError('Enter a valid email.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      let cred;
      if (mode === 'register') {
        cred = await createUserWithEmailAndPassword(auth, email, password);
        const idToken = await cred.user.getIdToken();
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ role: accountType }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Account was created, but we could not finish setting it up. Try signing in.');
        }
      } else {
        cred = await signInWithEmailAndPassword(auth, email, password);
      }
      // Force-refresh so a just-assigned custom claim (role) is present
      // immediately rather than after the token's normal refresh cycle.
      const tokenResult = await cred.user.getIdTokenResult(true);
      onSuccess(tokenResult.claims.role || 'seeker');
    } catch (e) {
      setError(firebaseAuthErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onCancel} style={{ marginBottom: 14 }}>← Back</button>
      <span className="af-label">{mode === 'signin' ? 'Sign in' : 'Create your account'}</span>
      <h2 className="af-page-title" style={{ marginTop: 6, marginBottom: 16 }}>
        {mode === 'signin' ? 'Welcome back' : "Let's get your profile started"}
      </h2>

      {mode === 'register' && (
        <div className="af-field">
          <label>Account type</label>
          <div className="af-chip-grid">
            <Chip label="Job seeker" active={accountType === 'seeker'} onClick={() => setAccountType('seeker')} />
            <Chip label="Employer" active={accountType === 'employer'} onClick={() => setAccountType('employer')} />
          </div>
          <p className="af-microhint">This decides which parts of Afriforce your account can access — you can't switch it later without contacting support in a real deployment.</p>
        </div>
      )}

      <div className="af-field">
        <label>Email</label>
        <input className="af-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
      <div className="af-field">
        <label>Password</label>
        <input className="af-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {mode === 'register' && <p className="af-microhint">At least 8 characters.</p>}
      </div>

      {error && <p className="af-inline-error">{error}</p>}

      <button className="af-btn af-btn-primary" disabled={busy} onClick={submit}>
        {busy ? <Loader2 size={16} className="af-spin" /> : (mode === 'signin' ? 'Sign in' : 'Create account')}
      </button>
      <button
        className="af-btn af-btn-ghost"
        style={{ marginTop: 10 }}
        onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(''); }}
      >
        {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}

function RoleErrorScreen({ message, onBack }) {
  return (
    <div className="af-screen">
      <button className="af-linklike" onClick={onBack} style={{ marginBottom: 14 }}>← Back</button>
      <span className="af-label">Access</span>
      <h2 className="af-page-title" style={{ marginTop: 6, marginBottom: 10 }}>This isn't available for your account</h2>
      <p>{message}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Root app                                                                 */
/* ---------------------------------------------------------------------- */

const EMPTY_INTAKE = {
  goals: [], skills: [], experienceText: '', country: '', city: '',
  language: 'English', time: '', capital: '',
};

export default function App() {
  // Firebase equivalent of next-auth's useSession(): tracks the current
  // user and their role custom claim. `status` mirrors the same
  // 'loading' | 'authenticated' | 'unauthenticated' values used
  // throughout this file below, so the rest of the gating logic didn't
  // need to change shape.
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [role, setRole] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setFirebaseUser(null);
        setRole(null);
        setStatus('unauthenticated');
        return;
      }
      setFirebaseUser(user);
      try {
        const tokenResult = await user.getIdTokenResult();
        setRole(tokenResult.claims.role || null);
      } catch (e) {
        setRole(null);
      }
      setStatus('authenticated');
    });
    return () => unsubscribe();
  }, []);

  const [pendingAction, setPendingAction] = useState(null);
  const [roleErrorMessage, setRoleErrorMessage] = useState('');

  const [screen, setScreen] = useState('landing');
  const [intake, setIntake] = useState(EMPTY_INTAKE);
  const [econProfile, setEconProfile] = useState(null);
  const [skills, setSkills] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [nextAction, setNextAction] = useState(null);
  const [actionsCompleted, setActionsCompleted] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);

  const [assessSkill, setAssessSkill] = useState(null);
  const [assessQuestion, setAssessQuestion] = useState(null);
  const [assessAnswer, setAssessAnswer] = useState('');
  const [assessBusy, setAssessBusy] = useState(false);
  const [assessResult, setAssessResult] = useState(null);

  const [askText, setAskText] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [askBusy, setAskBusy] = useState(false);

  const [bizInput, setBizInput] = useState('');
  const [bizIdeas, setBizIdeas] = useState([]);
  const [bizBusy, setBizBusy] = useState(false);
  const [bizSelected, setBizSelected] = useState(null);
  const [bizFoundation, setBizFoundation] = useState(null);
  const [bizFoundationBusy, setBizFoundationBusy] = useState(false);

  const [freelanceSkill, setFreelanceSkill] = useState(null);
  const [freelancePkg, setFreelancePkg] = useState(null);

  const [employerForm, setEmployerForm] = useState({ role: '', industry: '', skills: [], location: '', workModel: 'Remote' });
  const [employerBusy, setEmployerBusy] = useState(false);
  const [employerJob, setEmployerJob] = useState(null);
  const [employerCandidates, setEmployerCandidates] = useState([]);

  const [talentId, setTalentId] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [visible, setVisible] = useState(false);
  const [visibleBusy, setVisibleBusy] = useState(false);

  const [activeBusiness, setActiveBusiness] = useState(null);
  const [bizInsight, setBizInsight] = useState(null);
  const [bizInsightBusy, setBizInsightBusy] = useState(false);
  const [bizAskText, setBizAskText] = useState('');
  const [bizAskAnswer, setBizAskAnswer] = useState('');
  const [bizAskBusy, setBizAskBusy] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [lastOnboardingIntake, setLastOnboardingIntake] = useState(null);
  const [genErrorDetail, setGenErrorDetail] = useState(null);
  const [employerError, setEmployerError] = useState(false);
  const [bizError, setBizError] = useState(false);

  const intakeRef = useRef(intake);
  useEffect(() => { intakeRef.current = intake; }, [intake]);

  // Load any saved profile once we know whether someone's signed in.
  // Anonymous visitors (marketing page, employer/admin views) never hit
  // the personal-storage endpoint, avoiding pointless 401s.
  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') { setLoaded(true); return; }
    (async () => {
      try {
        const res = await storage.get('profile', false);
        if (res && res.value) {
          const saved = JSON.parse(res.value);
          if (saved.intake) setIntake(saved.intake);
          if (saved.econProfile) { setEconProfile(saved.econProfile); setScreen('dashboard'); }
          if (saved.skills) setSkills(saved.skills);
          if (saved.opportunities) setOpportunities(saved.opportunities);
          if (saved.nextAction) setNextAction(saved.nextAction);
          if (typeof saved.actionsCompleted === 'number') setActionsCompleted(saved.actionsCompleted);
          if (saved.displayName) setDisplayName(saved.displayName);
          if (typeof saved.visible === 'boolean') setVisible(saved.visible);
          if (saved.talentId) setTalentId(saved.talentId);
          if (saved.activeBusiness) setActiveBusiness(saved.activeBusiness);
        }
        if (!(res && res.value && JSON.parse(res.value).talentId)) {
          setTalentId(`t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        }
      } catch (e) {
        setTalentId(`t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      } finally {
        setLoaded(true);
      }
    })();
  }, [status]);

  // Persist progress whenever it changes — only once signed in.
  useEffect(() => {
    if (!loaded || status !== 'authenticated') return;
    const data = { intake, econProfile, skills, opportunities, nextAction, actionsCompleted, displayName, visible, talentId, activeBusiness };
    storage.set('profile', JSON.stringify(data), false).catch(() => {});
  }, [loaded, status, intake, econProfile, skills, opportunities, nextAction, actionsCompleted, displayName, visible, talentId, activeBusiness]);

  function buildPublicTalentProfile() {
    return {
      name: displayName.trim() || 'Afriforce member',
      headline: econProfile?.strengths?.[0] || intake.skills[0]?.name || 'Afriforce member',
      have: skills.filter((s) => s.assessed).map((s) => s.name).slice(0, 4).concat(
        skills.filter((s) => !s.assessed).map((s) => s.name)
      ).slice(0, 5),
      experience: intake.experienceText.slice(0, 160),
      location: `${intake.city}${intake.city && intake.country ? ', ' : ''}${intake.country}`,
      availability: intake.time,
      languages: intake.language,
      updatedAt: Date.now(),
    };
  }

  async function toggleVisibility() {
    if (!talentId) return;
    setVisibleBusy(true);
    try {
      if (visible) {
        await storage.delete(`talent:${talentId}`, true);
        setVisible(false);
      } else {
        await storage.set(`talent:${talentId}`, JSON.stringify(buildPublicTalentProfile()), true);
        setVisible(true);
      }
    } catch (e) {
      // leave state unchanged on failure
    } finally {
      setVisibleBusy(false);
    }
  }

  async function resetAll() {
    try { await storage.delete('profile', false); } catch (e) { /* nothing to clear */ }
    if (visible && talentId) { try { await storage.delete(`talent:${talentId}`, true); } catch (e) { /* noop */ } }
    setIntake(EMPTY_INTAKE);
    setEconProfile(null);
    setSkills([]);
    setOpportunities([]);
    setNextAction(null);
    setActionsCompleted(0);
    setDisplayName('');
    setVisible(false);
    resetBusiness();
    setActiveBusiness(null);
    setScreen('landing');
  }

  const profileSummary = (src) => {
    const i = src || intake;
    return `Goals: ${i.goals.join(', ')}. Skills: ${i.skills.map((s) => s.name).join(', ')}. Experience: ${i.experienceText}. Location: ${i.city}, ${i.country}. Time available: ${i.time}. Capital: ${i.capital || 'none stated'}.`;
  };

  async function completeOnboarding(overrideIntake) {
    const src = overrideIntake || intake;
    setSkills(src.skills.map((s) => ({ name: s.name, selfLevel: s.selfLevel, assessed: false })));
    setScreen('generating');

    const [profile, opps] = await Promise.all([
      askAfriforce(SYSTEM, `Based on this person's onboarding answers, generate their Afriforce Economic Profile.\n\n${profileSummary(src)}\n\nRespond as JSON with exactly these keys: strengths (array of 3 short strings), developingSkills (array of up to 3 short strings), skillGaps (array of up to 3 short strings), opportunityAreas (array of 3 short strings, each describing a category of realistic opportunity for this person), recommendedPath (1-2 sentence string summarizing their strongest realistic direction), nextAction (object with title, why, effort, benefit — a single concrete first step, ideally to complete a skill assessment for one of their listed skills, phrased like "Complete your X assessment"), nextActionSkill (the exact skill name from their list that the nextAction refers to, or null).`),
      askAfriforce(SYSTEM, `Based on this person, generate 6 realistic development-preview opportunities.\n\n${profileSummary(src)}\n\nRespond as JSON: an array of 6 objects, each with keys: title, category (one of "Jobs","Freelance","Business","Learning"), matchLevel (one of "Strong match","Good match","Partial match","Needs preparation"), why (1 sentence explaining the fit using their actual skills/experience), have (array of up to 2 skills they already have that are relevant), need (array of up to 2 skills worth strengthening), location (a real city/country near theirs, or "Remote"), remote (boolean).`),
    ]);

    if (profile) {
      setEconProfile(profile);
      setNextAction({
        title: profile.nextAction?.title || 'Complete a skill assessment',
        why: profile.nextAction?.why || '',
        effort: profile.nextAction?.effort || '10–15 minutes',
        benefit: profile.nextAction?.benefit || '',
        skillName: profile.nextActionSkill || src.skills[0]?.name,
      });
    }
    if (opps) setOpportunities(opps);

    if (!profile && !opps) {
      setLastOnboardingIntake(src);
      setGenErrorDetail(lastAiError);
      setScreen('gen-error');
      return;
    }
    setScreen('dashboard');
  }

  function tryPersona(persona) {
    requireAuth(() => {
      setIntake(persona.intake);
      completeOnboarding(persona.intake);
    }, ['seeker', 'admin']);
  }

  // Gate any entry point that needs a real account behind sign-in *and*
  // the right account type. If already signed in with an allowed role,
  // runs the action immediately. If signed in with the wrong role, shows
  // an explanation instead of silently failing (e.g. a job-seeker account
  // trying to open the employer search). If not signed in, remembers the
  // action + allowed roles and shows the auth screen; afterAuthSuccess
  // re-checks role against a freshly-fetched session once auth completes.
  function requireAuth(action, allowedRoles) {
    if (status === 'authenticated') {
      if (allowedRoles && !allowedRoles.includes(role)) {
        setRoleErrorMessage(roleErrorMessageFor(allowedRoles));
        setScreen('role-error');
        return;
      }
      action();
      return;
    }
    setPendingAction({ run: action, allowedRoles });
    setScreen('auth');
  }

  function roleErrorMessageFor(allowedRoles) {
    if (allowedRoles?.includes('employer')) {
      return "This is part of Afriforce for Employers — sign in with an employer account, or create one from the sign-in screen.";
    }
    if (allowedRoles?.includes('admin') && allowedRoles.length === 1) {
      return "This is an internal admin view and isn't available on your account.";
    }
    return "This part of Afriforce isn't available for your account type.";
  }

  // Called by AuthScreen right after a successful sign-in/registration,
  // passed the just-fetched role claim directly (rather than reading it
  // back off this component's `role` state, which updates asynchronously
  // via the onAuthStateChanged listener above and could still be stale
  // at this exact moment).
  function afterAuthSuccess(freshRole) {
    setScreen('landing');
    if (!pendingAction) return;
    const { run, allowedRoles } = pendingAction;
    setPendingAction(null);
    if (allowedRoles && !allowedRoles.includes(freshRole)) {
      setRoleErrorMessage(roleErrorMessageFor(allowedRoles));
      setScreen('role-error');
      return;
    }
    run();
  }

  async function analyzeBusiness() {
    setBizBusy(true);
    setBizIdeas([]);
    setBizError(false);
    const res = await askAfriforce(SYSTEM, `Someone described what they have available to start a business:\n\n"${bizInput}"\n\n${hasProfile ? profileSummary() : ''}\n\nGenerate 3 realistic, distinct business opportunities they could pursue with what they described. Respond as JSON: an array of 3 objects with keys: title, why (1 sentence on why this fits what they described), targetCustomer, startupCost (a short range/scenario, not a promise), revenueModel (1 short sentence), majorRisks (1 short sentence), first30Days (1-2 sentence plan).`);
    if (res) setBizIdeas(res); else setBizError(true);
    setBizBusy(false);
  }

  async function selectBusinessIdea(idea) {
    setBizSelected(idea);
    setBizFoundationBusy(true);
    const res = await askAfriforce(SYSTEM, `Someone is building this business idea:\n\nTitle: ${idea.title}\nWhy it fits: ${idea.why}\nTarget customer: ${idea.targetCustomer}\nRevenue model: ${idea.revenueModel}\n\nGenerate a starter business foundation. Respond as JSON: {names: array of 3 short business name ideas, valueProposition: "1-2 sentences", pricingModel: "1-2 sentences with a concrete scenario, labeled as an assumption", marketingIdeas: array of 3 short concrete first steps to get customers, validationSteps: array of 3 short concrete ways to test demand before spending money}.`);
    setBizFoundation(res || {
      names: ['(unavailable — try again)'], valueProposition: '', pricingModel: '', marketingIdeas: [], validationSteps: [],
    });
    setBizFoundationBusy(false);
  }

  function resetBusiness() {
    setBizIdeas([]);
    setBizSelected(null);
    setBizFoundation(null);
    setBizInput('');
  }

  function seedStarterMetrics(idea) {
    // Deterministic-ish sample numbers derived from the idea, for testing only.
    let hash = 0;
    for (const ch of (idea?.title || 'business')) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
    const baseRevenue = 300 + (hash % 900);
    const baseExpenses = Math.round(baseRevenue * (0.45 + (hash % 30) / 100));
    const customers = 8 + (hash % 25);
    return {
      revenue: baseRevenue,
      expenses: baseExpenses,
      customers,
      prevRevenue: Math.round(baseRevenue * (0.8 + (hash % 20) / 100)),
      prevExpenses: Math.round(baseExpenses * (0.9 + (hash % 15) / 100)),
    };
  }

  function activateBusiness(idea, foundation) {
    setActiveBusiness({
      name: foundation?.names?.[0] || idea.title,
      idea, foundation,
      metrics: seedStarterMetrics(idea),
    });
    setBizInsight(null);
    setBizAskAnswer('');
    setScreen('business');
  }

  function updateBizMetrics(metrics) {
    setActiveBusiness((prev) => (prev ? { ...prev, metrics } : prev));
    setBizInsight(null);
  }

  async function getBizInsight() {
    if (!activeBusiness) return;
    setBizInsightBusy(true);
    const { name, metrics } = activeBusiness;
    const res = await askAfriforce(SYSTEM, `A small business called "${name}" has these numbers this month: revenue $${metrics.revenue}, expenses $${metrics.expenses}, customers ${metrics.customers}. Last month: revenue $${metrics.prevRevenue}, expenses $${metrics.prevExpenses}.\n\nGive a short, honest read on what's happening and one concrete suggestion. Don't fabricate causes you can't see from the numbers — reason only from what's given. Respond as JSON: {insight: "2-3 sentences", suggestion: "1 short concrete action"}.`);
    setBizInsight(res || { insight: "Couldn't reach Afriforce Intelligence just now.", suggestion: '' });
    setBizInsightBusy(false);
  }

  async function handleBizAsk() {
    if (!bizAskText.trim() || !activeBusiness) return;
    setBizAskBusy(true);
    setBizAskAnswer('');
    const { name, metrics, idea } = activeBusiness;
    const res = await askAfriforce(SYSTEM, `Business: "${name}" (${idea.title}). This month: revenue $${metrics.revenue}, expenses $${metrics.expenses}, customers ${metrics.customers}. Last month: revenue $${metrics.prevRevenue}, expenses $${metrics.prevExpenses}.\n\nThey're asking: "${bizAskText}"\n\nAnswer in 2-3 short, concrete sentences reasoning only from the numbers given — don't invent causes you can't see. Respond as JSON: {answer: "your response"}.`);
    setBizAskAnswer(res?.answer || "Couldn't reach Afriforce Intelligence — try again.");
    setBizAskBusy(false);
  }

  function exploreNewIdea() {
    setActiveBusiness(null);
    resetBusiness();
    setBizInsight(null);
    setBizAskAnswer('');
  }

  async function openFreelance(skillName) {
    setFreelanceSkill(skillName);
    setFreelancePkg(null);
    setScreen('freelance');
    const res = await askAfriforce(SYSTEM, `This person wants to turn their "${skillName}" skill into a freelance service.\n\n${hasProfile ? profileSummary() : `Skill: ${skillName}`}\n\nRespond as JSON: {serviceName: "a short marketable service name", description: "1-2 sentences describing what's offered", pricingScenario: "1-2 sentences with a concrete starting price scenario appropriate to their likely market, labeled as a starting point not a fixed rate", firstSteps: array of 3 short concrete ways to find first clients, proposalDraft: "a short 3-4 sentence draft message they could send a potential client, written in first person"}.`);
    setFreelancePkg(res || {
      serviceName: skillName, description: 'Unable to generate right now — try again.',
      pricingScenario: '', firstSteps: [], proposalDraft: '',
    });
  }

  async function submitEmployerSearch() {
    setEmployerBusy(true);
    setEmployerJob(null);
    setEmployerCandidates([]);
    setEmployerError(false);

    // Pull real opted-in member profiles from shared storage.
    let realProfiles = [];
    try {
      const list = await storage.list('talent:', true);
      const keys = (list?.keys || []).slice(0, 25);
      const fetched = await Promise.all(keys.map((k) => storage.get(k, true).catch(() => null)));
      realProfiles = fetched
        .filter(Boolean)
        .map((r) => { try { return JSON.parse(r.value); } catch (e) { return null; } })
        .filter(Boolean);
    } catch (e) {
      realProfiles = [];
    }

    const res = await askAfriforce(SYSTEM, `An employer wants to hire for this role:\nTitle: ${employerForm.role}\nIndustry: ${employerForm.industry || 'not specified'}\nRequired skills: ${employerForm.skills.join(', ')}\nLocation: ${employerForm.location || 'not specified'}\nWork model: ${employerForm.workModel}\n\nHere are real member profiles who opted into visibility (JSON, may be empty): ${JSON.stringify(realProfiles).slice(0, 3000)}\n\nFirst, evaluate each real member profile honestly against the role — only include ones that are a genuine match (any match level is fine, including "Needs preparation", but don't force a fit that isn't there). Then invent additional clearly-fictional sample candidate profiles to bring the total to 4, for preview purposes.\n\nRespond as JSON: {jobDescription: {title, summary: "2 sentences", responsibilities: array of 3 short bullet points}, candidates: array of up to 4 objects each with keys name (use the real member's name if from a real profile, otherwise an invented full name), headline, matchLevel (one of "Strong match","Good match","Partial match","Needs preparation"), why (1 sentence), have (array of up to 2 matching skills), need (array of up to 2 gaps), experience ("X years" style short string), availability, isReal (true only if this candidate came from the real member profiles provided above, false otherwise)}.`);
    if (res) {
      setEmployerJob(res.jobDescription || null);
      setEmployerCandidates(res.candidates || []);
      setEmployerError(false);
      setScreen('employer-results');
    } else {
      setEmployerError(true);
    }
    setEmployerBusy(false);
  }

  function resetEmployer() {
    setEmployerForm({ role: '', industry: '', skills: [], location: '', workModel: 'Remote' });
    setEmployerJob(null);
    setEmployerCandidates([]);
    setScreen('employer-intake');
  }

  async function recomputeNextAction(latestSkills, latestActionsCompleted) {
    const unassessed = latestSkills.filter((s) => !s.assessed);
    if (unassessed.length > 0) {
      setNextAction({
        title: `Complete your ${unassessed[0].name} assessment`,
        why: `This will replace your self-reported level with a real, evidence-backed one.`,
        effort: '10–15 minutes',
        benefit: `Strengthens your match across current opportunities.`,
        skillName: unassessed[0].name,
      });
      return;
    }
    const res = await askAfriforce(SYSTEM, `This person has assessed all their listed skills and completed ${latestActionsCompleted} action(s) so far.\n\n${profileSummary()}\n\nSuggest their single next best action — something like exploring a specific opportunity, building a portfolio piece, or validating a business idea. Respond as JSON: {title, why, effort, benefit}.`);
    if (res) setNextAction({ ...res, skillName: null });
  }

  function startAction() {
    if (!nextAction) return;
    if (nextAction.skillName) {
      openAssessment(nextAction.skillName);
      return;
    }
    setActionBusy(true);
    setTimeout(async () => {
      const completed = actionsCompleted + 1;
      setActionsCompleted(completed);
      await recomputeNextAction(skills, completed);
      setActionBusy(false);
    }, 500);
  }

  async function openAssessment(name) {
    setAssessSkill(name);
    setAssessQuestion(null);
    setAssessAnswer('');
    setAssessResult(null);
    setScreen('assessment');
    const q = await askAfriforce(SYSTEM, `Create a short, realistic practical scenario to test someone's "${name}" skill — the kind of situation they'd actually face doing this work. Respond as JSON: {scenario: "1-2 sentence setup", question: "one direct question asking what they would do"}.`);
    setAssessQuestion(q || { scenario: `Imagine you're using ${name} in a real work situation.`, question: 'What would you do first, and why?' });
  }

  async function submitAssessment() {
    setAssessBusy(true);
    const res = await askAfriforce(SYSTEM, `Skill being assessed: "${assessSkill}".\nScenario given: ${assessQuestion?.scenario} ${assessQuestion?.question}\nTheir answer: "${assessAnswer}"\n\nEvaluate their answer honestly and constructively. Respond as JSON: {level: one of "Beginner","Intermediate","Advanced", demonstrated: "1 sentence on what their answer showed", improve: "1 sentence on what would strengthen it"}.`);
    const result = res || { level: 'Intermediate', demonstrated: 'A reasonable practical approach.', improve: 'Adding more specific detail would help.' };
    setAssessResult(result);
    setAssessBusy(false);
  }

  function finishAssessment() {
    const updated = skills.map((s) => (s.name === assessSkill
      ? { ...s, assessed: true, assessedLevel: assessResult.level, evidenceStatus: 'AI-assessed' }
      : s));
    setSkills(updated);
    const completed = actionsCompleted + 1;
    setActionsCompleted(completed);
    recomputeNextAction(updated, completed);
    setScreen('dashboard');
  }

  async function handleAsk() {
    if (!askText.trim()) return;
    setAskBusy(true);
    setAskAnswer('');
    const res = await askAfriforce(SYSTEM, `${profileSummary()}\n\nThey're asking: "${askText}"\n\nAnswer in 2-3 short, concrete, encouraging sentences grounded in what they told you. Respond as JSON: {answer: "your response"}.`);
    setAskAnswer(res?.answer || "I couldn't reach Afriforce Intelligence just now — try again in a moment.");
    setAskBusy(false);
  }

  const hasProfile = !!econProfile;

  return (
    <div className="af-app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

        :root {
          --ink: #171B22;
          --indigo: #1F3A5F;
          --indigo-deep: #14283F;
          --ochre: #B8763E;
          --moss: #4B6350;
          --stone: #F3F2EE;
          --stone-line: #E4E1D9;
          --paper: #FFFFFF;
          --muted: #6B6F76;
          --shadow-card: 0 1px 2px rgba(23,27,34,0.04), 0 2px 8px rgba(23,27,34,0.04);
          --shadow-raised: 0 4px 16px rgba(23,27,34,0.08);

          /* Stacking scale — every z-index in this file should reference
             one of these rather than a magic number, so future additions
             (a toast, a modal) have a documented place in line rather
             than an arbitrary guess that risks sitting under/over the
             wrong thing. Only --z-fixed-nav is in use today since the
             two fixed bars below never appear on screen simultaneously. */
          --z-fixed-nav: 30;
          --z-overlay: 40;
        }
        * { box-sizing: border-box; }

        /* Overlap prevention, applied broadly on purpose: flex/grid
           children default to a min-width of "auto" (their content's
           natural width), which is exactly what causes sibling elements
           to overflow their box and visually overlap a neighbor once
           content is longer than expected (a long job title, a long
           email, a translated label). Letting text wrap or truncate
           instead — rather than spill outside its container — is the
           actual fix; these two rules are the base of that everywhere
           in the app, with a handful of deliberate exceptions below
           where truncation with an ellipsis reads better than wrapping
           (nav labels, pills). */
        p, h1, h2, h3, h4, span, li, label, a {
          overflow-wrap: break-word;
          word-break: break-word;
        }
        img, svg { max-width: 100%; }

        .af-app {
          font-family: 'Inter', sans-serif;
          background: var(--stone);
          color: var(--ink);
          min-height: 600px;
          max-width: 480px;
          margin: 0 auto;
          position: relative;
          /* Generous, deliberately over-sized clearance for the fixed
             bottom nav (which can grow slightly if a label wraps on a
             narrow device) plus the iOS/Android home-indicator safe
             area, so page content never sits underneath it. */
          padding-bottom: ${hasProfile ? 'calc(100px + env(safe-area-inset-bottom))' : '0'};
        }
        h1, h2, h3, h4 { font-family: 'Space Grotesk', sans-serif; margin: 0; letter-spacing: -0.01em; }
        p { margin: 0; line-height: 1.55; color: var(--muted); }

        /* Landing */
        .af-landing { padding: 40px 22px 30px; }
        .af-eyebrow { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13px; color: var(--indigo); letter-spacing: 0.08em; text-transform: uppercase; }
        .af-h1 { font-size: 32px; line-height: 1.15; color: var(--ink); margin: 14px 0 16px; font-weight: 600; }
        .af-lead { font-size: 15px; margin-bottom: 26px; }
        .af-cta-row { display: flex; flex-wrap: wrap; gap: 10px; }
        .af-how { margin-top: 40px; display: flex; flex-direction: column; }
        .af-how-item { padding: 14px 0; }
        .af-how-index { font-family: 'Space Grotesk', sans-serif; font-weight: 600; color: var(--indigo); font-size: 15px; }
        .af-how-item p { margin-top: 4px; font-size: 14px; }
        .af-line-v { width: 1px; height: 16px; background: var(--stone-line); margin-left: 2px; }
        .af-trust { margin-top: 30px; padding: 16px; background: var(--paper); border-radius: 10px; border: 1px solid var(--stone-line); }
        .af-trust p { font-size: 13px; }
        .af-employer-link { text-align: center; margin-top: 22px; }
        .af-admin-link { text-align: center; margin-top: 10px; }
        .af-tinylink { background: none; border: none; color: var(--muted); font-size: 11.5px; cursor: pointer; text-decoration: underline; }
        .af-admin-member { display: flex; flex-direction: column; gap: 2px; padding: 10px 0; border-bottom: 1px solid var(--stone-line); }
        .af-admin-member:last-child { border-bottom: none; }
        .af-personas { margin-top: 34px; padding-top: 26px; border-top: 1px solid var(--stone-line); }
        .af-persona-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .af-persona-card { text-align: left; background: var(--paper); border: 1px solid var(--stone-line); border-radius: 10px; padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; min-width: 0; transition: border-color .15s, box-shadow .15s; }
        .af-persona-card:hover { border-color: var(--indigo); box-shadow: var(--shadow-card); }
        .af-persona-card:hover { border-color: var(--indigo); }
        .af-persona-name { font-size: 12.5px; font-weight: 600; color: var(--ink); }
        .af-persona-blurb { font-size: 11.5px; color: var(--muted); }

        /* Buttons */
        .af-btn { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 14px; border-radius: 9px; padding: 12px 18px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; cursor: pointer; border: none; transition: background-color .15s, transform .1s, opacity .15s; }
        .af-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .af-btn:active:not(:disabled) { transform: scale(0.98); }
        .af-btn-primary { background: var(--indigo); color: #fff; }
        .af-btn-primary:hover:not(:disabled) { background: var(--indigo-deep); }
        .af-btn-ghost { background: transparent; color: var(--indigo); border: 1px solid var(--stone-line); }
        .af-btn-ghost:hover:not(:disabled) { background: rgba(31,58,95,0.06); border-color: var(--indigo); }
        .af-btn-sm { padding: 8px 12px; font-size: 13px; }
        .af-spin { animation: af-spin 0.9s linear infinite; }
        @keyframes af-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .af-spin { animation: none; }
        }

        /* Accessibility: visible focus for keyboard navigation */
        a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
          outline: 2px solid var(--indigo);
          outline-offset: 2px;
        }

        .af-error-state { text-align: center; padding: 60px 24px; }
        .af-error-state p { font-size: 14px; margin-bottom: 18px; }
        .af-error-detail { font-size: 12px; color: var(--muted); text-align: left; background: var(--paper); border: 1px solid var(--stone-line); border-radius: 8px; padding: 12px; }
        .af-error-detail code { display: block; margin-top: 4px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: var(--ink); overflow-wrap: break-word; }
        .af-error-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
        .af-inline-error { font-size: 13px; color: #A5432E; margin-bottom: 10px; }

        /* Thread / step indicator */
        .af-thread { display: flex; align-items: center; }
        .af-node { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--stone-line); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
        .af-node.active { border-color: var(--indigo); }
        .af-node.done { background: var(--indigo); border-color: var(--indigo); }
        .af-line { flex: 1; height: 2px; background: var(--stone-line); margin: 0 4px; }
        .af-line.done { background: var(--indigo); }

        /* Onboarding */
        .af-onboard { padding: 24px 22px 100px; }
        .af-onboard-head { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
        .af-step-label { font-size: 12px; color: var(--muted); white-space: nowrap; }
        .af-step h2 { font-size: 21px; margin-bottom: 6px; }
        .af-hint { font-size: 13px; margin-bottom: 16px; }
        .af-microhint { font-size: 12px; color: var(--muted); margin-top: 6px; }
        .af-chip-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .af-chip { font-family: 'Inter', sans-serif; font-size: 13.5px; padding: 9px 14px; border-radius: 20px; border: 1px solid var(--stone-line); background: var(--paper); cursor: pointer; color: var(--ink); transition: border-color .15s, background-color .15s; }
        .af-chip:hover:not(.active) { border-color: var(--indigo); }
        .af-chip.active { background: var(--indigo); border-color: var(--indigo); color: #fff; }
        .af-skill-input-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .af-input { font-family: 'Inter', sans-serif; font-size: 14px; padding: 11px 13px; border-radius: 8px; border: 1px solid var(--stone-line); background: var(--paper); width: 100%; color: var(--ink); }
        .af-textarea { font-family: 'Inter', sans-serif; font-size: 14px; padding: 12px 13px; border-radius: 8px; border: 1px solid var(--stone-line); background: var(--paper); width: 100%; margin: 10px 0 16px; resize: vertical; color: var(--ink); }
        .af-suggest-row { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
        .af-selected-skills { display: flex; flex-wrap: wrap; gap: 7px; }
        .af-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; background: var(--paper); border: 1px solid var(--stone-line); border-radius: 16px; padding: 6px 10px; color: var(--ink); }
        .af-tag button { border: none; background: none; cursor: pointer; display: flex; color: var(--muted); }
        .af-tag.good { border-color: var(--moss); color: var(--moss); }
        .af-tag.need { color: var(--ochre); border-color: var(--ochre); }
        .af-field { margin-bottom: 16px; }
        .af-field label { font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 6px; color: var(--ink); }
        .af-onboard-footer {
          position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
          width: 100%; max-width: 480px; z-index: var(--z-fixed-nav);
          display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;
          padding: 16px 22px calc(16px + env(safe-area-inset-bottom));
          background: linear-gradient(to top, var(--stone) 70%, transparent);
        }

        /* Generic screen */
        .af-screen { padding: 22px 22px 30px; }
        .af-page-title { font-size: 20px; margin-bottom: 6px; }
        .af-label { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--indigo); }
        .af-greeting { font-family: 'Space Grotesk', sans-serif; font-size: 21px; font-weight: 600; margin-top: 4px; }
        .af-greeting-sub { font-size: 13.5px; margin: 6px 0 22px; }

        .af-card { background: var(--paper); border: 1px solid var(--stone-line); border-radius: 12px; padding: 18px; margin-bottom: 14px; box-shadow: var(--shadow-card); }
        .af-nextmove h3 { font-size: 18px; margin: 8px 0 6px; }
        .af-nextmove-why { font-size: 13.5px; margin-bottom: 12px; }
        .af-nextmove-meta { display: flex; gap: 14px; font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
        .af-nextmove-meta span { display: flex; align-items: center; gap: 4px; }

        .af-section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .af-linklike { background: none; border: none; color: var(--indigo); font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 2px; cursor: pointer; }
        .af-oplist-preview { display: flex; flex-direction: column; gap: 8px; }
        .af-op-mini { padding: 13px 15px; margin-bottom: 0; }
        .af-op-mini p { font-size: 13.5px; color: var(--ink); }

        .af-ask-row { display: flex; gap: 8px; }
        .af-ask-row .af-input { flex: 1; min-width: 0; }
        .af-ask-send { padding: 11px; }
        .af-ask-answer { font-size: 13.5px; margin-top: 12px; color: var(--ink); }

        .af-bullets { padding-left: 18px; margin: 8px 0 0; }
        .af-bullets li { font-size: 14px; color: var(--ink); margin-bottom: 5px; }

        .af-skill-list { display: flex; flex-direction: column; gap: 10px; }
        .af-skill-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .af-skill-row > div:first-child { min-width: 0; }
        .af-skill-row h4 { font-size: 15px; }
        .af-skill-meta { font-size: 12.5px; margin-top: 3px; }
        .af-skill-meta.strong { color: var(--moss); font-weight: 600; }
        .af-skill-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .af-btn-quiet { color: var(--muted); border-color: var(--stone-line); }

        .af-tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 16px; }
        .af-tab { font-size: 13px; padding: 8px 13px; border-radius: 20px; border: 1px solid var(--stone-line); background: var(--paper); white-space: nowrap; cursor: pointer; color: var(--ink); transition: border-color .15s; }
        .af-tab:hover:not(.active) { border-color: var(--indigo); }
        .af-tab.active { background: var(--indigo); border-color: var(--indigo); color: #fff; }
        .af-op-list { display: flex; flex-direction: column; gap: 12px; }
        .af-op-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
        .af-op-top > div:first-child { min-width: 0; flex: 1 1 auto; }
        .af-op-top .af-pill { flex-shrink: 0; }
        .af-op-top h4 { font-size: 15.5px; }
        .af-op-why { font-size: 13.5px; margin-bottom: 10px; }
        .af-op-skills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .af-op-meta { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--muted); }
        .af-op-meta span:first-child { display: flex; align-items: center; gap: 4px; }

        .af-biz-card h4 { font-size: 16px; margin-bottom: 6px; }
        .af-biz-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
        .af-biz-grid > div { min-width: 0; }
        .af-biz-grid p { font-size: 13px; color: var(--ink); margin-top: 2px; }
        .af-visibility p { font-size: 13px; }
        .af-source-badge { display: inline-block; margin-top: 10px; font-size: 11px; font-weight: 600; color: var(--muted); background: var(--stone); border-radius: 10px; padding: 3px 9px; }
        .af-source-badge.real { color: var(--moss); background: #E6EEE7; }
        .af-metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
        .af-metric-grid .af-field { min-width: 0; }
        .af-metric-grid .af-field { margin-bottom: 0; }

        .af-pill { font-size: 11px; font-weight: 600; padding: 4px 9px; border-radius: 12px; white-space: nowrap; }
        .af-pill.strong { background: #E6EEE7; color: var(--moss); }
        .af-pill.good { background: #EAF0F6; color: var(--indigo); }
        .af-pill.partial { background: #F5EEE2; color: var(--ochre); }
        .af-pill.prep { background: #F1EFEC; color: var(--muted); }

        .af-progress-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
        .af-stat { flex: 1 1 100px; min-width: 0; background: var(--paper); border: 1px solid var(--stone-line); border-radius: 12px; padding: 16px 10px; text-align: center; }
        .af-stat-num { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; color: var(--indigo); overflow-wrap: break-word; }
        .af-stat span:last-child { display: block; overflow-wrap: break-word; font-size: 11.5px; color: var(--muted); }

        /* Loading */
        .af-loading { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; text-align: center; }
        .af-loading-thread { display: flex; gap: 8px; margin-bottom: 18px; }
        .af-loading-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--stone-line); transition: background .3s; }
        .af-loading-dot.lit { background: var(--indigo); }
        .af-loading-text { font-size: 14px; color: var(--muted); }

        /* Bottom nav */
        .af-bottomnav {
          position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
          width: 100%; max-width: 480px; z-index: var(--z-fixed-nav);
          background: var(--paper); border-top: 1px solid var(--stone-line);
          display: flex; justify-content: space-around;
          padding: 10px 0 calc(14px + env(safe-area-inset-bottom));
        }
        .af-navitem {
          background: none; border: none; display: flex; flex-direction: column; align-items: center;
          gap: 3px; font-size: 10.5px; color: var(--muted); cursor: pointer;
          flex: 1 1 0; min-width: 0; padding: 0 2px;
        }
        .af-navitem span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .af-navitem.active { color: var(--indigo); font-weight: 600; }
      `}</style>

      {screen === 'landing' && (
        <Landing
          onStart={() => requireAuth(() => setScreen('onboard'), ['seeker', 'admin'])}
          onTryPersona={tryPersona}
          onEmployer={() => requireAuth(() => setScreen('employer-intake'), ['employer', 'admin'])}
          onAdmin={() => requireAuth(() => setScreen('admin'), ['admin'])}
        />
      )}

      {screen === 'role-error' && (
        <RoleErrorScreen message={roleErrorMessage} onBack={() => setScreen('landing')} />
      )}

      {screen === 'auth' && (
        <AuthScreen
          onSuccess={afterAuthSuccess}
          onCancel={() => setScreen('landing')}
          suggestedRole={pendingAction?.allowedRoles?.includes('employer') ? 'employer' : 'seeker'}
        />
      )}

      {screen === 'onboard' && (
        <Onboarding intake={intake} setIntake={setIntake} onComplete={completeOnboarding} />
      )}

      {screen === 'generating' && <LoadingSequence />}

      {screen === 'gen-error' && (
        <ErrorState
          message="We couldn't put your profile together just now. Your answers are safe — nothing was lost."
          detail={genErrorDetail}
          onRetry={() => completeOnboarding(lastOnboardingIntake || intake)}
        />
      )}

      {screen === 'dashboard' && (
        <Dashboard
          intake={intake}
          econProfile={econProfile}
          nextAction={nextAction}
          onStartAction={startAction}
          actionBusy={actionBusy}
          go={setScreen}
          askText={askText}
          setAskText={setAskText}
          onAsk={handleAsk}
          askAnswer={askAnswer}
          askBusy={askBusy}
        />
      )}

      {screen === 'skills' && <SkillsPage skills={skills} onAssess={openAssessment} onFreelance={openFreelance} />}

      {screen === 'assessment' && (
        <AssessmentFlow
          skillName={assessSkill}
          question={assessQuestion}
          answer={assessAnswer}
          setAnswer={setAssessAnswer}
          busy={assessBusy}
          onSubmit={submitAssessment}
          result={assessResult}
          onDone={finishAssessment}
        />
      )}

      {screen === 'opportunities' && <OpportunitiesPage opportunities={opportunities} />}

      {screen === 'freelance' && (
        <FreelancePage skillName={freelanceSkill} pkg={freelancePkg} onBack={() => setScreen('skills')} />
      )}

      {screen === 'employer-intake' && (
        <EmployerIntake form={employerForm} setForm={setEmployerForm} onSubmit={submitEmployerSearch} busy={employerBusy} onBack={() => setScreen('landing')} error={employerError} />
      )}

      {screen === 'employer-results' && (
        <EmployerResults jobDescription={employerJob} candidates={employerCandidates} onBack={resetEmployer} />
      )}

      {screen === 'admin' && <AdminPage onBack={() => setScreen('landing')} />}

      {screen === 'business' && activeBusiness && (
        <CopilotPage
          business={activeBusiness}
          onUpdateMetrics={updateBizMetrics}
          onExplore={exploreNewIdea}
          insight={bizInsight}
          insightBusy={bizInsightBusy}
          onGetInsight={getBizInsight}
          askText={bizAskText}
          setAskText={setBizAskText}
          onAsk={handleBizAsk}
          askAnswer={bizAskAnswer}
          askBusy={bizAskBusy}
        />
      )}

      {screen === 'business' && !activeBusiness && (
        <BusinessPage
          input={bizInput}
          setInput={setBizInput}
          onAnalyze={analyzeBusiness}
          busy={bizBusy}
          ideas={bizIdeas}
          selected={bizSelected}
          onSelect={selectBusinessIdea}
          foundation={bizFoundation}
          foundationBusy={bizFoundationBusy}
          onBack={resetBusiness}
          onActivate={activateBusiness}
          error={bizError}
        />
      )}

      {screen === 'progress' && (
        <ProgressPage
          intake={intake}
          econProfile={econProfile}
          skills={skills}
          actionsCompleted={actionsCompleted}
          opportunities={opportunities}
          onReset={resetAll}
          displayName={displayName}
          setDisplayName={setDisplayName}
          visible={visible}
          onToggleVisible={toggleVisibility}
          visibleBusy={visibleBusy}
          onSignOut={() => firebaseSignOut(auth)}
        />
      )}

      <BottomNav screen={screen} go={setScreen} hasProfile={hasProfile && screen !== 'onboard' && screen !== 'landing' && screen !== 'generating'} />
    </div>
  );
}
