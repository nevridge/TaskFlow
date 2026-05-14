// Journal entry page — Date / TODOs / Daily Log / Notes for the active day.
// Each date is its own record; data persists in localStorage.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ─── helpers ────────────────────────────────────────────────────────────────

const PROJECT_START = '2026-01-01'; // anchor for Day/Week numbering

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function dayDiff(a, b) {
  const ms = parseISO(a).getTime() - parseISO(b).getTime();
  return Math.round(ms / 86400000);
}
function todayISO() {
  return isoDate(new Date());
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

function formatLong(s) {
  const d = parseISO(s);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function formatShort(s) {
  const d = parseISO(s);
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}
function formatTime() {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

// Day/Week numbering relative to PROJECT_START
function dayWeek(s) {
  const diff = dayDiff(s, PROJECT_START);
  const dayNum = diff + 1;
  const weekNum = Math.floor(diff / 7) + 1;
  return { dayNum, weekNum };
}

// ─── storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'taskflow_journal_v1';

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
}
function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const EMPTY_ENTRY = () => ({ todos: [], log: [], notes: '' });

// Seed two days of demo data so the page never looks empty on first load
function seedDemo() {
  const today = todayISO();
  const yest = addDays(today, -1);
  return {
    [yest]: {
      todos: [
        { id: 1, text: 'Wire up health check probe in K8s manifest', done: true },
        { id: 2, text: 'Review Trivy container scan findings', done: true },
        { id: 3, text: 'Draft API versioning blog post', done: false },
      ],
      log: [
        { id: 1, time: '9:14 AM', text: 'Standup — committed to v1.2 deploy by Friday' },
        { id: 2, time: '11:02 AM', text: 'Pair-debugged the EF Core migration startup race' },
        { id: 3, time: '2:30 PM', text: 'Cut release branch and ran smoke tests' },
        { id: 4, time: '4:45 PM', text: 'PR review for Note pagination' },
      ],
      notes: 'Migration race only repros under SQLite. Worth opening an EF issue with a min-repro tomorrow.',
    },
    [today]: {
      todos: [
        { id: 1, text: 'File EF Core min-repro issue', done: false },
        { id: 2, text: 'Finish API versioning draft', done: false },
        { id: 3, text: 'Sync with Tom on QA env teardown', done: true },
        { id: 4, text: 'Review OIDC secrets rotation runbook', done: false },
      ],
      log: [
        { id: 1, time: '9:00 AM', text: 'Standup — flagged the migration race blocker' },
        { id: 2, time: '10:20 AM', text: 'Coffee + caught up on the OTEL → Seq dashboard PR' },
      ],
      notes: '',
    },
  };
}

// ─── App ────────────────────────────────────────────────────────────────────

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "headerStyle": "stat",
  "todoSort": "manual",
  "density": "regular",
  "accent": "#2563eb",
  "showCarryOver": true,
  "dark": false
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [date, setDate] = useState(todayISO());
  const [store, setStore] = useState(() => {
    const existing = loadAll();
    if (Object.keys(existing).length === 0) {
      const seeded = seedDemo();
      saveAll(seeded);
      return seeded;
    }
    return existing;
  });

  const entry = store[date] || EMPTY_ENTRY();

  const updateEntry = useCallback((patch) => {
    setStore(prev => {
      const next = { ...prev, [date]: { ...EMPTY_ENTRY(), ...(prev[date] || {}), ...patch } };
      saveAll(next);
      return next;
    });
  }, [date]);

  const { dayNum, weekNum } = dayWeek(date);
  const isToday = date === todayISO();
  const dowName = DAY_NAMES[parseISO(date).getDay()];

  // Scale density
  const densityVar = t.density === 'compact' ? '0.85' : t.density === 'comfy' ? '1.15' : '1';

  useEffect(() => {
    document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
  }, [t.dark]);

  return (
    <div className={'page' + (t.dark ? ' is-dark' : '')} style={{ '--accent': t.accent, '--den': densityVar }}>
      <div className="shell">
        <DateNav date={date} setDate={setDate} />

        <article className="journal" data-screen-label="Journal">
          <Header
            date={date}
            dayNum={dayNum}
            weekNum={weekNum}
            dowName={dowName}
            isToday={isToday}
            style={t.headerStyle}
          />

          <section className="grid">
            <Todos
              todos={entry.todos}
              sort={t.todoSort}
              showCarryOver={t.showCarryOver}
              isToday={isToday}
              prevOpenCount={(() => {
                const yEntry = store[addDays(date, -1)];
                return yEntry ? yEntry.todos.filter(td => !td.done).length : 0;
              })()}
              onChange={(todos) => updateEntry({ todos })}
              onCarryOver={() => {
                if (isToday) {
                  // Pull yesterday's open TODOs into today
                  const yKey = addDays(date, -1);
                  const yEntry = store[yKey];
                  if (!yEntry) return;
                  const open = yEntry.todos.filter(td => !td.done);
                  if (open.length === 0) return;
                  const existing = new Set(entry.todos.map(x => x.text));
                  const additions = open.filter(o => !existing.has(o.text)).map((o, i) => ({
                    id: Date.now() + i, text: o.text, done: false,
                  }));
                  if (additions.length === 0) return;
                  updateEntry({ todos: [...entry.todos, ...additions] });
                } else {
                  // Push this day's open TODOs forward to today
                  const open = entry.todos.filter(td => !td.done);
                  if (open.length === 0) return;
                  const today = todayISO();
                  const tEntry = store[today] || EMPTY_ENTRY();
                  const existing = new Set(tEntry.todos.map(x => x.text));
                  const additions = open.filter(o => !existing.has(o.text)).map((o, i) => ({
                    id: Date.now() + i, text: o.text, done: false,
                  }));
                  setStore(prev => {
                    const next = { ...prev, [today]: { ...EMPTY_ENTRY(), ...tEntry, todos: [...tEntry.todos, ...additions] } };
                    saveAll(next);
                    return next;
                  });
                  setDate(today);
                }
              }}
            />
            <Log
              entries={entry.log}
              onChange={(log) => updateEntry({ log })}
            />
          </section>

          <Notes value={entry.notes} onChange={(notes) => updateEntry({ notes })} />
        </article>
      </div>

      <TweaksPanel>
        <TweakSection label="Header" />
        <TweakRadio
          label="Style"
          value={t.headerStyle}
          options={['stat', 'minimal']}
          onChange={(v) => setTweak('headerStyle', v)}
        />
        <TweakSection label="TODOs" />
        <TweakRadio
          label="Sort"
          value={t.todoSort}
          options={['manual', 'open first', 'done last']}
          onChange={(v) => setTweak('todoSort', v)}
        />
        <TweakToggle
          label="Carry-over button"
          value={t.showCarryOver}
          onChange={(v) => setTweak('showCarryOver', v)}
        />
        <TweakSection label="Layout" />
        <TweakRadio
          label="Density"
          value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)}
        />
        <TweakSection label="Theme" />
        <TweakToggle
          label="Dark mode"
          value={t.dark}
          onChange={(v) => setTweak('dark', v)}
        />
        <TweakColor
          label="Accent"
          value={t.accent}
          options={['#2563eb', '#0f766e', '#b45309', '#7c3aed']}
          onChange={(v) => setTweak('accent', v)}
        />
        <TweakButton onClick={() => {
          if (window.confirm('Reset all journal entries?')) {
            localStorage.removeItem(STORAGE_KEY);
            setStore(seedDemo());
            saveAll(seedDemo());
          }
        }}>Reset journal data</TweakButton>
      </TweaksPanel>
    </div>
  );
}

