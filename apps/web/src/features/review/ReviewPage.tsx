import type { AnnotationView, ReviewEntry, Span } from '@crowd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CheckCheck,
  CornerDownLeft,
  Eye,
  EyeOff,
  Flag,
  Inbox,
  RotateCcw,
  Undo2,
  UserRound,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ProjectLabel, useLabelLookup } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Avatar, Badge, Card, EmptyState, Kbd, Skeleton } from '../../components/ui/display';
import { Segmented, Textarea } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn, isTypingTarget } from '../../lib/utils';
import { LabelPalette } from '../annotate/LabelPalette';
import { EntityList, NerCanvas } from '../annotate/NerCanvas';
import { useProjectContext } from '../projects/ProjectLayout';

type Filter = 'all' | 'disagreement' | 'flagged' | 'draft_overridden';
const strip = (s: { start: number; end: number; label: string }[] | null | undefined): Span[] =>
  (s ?? []).map(({ start, end, label }) => ({ start, end, label }));

export function ReviewPage() {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<AnnotationView | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const query = useQuery({
    queryKey: qk.review(project.id, { filter, limit: 30, offset }),
    queryFn: () => api.review.queue(project.id, { filter, limit: 30, offset }),
    placeholderData: (prev) => prev,
  });
  const entries = query.data?.entries ?? [];
  const selected = entries.find((e) => e.item.id === selectedId) ?? entries[0] ?? null;

  useEffect(() => {
    if (!selectedId && entries[0]) setSelectedId(entries[0].item.id);
  }, [entries, selectedId]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.review(project.id) });
    void qc.invalidateQueries({ queryKey: qk.stats(project.id) });
    void qc.invalidateQueries({ queryKey: qk.projects });
  };

  const moveAfter = (id: number) => {
    const i = entries.findIndex((e) => e.item.id === id);
    const next = entries[i + 1] ?? entries[i - 1];
    setSelectedId(next ? next.item.id : null);
  };

  const finalize = useMutation({
    mutationFn: (v: { itemId: number; label?: string; spans?: Span[] }) =>
      api.items.finalize(project.id, v.itemId, { label: v.label, spans: v.spans }),
    onSuccess: (_, v) => {
      toast.success(t('review.finalized'));
      moveAfter(v.itemId);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const bulk = useMutation({
    mutationFn: () => api.review.bulkFinalize(project.id, { strategy: 'unanimous' }),
    onSuccess: (r) => {
      toast.success(t('review.bulkDone', { finalized: r.finalized, skipped: r.skipped }));
      setBulkOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const decide = (label: string) =>
    selected && finalize.mutate({ itemId: selected.item.id, label });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || rejecting || !selected) return;
      const i = entries.findIndex((x) => x.item.id === selected.item.id);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (entries[i + 1]) setSelectedId(entries[i + 1]!.item.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (entries[i - 1]) setSelectedId(entries[i - 1]!.item.id);
      } else if (
        e.key === 'Enter' &&
        selected.majority &&
        !selected.majority.tie &&
        !selected.final
      ) {
        e.preventDefault();
        finalize.mutate({
          itemId: selected.item.id,
          label: selected.majority.label ?? undefined,
          spans: project.type === 'ner' ? strip(selected.majority.spans) : undefined,
        });
      } else if (project.type === 'classification' && !selected.final) {
        const label = project.labels.find((l) => l.hotkey === e.key.toLowerCase());
        if (label) decide(label.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const counts = query.data?.counts;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setOffset(0);
            setSelectedId(null);
          }}
          options={(['all', 'disagreement', 'flagged', 'draft_overridden'] as const).map((f) => ({
            value: f,
            label: t(`review.filters.${f}`),
            count: counts
              ? {
                  all: counts.all,
                  disagreement: counts.disagreement,
                  flagged: counts.flagged,
                  draft_overridden: counts.draftOverridden,
                }[f]
              : undefined,
          }))}
        />
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-ink-3 md:inline">{t('review.keysHint')}</span>
          <Button
            size="sm"
            icon={<CheckCheck className="size-4" />}
            onClick={() => setBulkOpen(true)}
            disabled={!counts?.all}
          >
            {t('review.bulkUnanimous')}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox />} title={t('review.empty')} body={t('review.emptyBody')} />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
          <div className="card overflow-hidden">
            <ul className="max-h-[calc(100vh-17rem)] divide-y divide-line overflow-y-auto">
              {entries.map((e) => (
                <li key={e.item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.item.id)}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors',
                      selected?.item.id === e.item.id ? 'bg-accent-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                      <span className="tabular">#{e.item.seq}</span>
                      {e.disagreement && (
                        <Badge tone="warning">{t('review.disagreementBadge')}</Badge>
                      )}
                      {e.flagged && <Flag className="size-3 fill-warning text-warning" />}
                      <span className="ml-auto">
                        {e.human.filter((h) => h.status === 'submitted').length}×
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">
                      {e.item.text}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {(query.data?.total ?? 0) > 30 && (
              <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-ink-3">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - 30))}
                >
                  {t('common.previous')}
                </Button>
                <span className="tabular">
                  {offset + 1}–{Math.min(offset + 30, query.data!.total)} /{' '}
                  {fmt.number(query.data!.total)}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={offset + 30 >= query.data!.total}
                  onClick={() => setOffset((o) => o + 30)}
                >
                  {t('common.next')}
                </Button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {selected && (
              <motion.div
                key={selected.item.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
              >
                <ReviewDetail
                  entry={selected}
                  onDecide={(label, spans) =>
                    finalize.mutate({ itemId: selected.item.id, label, spans })
                  }
                  deciding={finalize.isPending}
                  onReject={setRejecting}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <RejectDialog
        annotation={rejecting}
        onClose={() => setRejecting(null)}
        onDone={() => {
          setRejecting(null);
          refresh();
        }}
      />
      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={t('review.bulkUnanimous')}
        description={t('review.bulkConfirm')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={bulk.isPending} onClick={() => bulk.mutate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">{t('review.emptyBody')}</p>
      </Dialog>
    </div>
  );
}

function ReviewDetail({
  entry,
  onDecide,
  deciding,
  onReject,
}: {
  entry: ReviewEntry;
  onDecide(label?: string, spans?: Span[]): void;
  deciding: boolean;
  onReject(a: AnnotationView): void;
}) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const ner = project.type === 'ner';
  const lookup = useLabelLookup(project.labels);
  const initialSpans = useMemo(
    () => strip(entry.final?.spans ?? entry.majority?.spans ?? []),
    [entry],
  );
  const [spans, setSpans] = useState<Span[]>(initialSpans);
  useEffect(() => setSpans(initialSpans), [initialSpans]);
  const submitted = entry.human.filter((h) => h.status === 'submitted');

  const reopen = useMutation({
    mutationFn: () => api.items.reopen(project.id, entry.item.id),
    onSuccess: () => {
      toast.success(t('review.reopened'));
      void qc.invalidateQueries({ queryKey: qk.review(project.id) });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span className="tabular font-medium">{t('review.item', { seq: entry.item.seq })}</span>
          {entry.disagreement && <Badge tone="warning">{t('review.disagreementBadge')}</Badge>}
          {entry.flagged && (
            <Badge tone="warning" icon={<Flag />}>
              {t('review.filters.flagged')}
            </Badge>
          )}
          {entry.draftOverridden && (
            <Badge tone="accent" icon={<Bot />}>
              {t('review.filters.draft_overridden')}
            </Badge>
          )}
        </div>
        {ner ? (
          <NerCanvas
            text={entry.item.text}
            labels={project.labels}
            spans={spans}
            onChange={setSpans}
            size="md"
            readOnly={!!entry.final}
          />
        ) : (
          <p className="text-[19px] leading-[1.7] break-words whitespace-pre-wrap text-ink">
            {entry.item.text}
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-[13px] font-semibold text-ink">{t('review.answers')}</h3>
        <div className="flex flex-col divide-y divide-line">
          {entry.human.length === 0 && (
            <p className="py-2 text-[13px] text-ink-3">{t('review.noAnswers')}</p>
          )}
          {entry.human.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
              {h.user ? (
                <Avatar user={h.user} size={26} />
              ) : (
                <UserRound className="size-5 text-ink-3" />
              )}
              <div className="min-w-32">
                <div className="text-[13px] font-medium text-ink">
                  {h.user?.displayName ?? h.user?.username}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-ink-3">
                  {h.durationMs != null && <span>{fmt.duration(h.durationMs)}</span>}
                  {h.draftShown != null &&
                    (h.draftShown ? (
                      <span className="flex items-center gap-0.5">
                        <Eye className="size-3" />
                        {t('data.draftShown')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5">
                        <EyeOff className="size-3" />
                        {t('data.draftHidden')}
                      </span>
                    ))}
                  {h.status === 'rejected' && <Badge tone="warning">{t('review.returned')}</Badge>}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {ner ? (
                  <EntityList
                    text={entry.item.text}
                    labels={project.labels}
                    spans={strip(h.spans)}
                  />
                ) : (
                  <ProjectLabel labels={project.labels} name={h.label} />
                )}
                {h.note && <p className="mt-1 text-xs text-warning">“{h.note}”</p>}
              </div>
              {!entry.final && h.status === 'submitted' && (
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    onClick={() => onDecide(h.label ?? undefined, ner ? strip(h.spans) : undefined)}
                    disabled={deciding}
                  >
                    {t('review.useThis')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<Undo2 className="size-3.5" />}
                    onClick={() => onReject(h)}
                  >
                    {t('review.reject')}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {entry.draft && (
            <div className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="flex size-[26px] items-center justify-center rounded-full bg-accent-soft text-accent">
                <Bot className="size-3.5" />
              </div>
              <div className="min-w-32">
                <div className="text-[13px] font-medium text-ink">{t('review.draft')}</div>
                <div className="text-[11px] text-ink-3">{entry.draft.model}</div>
              </div>
              <div className="min-w-0 flex-1">
                {entry.draft.status === 'error' ? (
                  <span className="text-xs text-danger">
                    {t('review.draftError', { error: entry.draft.error ?? '?' })}
                  </span>
                ) : ner ? (
                  <EntityList
                    text={entry.item.text}
                    labels={project.labels}
                    spans={strip(entry.draft.spans)}
                  />
                ) : (
                  <ProjectLabel labels={project.labels} name={entry.draft.label} />
                )}
              </div>
            </div>
          )}
          {entry.imported && (
            <div className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="flex size-[26px] items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-ink-3">
                IMP
              </div>
              <div className="min-w-32 text-[13px] font-medium text-ink">
                {t('review.imported')}
              </div>
              <div className="min-w-0 flex-1">
                {ner ? (
                  <EntityList
                    text={entry.item.text}
                    labels={project.labels}
                    spans={strip(entry.imported.spans)}
                  />
                ) : (
                  <ProjectLabel labels={project.labels} name={entry.imported.label} />
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        {entry.final ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-ink-3">{t('review.final')}:</span>
              {ner ? (
                <span>
                  {t('annotate.entities')}: {entry.final.spans?.length ?? 0}
                </span>
              ) : (
                <ProjectLabel labels={project.labels} name={entry.final.label} />
              )}
              <span className="text-xs text-ink-3">· {entry.final.source}</span>
            </div>
            <Button
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => reopen.mutate()}
              loading={reopen.isPending}
            >
              {t('review.reopen')}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-ink">{t('review.decide')}</h3>
              {entry.majority && (
                <span className="flex items-center gap-2 text-xs text-ink-3">
                  {t('review.majority')}:
                  {entry.majority.tie ? (
                    <Badge tone="warning">{t('review.tie')}</Badge>
                  ) : ner ? (
                    <span>
                      {t('annotate.entities')}: {entry.majority.spans?.length ?? 0}
                    </span>
                  ) : (
                    <ProjectLabel labels={project.labels} name={entry.majority.label} size="sm" />
                  )}
                  <span className="tabular">
                    {t('review.votes', {
                      votes: entry.majority.votes,
                      total: entry.majority.total,
                    })}
                  </span>
                </span>
              )}
            </div>
            {ner ? (
              <div className="flex flex-col gap-3">
                <EntityList
                  text={entry.item.text}
                  labels={project.labels}
                  spans={spans}
                  onChange={setSpans}
                />
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    onClick={() => onDecide(undefined, spans)}
                    loading={deciding}
                  >
                    {t('review.finalizeAs')} ({spans.length})
                    <CornerDownLeft className="size-3.5 opacity-70" />
                  </Button>
                </div>
              </div>
            ) : (
              <LabelPalette
                labels={project.labels}
                selected={null}
                suggested={entry.draft?.status === 'submitted' ? entry.draft.label : null}
                onPick={(l) => onDecide(l)}
                disabled={deciding}
              />
            )}
            {entry.majority && !entry.majority.tie && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
                <Kbd>Enter</Kbd> {t('review.acceptMajority')}
                {!ner && entry.majority.label && (
                  <span
                    className="size-2 rounded-full"
                    style={{ background: lookup(entry.majority.label).color }}
                  />
                )}
              </p>
            )}
          </>
        )}
        {submitted.length === 0 && null}
      </Card>
    </div>
  );
}

function RejectDialog({
  annotation,
  onClose,
  onDone,
}: {
  annotation: AnnotationView | null;
  onClose(): void;
  onDone(): void;
}) {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const [note, setNote] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new annotation clears the note
  useEffect(() => setNote(''), [annotation]);
  const reject = useMutation({
    mutationFn: () => api.review.reject(project.id, annotation!.id, note.trim()),
    onSuccess: () => {
      toast.success(t('review.returned'));
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const name = annotation?.user?.displayName ?? annotation?.user?.username ?? '';
  return (
    <Dialog
      open={!!annotation}
      onOpenChange={(o) => !o && onClose()}
      title={t('review.rejectTitle')}
      description={t('review.rejectBody', { name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => reject.mutate()}
            loading={reject.isPending}
            disabled={!note.trim()}
          >
            {t('review.rejectSubmit')}
          </Button>
        </>
      }
    >
      <Textarea
        autoFocus
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('review.rejectPlaceholder')}
      />
    </Dialog>
  );
}
