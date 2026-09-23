/** Utilidades para digerir los CSV que exporta Jira, que vienen de mil formas. */

export type Csv = { headers: string[]; rows: string[][]; delimiter: string };

/** Parser con máquina de estados: soporta comillas, separadores y saltos de línea dentro del campo. */
export function parseCsv(input: string, delimiter?: string): Csv {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const delim = delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (clean.shift() ?? []).map((h) => h.trim());
  return { headers, rows: clean, delimiter: delim };
}

/** Jira en español exporta con ';' porque la coma es el separador decimal. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/* ------------------------------------------------------------------- fechas */

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Devuelve 'YYYY-MM-DD' o null. `dayFirst` resuelve el 03/04/2026 ambiguo
 * (europeo por defecto).
 */
export function parseDate(value: string, dayFirst = true): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;

  // 2026-09-01, con o sin hora
  const isoM = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoM) return iso(+isoM[1], +isoM[2], +isoM[3]);

  // 01/Sep/26 3:04 PM  ·  1-sep-2026
  const named = v.match(/^(\d{1,2})[\/\-\s]([A-Za-zÁÉÍÓÚáéíóú]{3,})[\/\-\s](\d{2,4})/);
  if (named) {
    const key = named[2]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .slice(0, 4);
    const m = MONTHS[key] ?? MONTHS[key.slice(0, 3)];
    if (m) {
      let y = +named[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      return iso(y, m, +named[1]);
    }
  }

  // 01/09/2026 · 09-01-26
  const num = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (num) {
    let a = +num[1];
    let b = +num[2];
    let y = +num[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    // si uno de los dos pasa de 12 no hay ambigüedad posible
    const day = b > 12 ? b : a > 12 ? a : dayFirst ? a : b;
    const month = b > 12 ? a : a > 12 ? b : dayFirst ? b : a;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return iso(y, month, day);
  }

  const t = Date.parse(v);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/**
 * Extrae la hora del apunte, si la columna de fecha la lleva ("2026-09-01 10:00").
 * Se usa sólo como discriminador al deduplicar: distingue dos apuntes iguales
 * hechos a distinta hora. Devuelve null si sólo hay fecha.
 */
export function parseTimestamp(value: string): string | null {
  const m = (value ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = +m[1];
  const ampm = m[4]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${pad(h)}:${m[2]}${m[3] ? `:${m[3]}` : ''}`;
}

/* ------------------------------------------------------------------ tiempos */

export type TimeUnit = 'hours' | 'seconds' | 'jira';

/** Jira: 1d = 8h y 1w = 5d, que son los valores por defecto. */
const JIRA_UNIT_HOURS: Record<string, number> = { w: 40, d: 8, h: 1, m: 1 / 60, s: 1 / 3600 };

export function parseHours(value: string, unit: TimeUnit): number | null {
  const v = (value ?? '').trim();
  if (!v) return null;

  if (unit === 'jira' || /[a-z]/i.test(v)) {
    const parts = v.matchAll(/(\d+(?:[.,]\d+)?)\s*([wdhms])/gi);
    let total = 0;
    let found = false;
    for (const p of parts) {
      const n = parseFloat(p[1].replace(',', '.'));
      const f = JIRA_UNIT_HOURS[p[2].toLowerCase()];
      if (!Number.isNaN(n) && f) {
        total += n * f;
        found = true;
      }
    }
    if (found) return Math.round(total * 10000) / 10000;
    if (unit === 'jira') return null;
  }

  const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return unit === 'seconds' ? Math.round((n / 3600) * 10000) / 10000 : n;
}

/** Adivina la unidad mirando la cabecera y una muestra de valores. */
export function detectTimeUnit(header: string, samples: string[]): TimeUnit {
  const h = header.toLowerCase();
  if (/second|segundo/.test(h)) return 'seconds';

  const vals = samples.map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (vals.some((v) => /\d\s*[wdhm]\b/i.test(v))) return 'jira';

  const nums = vals
    .map((v) => parseFloat(v.replace(/\s/g, '').replace(',', '.')))
    .filter((n) => !Number.isNaN(n));
  // nadie dedica 3.600 horas a una tarea: eso son segundos
  if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 600)) return 'seconds';

  return 'hours';
}

/* ------------------------------------------------ auto-mapeo de columnas */

// Los nombres en castellano se mantienen a propósito: son candidatos de cabecera
// para reconocer un export de Jira en español, no texto de la interfaz.
const CANDIDATES: Record<string, string[]> = {
  issue_key: ['issue key', 'issuekey', 'clave de incidencia', 'clave', 'issue', 'key', 'incidencia'],
  author: [
    'worklog author', 'author', 'autor', 'full name', 'display name', 'nombre completo',
    'usuario', 'user', 'worker', 'nombre', 'updated by',
  ],
  date: [
    'worklog started', 'started', 'work date', 'fecha de trabajo', 'fecha', 'date',
    'log date', 'created', 'día', 'dia',
  ],
  hours: [
    'time spent (seconds)', 'timespentseconds', 'time spent', 'timespent', 'tiempo dedicado',
    'tiempo empleado', 'horas', 'hours', 'duration', 'duración', 'duracion', 'tiempo',
  ],
  comment: [
    'worklog comment', 'comment', 'comentario', 'work description', 'description',
    'descripción', 'descripcion', 'nota',
  ],
  external_id: ['worklog id', 'worklogid', 'id de worklog', 'log id'],
  parent_key: ['parent key', 'parentkey', 'clave padre', 'padre', 'parent'],
  issue_summary: ['issue summary', 'summary', 'resumen', 'título', 'titulo', 'title'],
  original_estimate: ['issue original estimate', 'original estimate', 'estimacion original', 'estimación original'],
  remaining_estimate: ['issue remaining estimate', 'remaining estimate', 'restante', 'pendiente'],
};

/** Devuelve el índice de columna más probable para cada campo, o -1. */
export function autoMap(headers: string[]): Record<string, number> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const out: Record<string, number> = {};

  for (const [field, names] of Object.entries(CANDIDATES)) {
    let best = -1;
    let bestScore = 0;
    lower.forEach((h, i) => {
      for (const n of names) {
        // coincidencia exacta manda sobre la parcial; el orden de `names` desempata
        const score = h === n ? 100 - names.indexOf(n) : h.includes(n) ? 50 - names.indexOf(n) : 0;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    });
    out[field] = best;
  }
  return out;
}

/** Empareja el nombre del CSV con un usuario existente por parecido de nombre. */
export function guessUser(
  author: string,
  users: { id: string; name: string }[]
): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = clean(author);
  if (!a) return '';

  for (const u of users) if (clean(u.name) === a || clean(u.id) === a) return u.id;
  for (const u of users) {
    const n = clean(u.name);
    if (n && (a.includes(n) || n.includes(a))) return u.id;
  }
  // por nombre de pila: "Ana Ferrer" contra el usuario "Ana"
  const first = clean(author.split(/[\s,]+/)[0] ?? '');
  if (first.length >= 3) {
    for (const u of users) if (clean(u.name).startsWith(first)) return u.id;
  }
  return '';
}
