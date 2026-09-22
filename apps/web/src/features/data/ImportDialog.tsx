import type { ImportItemInput, ImportResult, Span } from '@crowd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react';
import Papa from 'papaparse';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/display';
import { Checkbox, Field, Select } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn } from '../../lib/utils';
import { useProjectContext } from '../projects/ProjectLayout';

type Row = Record<string, unknown>;
const NONE = '__none__';
const CHUNK = 1000;

function guess(columns: string[], names: string[]): string | undefined {
  return columns.find((c) => names.includes(c.toLowerCase().trim()));
}

async function parseFile(file: File): Promise<{ rows: Row[]; columns: string[] }> {
  const text = await file.text();
  const name = file.name.toLowerCase();
  if (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.ndjson')) {
    let data: unknown;
    const trimmed = text.trim();
    if (trimmed.startsWith('[')) data = JSON.parse(trimmed);
    else
      data = trimmed
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    const rows = (data as unknown[]).map((r) => (typeof r === 'string' ? { text: r } : (r as Row)));
    const columns = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))];
    return { rows, columns };
  }
  if (name.endsWith('.txt')) {
    const rows = text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => ({ text: l }));
    return { rows, columns: ['text'] };
  }
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: name.endsWith('.tsv') ? '\t' : '',
  });
  return { rows: parsed.data, columns: parsed.meta.fields ?? [] };
}

