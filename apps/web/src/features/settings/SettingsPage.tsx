import type { AssignmentRange, ProjectSettings } from '@crowd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Button, IconButton } from '../../components/ui/button';
import { Avatar, Card } from '../../components/ui/display';
import { Field, Input, Segmented, Select, Slider, Textarea } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk, useUsers } from '../../lib/queries';
import { type EditableLabel, LabelEditor } from '../projects/LabelEditor';
import { useProjectContext } from '../projects/ProjectLayout';

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {hint && <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{hint}</p>}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [labels, setLabels] = useState<EditableLabel[]>([]);
  const [guidelines, setGuidelines] = useState(project.guidelines);
  const [guideTab, setGuideTab] = useState<'write' | 'preview'>('write');
  const [settings, setSettings] = useState<ProjectSettings>(project.settings);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setLabels(project.labels.map((l) => ({ ...l, original: l.name })));
    setGuidelines(project.guidelines);
    setSettings(project.settings);
  }, [project]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.project(project.id) });
    void qc.invalidateQueries({ queryKey: qk.projects });
  };
  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.projects.update>[1]) =>
      api.projects.update(project.id, body),
    onSuccess: () => {
      toast.success(t('common.saved'));
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.projects.remove(project.id),
    onSuccess: () => {
      toast.success(t('settings.deleted'));
      void qc.invalidateQueries({ queryKey: qk.projects });
      navigate('/projects');
    },
    onError: (e) => toast.error(e.message),
  });

  const saveLabels = () => {
    const renames: Record<string, string> = {};
    for (const l of labels) if (l.original && l.original !== l.name) renames[l.original] = l.name;
    update.mutate({
      labels: labels.map(({ original: _, ...l }) => l),
      labelRenames: Object.keys(renames).length ? renames : undefined,
    });
  };
  const s = (patch: Partial<ProjectSettings>) => setSettings((prev) => ({ ...prev, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('settings.general')}
        hint={project.archivedAt ? t('settings.archivedNote') : undefined}
      >
        <div className="flex flex-col gap-4">
          <Field label={t('project.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('project.description')}>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              icon={
                project.archivedAt ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )
              }
              onClick={() => update.mutate({ archived: !project.archivedAt })}
            >
              {project.archivedAt ? t('settings.unarchive') : t('settings.archive')}
            </Button>
            <Button
              variant="primary"
              onClick={() => update.mutate({ name, description })}
              disabled={name === project.name && description === project.description}
              loading={update.isPending}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title={t('settings.labels')}
        hint={
          <>
            {t('settings.renamed')} {t('settings.removeInUse')}
          </>
        }
      >
        <LabelEditor
          labels={labels}
          onChange={setLabels}
          withDescriptions
          entity={project.type === 'ner'}
        />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={saveLabels} loading={update.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </Section>

      <Section title={t('settings.guidelines')} hint={t('settings.guidelinesHelp')}>
        <Segmented
          size="sm"
          value={guideTab}
          onChange={setGuideTab}
          options={[
            { value: 'write', label: t('settings.write') },
            { value: 'preview', label: t('settings.preview') },
          ]}
        />
        <div className="mt-3">
          {guideTab === 'write' ? (
            <Textarea
              rows={12}
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              className="font-mono text-[12.5px]"
            />
          ) : (
            <div className="prose-guidelines min-h-40 rounded-lg border border-line p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{guidelines || '—'}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            onClick={() => update.mutate({ guidelines })}
            disabled={guidelines === project.guidelines}
            loading={update.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      </Section>

      <Section title={t('settings.workflow')}>
        <div className="flex flex-col gap-5">
          <Field label={t('settings.redundancy')} hint={t('settings.redundancyHelp')}>
            <Segmented
              value={String(settings.redundancy)}
              onChange={(v) => s({ redundancy: Number(v) })}
              options={['1', '2', '3', '5'].map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label={t('settings.autoFinalize')} hint={t('settings.autoFinalizeHelp')}>
            <Segmented
              value={settings.autoFinalize}
              onChange={(v) => s({ autoFinalize: v })}
              options={(['unanimous', 'never'] as const).map((v) => ({
                value: v,
                label: t(`settings.autoFinalizeOptions.${v}`),
              }))}
            />
          </Field>
          <Field label={t('settings.draftMode')} hint={t('settings.draftModeHelp')}>
            <Segmented
              value={settings.draftMode}
              onChange={(v) => s({ draftMode: v })}
              options={(['suggest', 'preselect', 'hidden'] as const).map((v) => ({
                value: v,
                label: t(`settings.draftModes.${v}`),
              }))}
            />
          </Field>
          <Field
            label={t('settings.blindRate')}
            hint={t('settings.blindRateHelp')}
            aside={
              <span className="tabular text-[13px] font-medium">
                {Math.round(settings.blindRate * 100)}%
              </span>
            }
          >
            <Slider
              value={settings.blindRate}
              onChange={(v) => s({ blindRate: v })}
              min={0}
              max={0.5}
              step={0.05}
              className="max-w-sm"
            />
          </Field>
          <Field label={t('settings.lease')} hint={t('settings.leaseHelp')}>
            <Select
              className="w-48"
              value={String(settings.leaseMinutes)}
              onChange={(v) => s({ leaseMinutes: Number(v) })}
              options={['10', '30', '60', '240'].map((v) => ({
                value: v,
                label: t('settings.minutes', { n: v }),
              }))}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => update.mutate({ settings })}
              disabled={JSON.stringify(settings) === JSON.stringify(project.settings)}
              loading={update.isPending}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Section>

      <AssignmentsSection />

      <Section title={t('settings.danger')}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
          <div>
            <div className="text-[13px] font-medium text-ink">{t('settings.deleteProject')}</div>
            <p className="mt-0.5 text-xs text-ink-3">{t('settings.deleteHelp')}</p>
          </div>
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            onClick={() => setConfirmDelete(true)}
          >
            {t('common.delete')}
          </Button>
        </div>
      </Section>

      <Dialog
        open={confirmDelete}
        onOpenChange={(o) => {
          setConfirmDelete(o);
          setTyped('');
        }}
        title={t('settings.deleteProject')}
        description={t('settings.deleteHelp')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={typed !== project.name}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <Field label={t('settings.typeToConfirm', { name: project.name })}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}

function AssignmentsSection() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const users = useUsers();
  const current = useQuery({
    queryKey: qk.assignments(project.id),
    queryFn: () => api.projects.assignments(project.id),
  });
  const [ranges, setRanges] = useState<AssignmentRange[]>([]);
  useEffect(() => {
    if (current.data)
      setRanges(
        current.data.ranges.map(({ userId, seqFrom, seqTo }) => ({ userId, seqFrom, seqTo })),
      );
  }, [current.data]);
  const save = useMutation({
    mutationFn: () => api.projects.setAssignments(project.id, ranges),
    onSuccess: (data) => {
      toast.success(t('common.saved'));
      qc.setQueryData(qk.assignments(project.id), data);
      void qc.invalidateQueries({ queryKey: qk.projects });
    },
    onError: (e) => toast.error(e.message),
  });
  const maxSeq = current.data?.maxSeq ?? 0;
  const people = (users.data ?? []).filter((u) => !u.disabled);
  const userOptions = people.map((u) => ({
    value: String(u.id),
    label: u.displayName ?? u.username,
  }));
  const update = (i: number, patch: Partial<AssignmentRange>) =>
    setRanges((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty =
    JSON.stringify(ranges) !==
    JSON.stringify(
      current.data?.ranges.map(({ userId, seqFrom, seqTo }) => ({ userId, seqFrom, seqTo })) ?? [],
    );

  return (
    <Section
      title={t('settings.assignments')}
      hint={
        <>
          {t('settings.assignmentsHelp')} {maxSeq > 0 && t('settings.maxSeq', { n: maxSeq })}
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {ranges.length === 0 && <p className="text-[13px] text-ink-3">{t('settings.noRanges')}</p>}
        {ranges.map((r, i) => {
          const u = people.find((p) => p.id === r.userId);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              {u && <Avatar user={u} size={26} />}
              <Select
                className="w-44"
                size="sm"
                value={String(r.userId)}
                onChange={(v) => update(i, { userId: Number(v) })}
                options={userOptions}
              />
              <span className="text-xs text-ink-3">{t('settings.from')}</span>
              <Input
                type="number"
                min={1}
                max={maxSeq}
                className="h-8 w-24"
                value={r.seqFrom}
                onChange={(e) => update(i, { seqFrom: Number(e.target.value) })}
              />
              <span className="text-xs text-ink-3">{t('settings.to')}</span>
              <Input
                type="number"
                min={r.seqFrom}
                max={maxSeq}
                className="h-8 w-24"
                value={r.seqTo}
                onChange={(e) => update(i, { seqTo: Number(e.target.value) })}
              />
              <span className="tabular text-xs text-ink-3">
                = {Math.max(0, r.seqTo - r.seqFrom + 1)}
              </span>
              <IconButton
                label={t('common.remove')}
                onClick={() => setRanges((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          );
        })}
        <div className="mt-2 flex justify-between gap-2">
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            disabled={people.length === 0 || maxSeq === 0}
            onClick={() =>
              setRanges((rs) => [
                ...rs,
                { userId: people[0]!.id, seqFrom: 1, seqTo: Math.min(maxSeq, 100) },
              ])
            }
          >
            {t('settings.addRange')}
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            disabled={!dirty}
            loading={save.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
