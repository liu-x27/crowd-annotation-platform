import type { HistoryEntry, ProjectDTO } from '@crowd/shared';
import { BookOpen, History, Undo2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectLabel } from '../../components/labels';
import { Badge } from '../../components/ui/display';
import { Segmented } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

export type PanelTab = 'guidelines' | 'history';

export function SidePanel({
  project,
  tab,
  onTab,
  history,
  editingId,
  onEdit,
  onReclaim,
}: {
  project: ProjectDTO;
  tab: PanelTab;
  onTab(t: PanelTab): void;
  history: HistoryEntry[];
  editingId: number | null;
  onEdit(entry: HistoryEntry): void;
  onReclaim(entry: HistoryEntry): void;
}) {
  const { t, fmt } = useI18n();
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-surface/60">
      <div className="flex items-center border-b border-line px-4 py-3">
        <Segmented
          size="sm"
          value={tab}
          onChange={onTab}
          options={[
            {
              value: 'guidelines',
              label: (
                <>
                  <BookOpen className="size-3.5" />
                  {t('annotate.guidelines')}
                </>
              ),
            },
            {
              value: 'history',
              label: (
                <>
                  <History className="size-3.5" />
                  {t('annotate.history')}
                </>
              ),
            },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'guidelines' ? (
          project.guidelines.trim() ? (
            <div className="prose-guidelines">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.guidelines}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">{t('annotate.noGuidelines')}</p>
          )
        ) : history.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('annotate.historyEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {history.map((h) => {
              const overruled =
                h.final &&
                h.status === 'submitted' &&
                (project.type === 'classification' ? h.final.label !== h.label : false);
              const editable = h.status === 'submitted' && !h.final;
              return (
                <li key={h.annotationId}>
                  <button
                    type="button"
                    disabled={!editable && h.status !== 'skipped'}
                    onClick={() => (h.status === 'skipped' ? onReclaim(h) : onEdit(h))}
                    className={cn(
                      'w-full rounded-lg border p-2.5 text-left transition-colors',
                      editingId === h.annotationId
                        ? 'border-accent bg-accent-soft'
                        : 'border-transparent hover:border-line hover:bg-surface',
                      !editable && h.status !== 'skipped' && 'cursor-default',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
                      <span className="tabular">#{h.seq}</span>
                      <span>{fmt.relative(h.updatedAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-2">
                      {h.text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {h.status === 'skipped' ? (
                        <Badge icon={<Undo2 />}>
                          {t('annotate.skipped')} · {t('annotate.takeBack')}
                        </Badge>
                      ) : h.status === 'rejected' ? (
                        <Badge tone="warning">{t('data.status.rejected')}</Badge>
                      ) : project.type === 'classification' ? (
                        <ProjectLabel
                          labels={project.labels}
                          name={h.label}
                          size="sm"
                          strike={!!overruled}
                        />
                      ) : (
                        <Badge>
                          {t('annotate.entities')}: {h.spans?.length ?? 0}
                        </Badge>
                      )}
                      {overruled && (
                        <>
                          <span className="text-[11px] text-ink-3">→</span>
                          <ProjectLabel labels={project.labels} name={h.final!.label} size="sm" />
                        </>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}