function parseSpans(v: unknown): Span[] | undefined {
  if (v == null || v === '') return undefined;
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(arr)) return undefined;
    return arr
      .filter(
        (s) =>
          s &&
          typeof s.start === 'number' &&
          typeof s.end === 'number' &&
          typeof s.label === 'string',
      )
      .map((s) => ({ start: s.start, end: s.end, label: s.label }));
  } catch {
    return undefined;
  }
}

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [textCol, setTextCol] = useState<string>(NONE);
  const [labelCol, setLabelCol] = useState<string>(NONE);
  const [idCol, setIdCol] = useState<string>(NONE);
  const [dedupe, setDedupe] = useState(true);
  const [unknown, setUnknown] = useState<'error' | 'add' | 'skip'>('add');
  const [finalize, setFinalize] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const ner = project.type === 'ner';

  const reset = () => {
    setFile(null);
    setRows([]);
    setColumns([]);
    setResult(null);
    setError(null);
    setProgress(null);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger; reset is a new closure every render, so listing it would wipe a picked file on the next render
  useEffect(() => {
    if (open) reset();
  }, [open]);

  const onFile = async (f: File) => {
    reset();
    setFile(f);
    try {
      const parsed = await parseFile(f);
      setRows(parsed.rows);
      setColumns(parsed.columns);
      setTextCol(
        guess(parsed.columns, ['text', 'content', 'sentence', 'review', 'title', 'body']) ??
          parsed.columns[0] ??
          NONE,
      );
      setLabelCol(
        guess(
          parsed.columns,
          ner ? ['spans', 'entities'] : ['label', 'category', 'class', 'gold'],
        ) ?? NONE,
      );
      setIdCol(guess(parsed.columns, ['id', 'external_id', 'uid']) ?? NONE);
    } catch {
      setError(t('import.badJson'));
    }
  };

  const known = new Set(project.labels.map((l) => l.name));
  const incoming =
    labelCol === NONE
      ? []
      : ner
        ? rows.flatMap((r) => (parseSpans(r[labelCol]) ?? []).map((s) => s.label))
        : rows.map((r) => String(r[labelCol] ?? '').trim());
  const unknownLabels = [...new Set(incoming.filter((l) => l && !known.has(l)))];

  const start = async () => {
    if (textCol === NONE) {
      setError(t('import.noText'));
      return;
    }
    const items: ImportItemInput[] = rows
      .map((r) => {
        const text = String(r[textCol] ?? '');
        const item: ImportItemInput = { text };
        if (idCol !== NONE && r[idCol] != null) item.externalId = String(r[idCol]);
        if (labelCol !== NONE) {
          if (ner) item.spans = parseSpans(r[labelCol]);
          else if (String(r[labelCol] ?? '').trim()) item.label = String(r[labelCol]).trim();
        }
        return item;
      })
      .filter((i) => i.text.trim());
    const total: ImportResult = {
      inserted: 0,
      duplicates: 0,
      skipped: 0,
      labelsDropped: 0,
      labeled: 0,
      addedLabels: [],
      firstSeq: null,
      lastSeq: null,
      warnings: [],
    };
    setProgress({ done: 0, total: items.length });
    setError(null);
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        const r = await api.items.importBatch(project.id, {
          items: items.slice(i, i + CHUNK),
          dedupe,
          unknownLabels: unknownLabels.length ? unknown : 'error',
          finalizeImported: finalize,
        });
        total.inserted += r.inserted;
        total.duplicates += r.duplicates;
        total.skipped += r.skipped;
        total.labelsDropped += r.labelsDropped;
        total.labeled += r.labeled;
        total.addedLabels.push(...r.addedLabels);
        total.firstSeq ??= r.firstSeq;
        total.lastSeq = r.lastSeq ?? total.lastSeq;
        total.warnings.push(
          ...r.warnings.map((w) =>
            w.replace(/row (\d+)/, (_, n: string) => `row ${i + Number(n)}`),
          ),
        );
        setProgress({ done: Math.min(i + CHUNK, items.length), total: items.length });
      }
      setResult(total);
      void qc.invalidateQueries({ queryKey: qk.items(project.id) });
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.project(project.id) });
      void qc.invalidateQueries({ queryKey: qk.stats(project.id) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const options = [
    { value: NONE, label: t('import.noColumn') },
    ...columns.map((c) => ({ value: c, label: c })),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('import.title')}
      wide
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={reset}>
              {t('import.another')}
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t('common.done')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={rows.length === 0 || !!progress}
              loading={!!progress}
              onClick={() => void start()}
            >
              {progress
                ? t('import.importing', {
                    done: fmt.number(progress.done),
                    total: fmt.number(progress.total),
                  })
                : t('import.start', { n: fmt.number(rows.length) })}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" />
          <div className="text-[15px] font-semibold">{t('import.done')}</div>
          <p className="text-[13px] text-ink-2">
            {t('import.summary', {
              inserted: fmt.number(result.inserted),
              duplicates: fmt.number(result.duplicates),
              skipped: fmt.number(result.skipped),
            })}
          </p>
          {result.labeled > 0 && (
            <p className="text-xs text-ink-3">
              {t('import.labeled', { n: fmt.number(result.labeled) })}
            </p>
          )}
          {result.warnings.length > 0 && (
            <div className="mt-2 w-full rounded-lg bg-warning/10 p-3 text-left text-xs text-warning">
              <div className="mb-1 font-medium">{t('import.warnings')}</div>
              {result.warnings.slice(0, 8).map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
        </div>
      ) : !file ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void onFile(f);
          }}
          className={cn(
            'flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragOver ? 'border-accent bg-accent-soft' : 'border-line-2 hover:border-ink-3',
          )}
        >
          <FileUp className="size-8 text-ink-3" />
          <span className="text-[14px] font-medium text-ink">{t('import.drop')}</span>
          <span className="text-xs text-ink-3">{t('import.formats')}</span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </button>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 text-[13px]">
            <FileUp className="size-4 text-ink-3" />
            <span className="font-medium">{file.name}</span>
            <Badge>{t('import.rows', { n: fmt.number(rows.length) })}</Badge>
            <button
              type="button"
              className="ml-auto text-xs text-accent hover:underline"
              onClick={reset}
            >
              {t('common.edit')}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('import.textColumn')}>
              <Select value={textCol} onChange={setTextCol} options={options} size="sm" />
            </Field>
            <Field label={ner ? t('import.spansColumn') : t('import.labelColumn')}>
              <Select value={labelCol} onChange={setLabelCol} options={options} size="sm" />
            </Field>
            <Field label={t('import.idColumn')}>
              <Select value={idCol} onChange={setIdCol} options={options} size="sm" />
            </Field>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium">{t('import.preview')}</div>
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {rows.slice(0, 6).map((r, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="w-8 bg-surface-2/60 px-2 py-1.5 text-right text-ink-3 tabular">
                        {i + 1}
                      </td>
                      <td className="max-w-0 truncate px-3 py-1.5 text-ink">
                        {textCol !== NONE ? String(r[textCol] ?? '') : ''}
                      </td>
                      {labelCol !== NONE && (
                        <td className="w-40 truncate px-3 py-1.5 text-ink-2">
                          {ner
                            ? `${parseSpans(r[labelCol])?.length ?? 0} spans`
                            : String(r[labelCol] ?? '')}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-[13px] font-medium">{t('import.options')}</div>
            <Checkbox checked={dedupe} onChange={setDedupe} label={t('import.dedupe')} />
            {labelCol !== NONE && (
              <>
                <Checkbox checked={finalize} onChange={setFinalize} label={t('import.finalize')} />
                <p className="-mt-1 pl-6 text-xs text-ink-3">{t('import.finalizeHelp')}</p>
              </>
            )}
            {unknownLabels.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <TriangleAlert className="size-4 text-warning" />
                  {t('import.unknownLabels')}:{' '}
                  <span className="font-mono text-xs text-ink-2">
                    {unknownLabels.slice(0, 8).join(', ')}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {(['add', 'skip', 'error'] as const).map((k) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2"
                    >
                      <input
                        type="radio"
                        checked={unknown === k}
                        onChange={() => setUnknown(k)}
                        className="accent-[var(--accent)]"
                      />
                      {t(`import.unknown.${k}`)}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {progress && (
            <div
              className="h-1.5 overflow-hidden rounded-full"
              style={{ background: 'var(--state-track)' }}
            >
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${(progress.done / progress.total) * 100}%`,
                  background: 'var(--state-review)',
                }}
              />
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>
      )}
    </Dialog>
  );
}
