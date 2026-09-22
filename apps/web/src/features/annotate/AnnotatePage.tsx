import type {
  ClaimView,
  HistoryEntry,
  QueueView,
  Span,
  SubmitAnnotationInput,
} from '@crowd/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CornerDownLeft,
  Flag,
  Keyboard,
  MessageSquareWarning,
  PanelRight,
  SkipForward,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLabelColor } from '../../components/labels';
import { Button, IconButton } from '../../components/ui/button';
import { Badge, Kbd, Skeleton } from '../../components/ui/display';
import { Textarea } from '../../components/ui/form';
import { Tooltip } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { ApiError, api } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn, isTypingTarget } from '../../lib/utils';
import { useProjectContext } from '../projects/ProjectLayout';
import { LabelPalette } from './LabelPalette';
import { EntityList, NerCanvas, type NerCanvasHandle } from './NerCanvas';
import { ShortcutsDialog } from './ShortcutsDialog';
import { type PanelTab, SidePanel } from './SidePanel';

const strip = (spans: { start: number; end: number; label: string }[] | null | undefined): Span[] =>
  (spans ?? []).map(({ start, end, label }) => ({ start, end, label }));
const MAX_DURATION = 30 * 60_000;

export function AnnotatePage() {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const labelColor = useLabelColor();
  const qc = useQueryClient();
  const ner = project.type === 'ner';
  const byKey = new Map(project.labels.filter((l) => l.hotkey).map((l) => [l.hotkey!, l.name]));

  const [queue, setQueue] = useState<QueueView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [flagged, setFlagged] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<HistoryEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [panel, setPanel] = useState<PanelTab | null>(
    () => (localStorage.getItem('cap.panel') as PanelTab | null) ?? 'guidelines',
  );
  const [help, setHelp] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [session, setSession] = useState({ count: 0, started: Date.now() });
  const startedAt = useRef(performance.now());
  const canvas = useRef<NerCanvasHandle>(null);

  const claim = queue?.claim ?? null;
  const draftMode = project.settings.draftMode;

  useEffect(() => {
    if (panel) localStorage.setItem('cap.panel', panel);
    else localStorage.removeItem('cap.panel');
  }, [panel]);

  const applyClaim = useCallback(
    (c: ClaimView | null) => {
      setFlagged(c?.current?.flagged ?? false);
      setNote(c?.current?.note ?? '');
      if (ner)
        setSpans(
          c?.current
            ? strip(c.current.spans)
            : c?.draft && draftMode === 'preselect'
              ? strip(c.draft.spans)
              : [],
        );
      else
        setLabel(
          c?.current?.label ?? (c?.draft && draftMode === 'preselect' ? c.draft.label : null),
        );
      startedAt.current = performance.now();
    },
    [ner, draftMode],
  );

  const refreshHistory = useCallback(() => {
    void api.queue
      .history(project.id)
      .then(setHistory)
      .catch(() => undefined);
  }, [project.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = await api.queue.next(project.id);
      setQueue(q);
      applyClaim(q.claim);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project.id, applyClaim]);

  useEffect(() => {
    void load();
    refreshHistory();
  }, [load, refreshHistory]);

  // Free the item for someone else if the tab is closed mid-claim.
  useEffect(() => {
    if (!claim) return;
    const release = () => api.queue.release(project.id, claim.annotationId);
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [claim, project.id]);

  const afterWrite = useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.projects });
    refreshHistory();
  }, [qc, refreshHistory]);

  const submit = useCallback(
    async (override?: { label?: string }) => {
      if (!claim || busy) return;
      const body: SubmitAnnotationInput = {
        durationMs: Math.round(Math.min(performance.now() - startedAt.current, MAX_DURATION)),
        flagged,
        note: note.trim() || undefined,
        ...(ner ? { spans } : { label: override?.label ?? label ?? undefined }),
      };
      if (!ner && !body.label) return;
      setBusy(true);
      try {
        const res = await api.queue.submit(project.id, claim.annotationId, body);
        setSession((s) => ({ ...s, count: s.count + 1 }));
        setQueue(res.next);
        applyClaim(res.next.claim);
        afterWrite();
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'item_finalized' || e.code === 'not_claimed')) {
          toast(t('annotate.finalizedMeanwhile'));
          await load();
        } else toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [claim, busy, flagged, note, ner, spans, label, project.id, applyClaim, load, t, afterWrite],
  );

  const skip = useCallback(async () => {
    if (!claim || busy || claim.returned) return;
    setBusy(true);
    try {
      const q = await api.queue.skip(project.id, claim.annotationId);
      setQueue(q);
      applyClaim(q.claim);
      refreshHistory();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [claim, busy, project.id, applyClaim, refreshHistory]);

  const startEdit = useCallback(
    (entry: HistoryEntry) => {
      setEditing(entry);
      if (ner) setSpans(strip(entry.spans));
      else setLabel(entry.label);
      setFlagged(false);
      setNote('');
    },
    [ner],
  );

  const stopEdit = useCallback(() => {
    setEditing(null);
    applyClaim(claim);
  }, [applyClaim, claim]);

  const saveEdit = useCallback(
    async (override?: { label?: string }) => {
      if (!editing || busy) return;
      setBusy(true);
      try {
        await api.queue.edit(
          project.id,
          editing.annotationId,
          ner ? { spans } : { label: override?.label ?? label ?? undefined },
        );
        toast.success(t('annotate.changed'));
        setEditing(null);
        applyClaim(claim);
        afterWrite();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [editing, busy, project.id, ner, spans, label, t, applyClaim, claim, afterWrite],
  );

  const reclaim = useCallback(
    async (entry: HistoryEntry) => {
      try {
        const c = await api.queue.reclaim(project.id, entry.annotationId);
        setEditing(null);
        setQueue((q) => (q ? { ...q, claim: c } : { claim: c, remaining: 0, submitted: 0 }));
        applyClaim(c);
        refreshHistory();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [project.id, applyClaim, refreshHistory],
  );

  const pick = useCallback(
    (name: string) => {
      setFlash(name);
      setTimeout(() => setFlash(null), 200);
      setLabel(name);
      if (editing) void saveEdit({ label: name });
      else void submit({ label: name });
    },
    [editing, saveEdit, submit],
  );

  const goBack = useCallback(() => {
    const editable = history.filter((h) => h.status === 'submitted' && !h.final);
    if (editable.length === 0) return;
    const idx = editing ? editable.findIndex((h) => h.annotationId === editing.annotationId) : -1;
    const target = editable[idx + 1];
    if (target) startEdit(target);
  }, [history, editing, startEdit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const key = e.key.toLowerCase();
      if (e.key === '?') return setHelp(true);
      if (key === 'g') return setPanel((p) => (p === 'guidelines' ? null : 'guidelines'));
      if (e.key === 'Enter') {
        e.preventDefault();
        return editing ? void saveEdit() : void submit();
      }
      if (e.key === 'Escape') {
        if (ner && canvas.current?.clear()) return;
        if (editing) stopEdit();
        return;
      }
      if (
        ner &&
        (e.key === 'Delete' || e.key === 'Backspace') &&
        canvas.current?.removeSelected()
      ) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        return goBack();
      }
      if (key === 's' && !editing) return void skip();
      if (key === 'f' && !editing) return setFlagged((f) => !f);
      if (ner && key === 'a') return canvas.current?.acceptAllDrafts();
      const target = byKey.get(key);
      if (target) {
        e.preventDefault();
        if (ner) canvas.current?.applyLabel(target);
        else pick(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, ner, byKey, saveEdit, submit, stopEdit, goBack, skip, pick]);

  const hours = (Date.now() - session.started) / 3_600_000;
  const pace = session.count >= 3 && hours > 0 ? Math.round(session.count / hours) : null;
  const shownText = editing ? editing.text : (claim?.item.text ?? '');
  const seq = editing ? editing.seq : claim?.item.seq;
  const drafts = !editing && claim?.draft ? strip(claim.draft.spans) : [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
          <Link
            to={`/projects/${project.id}`}
            className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className="truncate font-medium text-ink">{project.name}</span>
          </Link>
          <div className="flex-1" />
          {queue && (
            <div className="tabular hidden items-center gap-3 text-xs text-ink-3 sm:flex">
              <span>{t('annotate.submittedCount', { n: fmt.number(queue.submitted) })}</span>
              <span className="text-line-2">|</span>
              <span>{t('annotate.remaining', { n: fmt.number(queue.remaining) })}</span>
              {pace != null && (
                <>
                  <span className="text-line-2">|</span>
                  <span>
                    {t('annotate.session')}: {session.count} · {t('annotate.pace', { n: pace })}
                  </span>
                </>
              )}
            </div>
          )}
          <Tooltip content={t('annotate.shortcuts')}>
            <IconButton label={t('annotate.shortcuts')} onClick={() => setHelp(true)}>
              <Keyboard className="size-4" />
            </IconButton>
          </Tooltip>
          <Tooltip content={panel ? t('common.hide') : t('annotate.guidelines')}>
            <IconButton
              label={t('annotate.guidelines')}
              onClick={() => setPanel((p) => (p ? null : 'guidelines'))}
            >
              <PanelRight className="size-4" />
            </IconButton>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-10">
            {loading ? (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-44 rounded-2xl" />
                <Skeleton className="h-28 rounded-2xl" />
              </div>
            ) : !claim && !editing ? (
              <Done count={session.count} />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={editing ? `e${editing.annotationId}` : `c${claim!.annotationId}`}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
                >
                  {editing && (
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px] text-accent">
                      <span>{t('annotate.editing', { seq: editing.seq })}</span>
                      <button
                        type="button"
                        onClick={stopEdit}
                        className="font-medium hover:underline"
                      >
                        {t('annotate.stopEditing')} <Kbd className="ml-1">Esc</Kbd>
                      </button>
                    </div>
                  )}
                  {!editing && claim?.returned && (
                    <div className="mb-4 flex gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
                      <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-warning" />
                      <div className="text-[13px]">
                        <div className="font-medium text-ink">
                          {claim.returned.reviewer
                            ? t('annotate.returnedBy', {
                                name:
                                  claim.returned.reviewer.displayName ??
                                  claim.returned.reviewer.username,
                              })
                            : t('annotate.returnedByReviewer')}
                        </div>
                        <p className="mt-0.5 text-ink-2">{claim.returned.note}</p>
                      </div>
                    </div>
                  )}

                  <div className="card p-7">
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      <span className="tabular font-medium">
                        {t('annotate.item', { seq: seq ?? '' })}
                      </span>
                      {!editing && claim?.draft && (
                        <Badge tone="accent" icon={<Bot />}>
                          {t('annotate.draftFrom', { model: claim.draft.model ?? '?' })}
                        </Badge>
                      )}
                      {!editing &&
                        claim?.draft &&
                        draftMode === 'preselect' &&
                        !ner &&
                        label === claim.draft.label && (
                          <span className="text-ink-3">{t('annotate.preselected')}</span>
                        )}
                    </div>
                    {ner ? (
                      <>
                        <NerCanvas
                          ref={canvas}
                          text={shownText}
                          labels={project.labels}
                          spans={spans}
                          onChange={setSpans}
                          drafts={drafts}
                        />
                        <div className="mt-5 border-t border-line pt-4">
                          <EntityList
                            text={shownText}
                            labels={project.labels}
                            spans={spans}
                            onChange={setSpans}
                            drafts={drafts}
                            onAcceptAll={() => canvas.current?.acceptAllDrafts()}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-[22px] leading-[1.7] break-words whitespace-pre-wrap text-ink">
                        {shownText}
                      </p>
                    )}
                  </div>

                  {ner ? (
                    <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                      <span className="mr-1">{t('annotate.selectText')}:</span>
                      {project.labels.map((l) => (
                        <span key={l.name} className="flex items-center gap-1">
                          <Kbd>{l.hotkey?.toUpperCase() ?? '·'}</Kbd>
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: labelColor(l.color) }}
                            aria-hidden
                          />
                          <span className="mr-2 text-ink-2">{l.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5">
                      <LabelPalette
                        labels={project.labels}
                        selected={label}
                        suggested={
                          !editing && draftMode === 'suggest' ? (claim?.draft?.label ?? null) : null
                        }
                        onPick={pick}
                        disabled={busy}
                        flash={flash}
                      />
                    </div>
                  )}

                  {!editing && (
                    <div className="mt-5 flex flex-col gap-3">
                      <AnimatePresence>
                        {flagged && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <Textarea
                              rows={2}
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              placeholder={t('annotate.notePlaceholder')}
                              aria-label={t('annotate.note')}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void skip()}
                          disabled={busy || !!claim?.returned}
                        >
                          <SkipForward className="size-4" />
                          {t('annotate.skip')}
                          <Kbd className="ml-1">S</Kbd>
                        </Button>
                        <Button
                          size="sm"
                          variant={flagged ? 'secondary' : 'ghost'}
                          className={cn(flagged && 'border-warning/40 text-warning')}
                          onClick={() => setFlagged((f) => !f)}
                        >
                          <Flag className={cn('size-4', flagged && 'fill-current')} />
                          {flagged ? t('annotate.flagged') : t('annotate.flag')}
                          <Kbd className="ml-1">F</Kbd>
                        </Button>
                        <div className="flex-1" />
                        {(ner || label) && (
                          <Button variant="primary" onClick={() => void submit()} loading={busy}>
                            {t('annotate.submitAndNext')}
                            <CornerDownLeft className="size-3.5 opacity-70" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {editing && ner && (
                    <div className="mt-5 flex justify-end">
                      <Button variant="primary" onClick={() => void saveEdit()} loading={busy}>
                        {t('common.save')}
                        <CornerDownLeft className="size-3.5 opacity-70" />
                      </Button>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {panel && (
          <motion.div
            className="hidden w-[340px] shrink-0 lg:block"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <SidePanel
              project={project}
              tab={panel}
              onTab={setPanel}
              history={history}
              editingId={editing?.annotationId ?? null}
              onEdit={startEdit}
              onReclaim={(h) => void reclaim(h)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <ShortcutsDialog open={help} onOpenChange={setHelp} type={project.type} />
    </div>
  );
}

function Done({ count }: { count: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <motion.div
      className="card flex flex-col items-center px-8 py-16 text-center"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <motion.div
        initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
        className="flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success"
      >
        <CheckCircle2 className="size-7" />
      </motion.div>
      <h2 className="mt-5 text-lg font-semibold">{t('annotate.done')}</h2>
      <p className="mt-1.5 max-w-sm text-[13.5px] text-ink-3">{t('annotate.doneBody')}</p>
      {count > 0 && (
        <p className="mt-3 text-[13px] text-ink-2">
          {t('annotate.session')}: {count}
        </p>
      )}
      <Button className="mt-6" onClick={() => navigate('/')}>
        {t('annotate.backToProjects')}
      </Button>
    </motion.div>
  );
}