// ─── Date navigation ────────────────────────────────────────────────────────

function DateNav({ date, setDate }) {
  const today = todayISO();
  const isToday = date === today;
  return (
    <div className="datenav">
      <button className="dn-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <input
        type="date"
        className="dn-date"
        value={date}
        onChange={(e) => e.target.value && setDate(e.target.value)}
      />
      <button className="dn-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <button
        className={'dn-today' + (isToday ? ' is-active' : '')}
        onClick={() => setDate(today)}
      >Today</button>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({ date, dayNum, weekNum, dowName, isToday, style }) {
  if (style === 'minimal') {
    return (
      <header className="hdr hdr-min">
        <div>
          <div className="hdr-eyebrow">Day {dayNum} · Week {weekNum}</div>
          <h1 className="hdr-title">{dowName}</h1>
        </div>
        <div className="hdr-date">{formatShort(date)}</div>
      </header>
    );
  }
  return (
    <header className="hdr">
      <div className="hdr-stat">
        <div className="hdr-stat-row">
          <div className="hdr-num">
            <span className="hdr-num-label">DAY</span>
            <span className="hdr-num-val">{dayNum}</span>
          </div>
          <div className="hdr-num">
            <span className="hdr-num-label">WEEK</span>
            <span className="hdr-num-val">{weekNum}</span>
          </div>
        </div>
        {isToday && <span className="hdr-today">Today</span>}
      </div>
      <div className="hdr-date-block">
        <div className="hdr-dow">{dowName}</div>
        <div className="hdr-fulldate">{formatLong(date)}</div>
      </div>
    </header>
  );
}

// ─── TODOs ──────────────────────────────────────────────────────────────────

function Todos({ todos, sort, showCarryOver, isToday, prevOpenCount, onChange, onCarryOver }) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const sorted = useMemo(() => {
    const arr = [...todos];
    if (sort === 'open first') arr.sort((a, b) => Number(a.done) - Number(b.done));
    if (sort === 'done last') arr.sort((a, b) => Number(a.done) - Number(b.done));
    return arr;
  }, [todos, sort]);

  const remaining = todos.filter(td => !td.done).length;
  const total = todos.length;

  function addTodo(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onChange([...todos, { id: Date.now(), text, done: false }]);
    setDraft('');
  }
  function toggle(id) {
    onChange(todos.map(td => td.id === id ? { ...td, done: !td.done } : td));
  }
  function remove(id) {
    onChange(todos.filter(td => td.id !== id));
  }
  function commitEdit() {
    if (editingId == null) return;
    const text = editingText.trim();
    onChange(text
      ? todos.map(td => td.id === editingId ? { ...td, text } : td)
      : todos.filter(td => td.id !== editingId)
    );
    setEditingId(null);
    setEditingText('');
  }

  return (
    <section className="card todos">
      <div className="card-hdr">
        <h2 className="card-title">TODOs</h2>
        <div className="card-meta">
          <span className="todo-count">{total - remaining}/{total || 0}</span>
          {showCarryOver && (
            isToday
              ? (prevOpenCount > 0 && (
                  <button className="link-btn" onClick={onCarryOver} title="Pull yesterday's open TODOs into today">
                    ← Pull from yesterday ({prevOpenCount})
                  </button>
                ))
              : (remaining > 0 && (
                  <button className="link-btn" onClick={onCarryOver} title="Move incomplete TODOs to today">
                    Carry over to today →
                  </button>
                ))
          )}
        </div>
      </div>

      <ul className="todo-list">
        {sorted.length === 0 && <li className="empty">No TODOs yet — add one below.</li>}
        {sorted.map(td => (
          <li key={td.id} className={'todo' + (td.done ? ' is-done' : '')}>
            <button className="todo-check" onClick={() => toggle(td.id)} aria-label={td.done ? 'Mark not done' : 'Mark done'}>
              {td.done && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
            {editingId === td.id ? (
              <input
                className="todo-edit"
                value={editingText}
                autoFocus
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditingId(null); setEditingText(''); } }}
              />
            ) : (
              <span
                className="todo-text"
                onDoubleClick={() => { setEditingId(td.id); setEditingText(td.text); }}
              >{td.text}</span>
            )}
            <button className="todo-x" onClick={() => remove(td.id)} aria-label="Delete">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </li>
        ))}
      </ul>

      <form className="add-row" onSubmit={addTodo}>
        <span className="add-plus">+</span>
        <input
          className="add-input"
          placeholder="Add a TODO and press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </section>
  );
}

