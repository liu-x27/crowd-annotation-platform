import type { ItemListQuery, ItemRow, ItemState } from '@crowd/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, Download, Flag, Search, Split, Table2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ProjectLabel } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, Skeleton } from '../../components/ui/display';
import { Input, Segmented, Select } from '../../components/ui/form';
import { Tooltip } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { useProjectContext } from '../projects/ProjectLayout';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';
import { ItemDrawer } from './ItemDrawer';

const PAGE_SIZE = 50;
const STATE_TONES: Record<ItemState, 'neutral' | 'accent' | 'warning' | 'success'> = {
  unlabeled: 'neutral',
  in_progress: 'accent',
  needs_review: 'warning',
  finalized: 'success',
};

export function DataPage() {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [openItem, setOpenItem] = useState<number | null>(null);

  const q: ItemListQuery = {
    q: params.get('q') || undefined,
    state: (params.get('state') as ItemListQuery['state']) ?? 'all',
    label: params.get('label') || undefined,
    llm: (params.get('llm') as ItemListQuery['llm']) ?? 'any',
    flagged: params.get('flagged') === '1' || undefined,
    disagreement: params.get('disagreement') === '1' || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const page = Number(params.get('page') ?? 1);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || v === 'all' || v === 'any') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounced search into the URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text should restart the timer
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) set({ q: search || null });
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const items = useQuery({
    queryKey: qk.items(project.id, q),
    queryFn: () => api.items.list(project.id, q),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((items.data?.total ?? 0) / PAGE_SIZE));

  const labelOptions = [
    { value: 'all', label: t('data.anyLabel') },
    ...project.labels.map((l) => ({ value: l.name, label: l.name })),
  ];
  const draftOptions = (['any', 'missing', 'ok', 'error', 'disagrees'] as const).map((k) => ({
    value: k,
    label: t(`data.draft.${k}`),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('data.search')}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <Segmented
          size="sm"
          value={q.state ?? 'all'}
          onChange={(v) => set({ state: v })}
          options={(['all', 'unlabeled', 'in_progress', 'needs_review', 'finalized'] as const).map(
            (s) => ({ value: s, label: t(`data.state.${s}`) }),
          )}
        />
        <Select
          size="sm"
          className="w-40"
          value={q.label ?? 'all'}
          onChange={(v) => set({ label: v })}
          options={labelOptions}
        />
        <Select
          size="sm"
          className="w-36"
          value={q.llm ?? 'any'}
          onChange={(v) => set({ llm: v })}
          options={draftOptions}
        />
        <Button
          size="sm"
          variant={q.flagged ? 'secondary' : 'ghost'}
          icon={<Flag className="size-3.5" />}
          onClick={() => set({ flagged: q.flagged ? null : '1' })}
        >
          {t('data.flaggedOnly')}
        </Button>
        <Button
          size="sm"
          variant={q.disagreement ? 'secondary' : 'ghost'}
          icon={<Split className="size-3.5" />}
          onClick={() => set({ disagreement: q.disagreement ? null : '1' })}
        >
          {t('data.disagreementOnly')}
        </Button>
        <div className="flex-1" />
        {can('project:manage') && (
          <Button
            size="sm"
            icon={<Upload className="size-4" />}
            onClick={() => set({ import: '1', page: params.get('page') })}
          >
            {t('data.import')}
          </Button>
        )}
        {can('data:export') && (
          <Button
            size="sm"
            icon={<Download className="size-4" />}
            onClick={() => set({ export: '1', page: params.get('page') })}
          >
            {t('data.export')}
          </Button>
        )}
      </div>

      <div
        className={cn(
          'card overflow-hidden transition-opacity',
          items.isFetching && items.data && 'opacity-70',
        )}
      >
        {items.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (items.data?.rows.length ?? 0) === 0 ? (
          <EmptyState icon={<Table2 />} title={t('data.empty')} body={t('data.emptyBody')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2/50 text-left text-xs text-ink-3">
                  <th className="w-16 px-4 py-2.5 font-medium">{t('data.columns.seq')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('data.columns.text')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('data.columns.state')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('data.columns.final')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('data.columns.human')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('data.columns.draft')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('data.columns.imported')}</th>
                </tr>
              </thead>
              <tbody>
                {items.data!.rows.map((r) => (
                  <Row key={r.id} row={r} onOpen={() => setOpenItem(r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.data && items.data.total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-3">
            <span className="tabular">
              {t('data.results', { n: fmt.number(items.data.total) })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => set({ page: String(page - 1) })}
              >
                {t('common.previous')}
              </Button>
              <span className="tabular">{t('common.page', { page, pages })}</span>
              <Button
                size="xs"
                variant="ghost"
                disabled={page >= pages}
                onClick={() => set({ page: String(page + 1) })}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ItemDrawer itemId={openItem} onClose={() => setOpenItem(null)} />
      <ImportDialog
        open={params.get('import') === '1'}
        onOpenChange={(o) => !o && set({ import: null, page: params.get('page') })}
      />
      <ExportDialog
        open={params.get('export') === '1'}
        onOpenChange={(o) => !o && set({ export: null, page: params.get('page') })}
      />
    </div>
  );
}

function Row({ row, onOpen }: { row: ItemRow; onOpen(): void }) {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const ner = project.type === 'ner';
  const draftDiffers =
    row.final && row.llm?.status === 'submitted' && !ner && row.llm.label !== row.final.label;
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60"
    >
      <td className="tabular px-4 py-2.5 text-ink-3">{row.seq}</td>
      <td className="max-w-[420px] px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {row.flagged && <Flag className="size-3.5 shrink-0 fill-warning text-warning" />}
          {row.disagreement && <Split className="size-3.5 shrink-0 text-warning" />}
          <span className="truncate text-ink">{row.text}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={STATE_TONES[row.state]}>{t(`data.state.${row.state}`)}</Badge>
      </td>
      <td className="px-3 py-2.5">
        {row.final ? (
          ner ? (
            <span className="text-ink-2">{row.final.spanCount ?? 0} ents</span>
          ) : (
            <ProjectLabel labels={project.labels} name={row.final.label} size="sm" />
          )
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {ner ? (
          <span className="tabular text-ink-2">{row.humanCount || '—'}</span>
        ) : (
          <div className="flex max-w-48 flex-wrap gap-1">
            {row.humanLabels.length === 0 && <span className="text-ink-3">—</span>}
            {row.humanLabels.slice(0, 3).map((l, i) => (
              <ProjectLabel key={i} labels={project.labels} name={l} size="sm" />
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        {!row.llm ? (
          <span className="text-ink-3">—</span>
        ) : row.llm.status === 'error' ? (
          <Tooltip content={t('data.draft.error')}>
            <span className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="size-3.5" />
              {t('data.status.error')}
            </span>
          </Tooltip>
        ) : ner ? (
          <span className="flex items-center gap-1 text-ink-2">
            <Bot className="size-3.5 text-ink-3" />
            {row.llm.spanCount ?? 0}
          </span>
        ) : (
          <ProjectLabel
            labels={project.labels}
            name={row.llm.label}
            size="sm"
            strike={!!draftDiffers}
          />
        )}
      </td>
      <td className="px-4 py-2.5">
        {row.imported ? (
          ner ? (
            <span className="text-ink-2">{row.imported.spanCount ?? 0}</span>
          ) : (
            <ProjectLabel labels={project.labels} name={row.imported.label} size="sm" />
          )
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
    </tr>
  );
}
