import type { AnnotationView, Span } from '@crowd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Flag,
  RotateCcw,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProjectLabel } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Avatar, Badge, Skeleton } from '../../components/ui/display';
import { Drawer } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { EntityList, NerCanvas } from '../annotate/NerCanvas';
import { useProjectContext } from '../projects/ProjectLayout';

const strip = (s: { start: number; end: number; label: string }[] | null | undefined): Span[] =>
  (s ?? []).map(({ start, end, label }) => ({ start, end, label }));

function Answer({ a, text }: { a: AnnotationView; text: string }) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const [raw, setRaw] = useState(false);
  const ner = project.type === 'ner';
  const statusTone =
    a.status === 'error'
      ? 'danger'
      : a.status === 'rejected'
        ? 'warning'
        : a.status === 'submitted'
          ? 'success'
          : 'neutral';
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span className="absolute top-8 bottom-0 left-[13px] w-px bg-line last:hidden" aria-hidden />
      <div className="relative z-10 shrink-0">
        {a.source === 'human' && a.user ? (
          <Avatar user={a.user} size={27} />
        ) : a.source === 'llm' ? (
          <span className="flex size-[27px] items-center justify-center rounded-full bg-accent-soft text-accent">
            <Bot className="size-3.5" />
          </span>
        ) : a.source === 'import' ? (
          <span className="flex size-[27px] items-center justify-center rounded-full bg-surface-2 text-ink-3">
            <FileText className="size-3.5" />
          </span>
        ) : (
          <UserRound className="size-6 text-ink-3" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="font-medium text-ink">
            {a.source === 'human'
              ? (a.user?.displayName ?? a.user?.username)
              : a.source === 'llm'
                ? a.model
                : t('data.source.import')}
          </span>
          <Badge tone={statusTone}>
            {t(
              `data.status.${a.status === 'submitted' && a.source !== 'human' ? (a.source === 'llm' ? 'drafted' : 'imported') : a.status}`,
            )}
          </Badge>
          {a.flagged && <Flag className="size-3.5 fill-warning text-warning" />}
          <span className="ml-auto text-[11px] text-ink-3">
            {fmt.dateTime(a.submittedAt ?? a.createdAt)}
          </span>
        </div>
        <div className="mt-1.5">
          {a.status === 'error' ? (
            <p className="text-xs text-danger">{a.error}</p>
          ) : ner ? (
            a.spans && <EntityList text={text} labels={project.labels} spans={strip(a.spans)} />
          ) : (
            a.label && <ProjectLabel labels={project.labels} name={a.label} />
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
          {a.durationMs != null && (
            <span>{t('data.duration', { t: fmt.duration(a.durationMs) })}</span>
          )}
          {a.latencyMs != null && <span>{t('data.latency', { n: a.latencyMs })}</span>}
          {a.draftShown != null && (
            <span className="flex items-center gap-1">
              {a.draftShown ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              {a.draftShown ? t('data.draftShown') : t('data.draftHidden')}
            </span>
          )}
        </div>
        {a.note && (
          <p className="mt-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">
            {a.note}
          </p>
        )}
        {a.reviewNote && (
          <p className="mt-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
            {a.reviewNote}
          </p>
        )}
        {a.rawOutput != null && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setRaw((r) => !r)}
              className="flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-ink"
            >
              <ChevronDown className={`size-3 transition-transform ${raw ? '' : '-rotate-90'}`} />
              {t('data.rawOutput')}
            </button>
            {raw && (
              <pre className="mt-1.5 max-h-60 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
                {a.rawOutput || '∅'}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function ItemDrawer({ itemId, onClose }: { itemId: number | null; onClose(): void }) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: qk.item(project.id, itemId ?? 0),
    queryFn: () => api.items.detail(project.id, itemId!),
    enabled: itemId != null,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.items(project.id) });
    void qc.invalidateQueries({ queryKey: qk.item(project.id, itemId ?? 0) });
    void qc.invalidateQueries({ queryKey: qk.stats(project.id) });
  };
  const reopen = useMutation({
    mutationFn: () => api.items.reopen(project.id, itemId!),
    onSuccess: () => {
      toast.success(t('review.reopened'));
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.items.remove(project.id, [itemId!]),
    onSuccess: () => {
      toast.success(t('data.deleted'));
      invalidate();
      onClose();
    },
  });
  const d = detail.data;
  return (
    <Drawer
      open={itemId != null}
      onOpenChange={(o) => !o && onClose()}
      title={d ? t('data.detail', { seq: d.item.seq }) : '…'}
      actions={
        can('project:manage') && (
          <Button
            size="xs"
            variant="danger-ghost"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => window.confirm(t('data.deleteConfirm')) && remove.mutate()}
          >
            {t('common.delete')}
          </Button>
        )
      }
    >
      {!d ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-line bg-surface-2/50 p-4">
            {project.type === 'ner' ? (
              <NerCanvas
                text={d.item.text}
                labels={project.labels}
                spans={strip(d.final?.spans)}
                onChange={() => {}}
                readOnly
                size="md"
              />
            ) : (
              <p className="text-[16px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                {d.item.text}
              </p>
            )}
          </div>
          {d.final && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-ink-3">{t('review.final')}:</span>
              {project.type === 'classification' ? (
                <ProjectLabel labels={project.labels} name={d.final.label} />
              ) : (
                <span>
                  {t('annotate.entities')}: {d.final.spans?.length ?? 0}
                </span>
              )}
              <Badge>{d.final.source}</Badge>
              <span className="text-xs text-ink-3">
                {d.final.by ? `${d.final.by.displayName ?? d.final.by.username} · ` : ''}
                {fmt.dateTime(d.final.at)}
              </span>
              {can('review') && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => reopen.mutate()}
                >
                  {t('review.reopen')}
                </Button>
              )}
            </div>
          )}
          {Object.keys(d.item.meta).length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              {Object.entries(d.item.meta).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-ink-3">{k}</dt>
                  <dd className="truncate text-ink-2">
                    {typeof v === 'string' ? v : JSON.stringify(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-ink">{t('data.timeline')}</h3>
            <ol>
              {d.annotations.map((a) => (
                <Answer key={a.id} a={a} text={d.item.text} />
              ))}
            </ol>
          </div>
        </div>
      )}
    </Drawer>
  );
}