// ─── Daily Log ──────────────────────────────────────────────────────────────

function Log({ entries, onChange }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  function addEntry(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onChange([...entries, { id: Date.now(), time: formatTime(), text }]);
    setDraft('');
    inputRef.current?.focus();
  }
  function remove(id) {
    onChange(entries.filter(en => en.id !== id));
  }

  return (
    <section className="card log">
      <div className="card-hdr">
        <h2 className="card-title">Daily Log</h2>
        <div className="card-meta">
          <span className="todo-count">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
        </div>
      </div>

      <ol className="log-list">
        {entries.length === 0 && <li className="empty">No log entries yet — capture what you worked on below.</li>}
        {entries.map(en => (
          <li key={en.id} className="log-entry">
            <div className="log-time">{en.time}</div>
            <div className="log-text">{en.text}</div>
            <button className="todo-x" onClick={() => remove(en.id)} aria-label="Delete entry">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </li>
        ))}
      </ol>

      <form className="add-row" onSubmit={addEntry}>
        <span className="add-plus">›</span>
        <input
          ref={inputRef}
          className="add-input"
          placeholder="What did you just work on? Press Enter to log"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </section>
  );
}

// ─── Notes ──────────────────────────────────────────────────────────────────

function Notes({ value, onChange }) {
  const [savedAt, setSavedAt] = useState(null);
  const ref = useRef(null);

  // Debounced "saved" indicator
  useEffect(() => {
    if (value == null) return;
    const id = setTimeout(() => setSavedAt(Date.now()), 400);
    return () => clearTimeout(id);
  }, [value]);

  return (
    <section className="card notes">
      <div className="card-hdr">
        <h2 className="card-title">Notes</h2>
        <div className="card-meta">
          <span className="word-count">{(value || '').trim().split(/\s+/).filter(Boolean).length} words</span>
          {savedAt && <span className="saved">Saved</span>}
        </div>
      </div>
      <textarea
        ref={ref}
        className="notes-area"
        placeholder="Free-form notes for the day — observations, decisions, follow-ups, anything."
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </section>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
