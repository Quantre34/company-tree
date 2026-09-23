/**
 * Multi-workspace vault shape + the migration boundary that lets old,
 * single-doc vaults (`OrgDoc`, `schemaVersion: 1`) open transparently as a
 * one-tab `VaultDoc` (`schemaVersion: 2`). Every place that decodes a vault
 * blob, an imported backup, or the seed doc must run its parsed result
 * through `normalizeVault` (or `wrapAsWorkspace` for a doc already in hand)
 * before handing it to the store.
 */
import { nanoid } from 'nanoid';
import type { OrgDoc, VaultDoc, Workspace } from '../types/org';
import { translate as t } from '../i18n/langStore';

const DEFAULT_THEME = {
  primary: '#1F3B73', accent: '#C8102E', canvasBg: '#F2F3F5',
  nodeBg: '#FFFFFF', nodeText: '#1B2332', headerText: '#FFFFFF',
  linkColor: '#B9C0CC', fontFamily: "Roboto, Inter, 'Segoe UI', Arial, sans-serif",
};

/** Fresh single-root node, mirroring `data/seed.json`'s root shape. */
function freshRootNode(): OrgDoc['nodes'][number] {
  return {
    id: 'n_' + nanoid(6),
    parentId: null,
    order: 0,
    type: 'role',
    title: t('workspace.newRootTitle'),
    people: [],
    style: { headerStyle: 'plain' },
  };
}

/** Wrap an EXISTING doc (kept verbatim, including its nodes) as a workspace.
 * Used for migrating a legacy single-doc vault and for seeding the store —
 * never resets the tree, unlike `createBlankWorkspace`. */
export function wrapAsWorkspace(name: string, doc: OrgDoc): Workspace {
  return { id: 'w_' + nanoid(6), name, doc };
}

/**
 * Build a brand-new, empty workspace for the "+" add-tab action. Inherits
 * company identity (theme/logo/org name/layout defaults) from `templateDoc`
 * when given, but always starts with exactly one fresh root node — the tree
 * itself is independent per workspace.
 */
export function createBlankWorkspace(name: string, templateDoc?: OrgDoc): Workspace {
  const doc: OrgDoc = templateDoc
    ? {
      ...templateDoc,
      meta: { ...templateDoc.meta, updatedAt: new Date().toISOString() },
      nodes: [freshRootNode()],
      excelOnlyNotes: undefined,
    }
    : {
      schemaVersion: 1,
      meta: {
        orgName: t('workspace.defaultOrgName'),
        title: t('workspace.defaultChartTitle'),
        showLogo: false,
        updatedAt: new Date().toISOString(),
        theme: DEFAULT_THEME,
        defaults: { shape: 'rounded', nodeWidth: 190, hGap: 28, vGap: 56, layoutMode: 'horizontal' },
      },
      nodes: [freshRootNode()],
    };
  return { id: 'w_' + nanoid(6), name, doc };
}

/**
 * Shape-detect a decoded/parsed vault payload — never version-number-detect,
 * since a legacy single-doc vault is ALSO tagged `schemaVersion: 1` inside
 * `OrgDoc`, which doesn't collide with anything here (`VaultDoc` is
 * `schemaVersion: 2`), but the safe discriminator is the field that's
 * actually present: `.workspaces` (new) vs `.nodes` (old).
 */
export function normalizeVault(parsed: unknown): VaultDoc {
  const p = parsed as any;
  if (p && Array.isArray(p.workspaces)) return p as VaultDoc;
  if (p && Array.isArray(p.nodes)) {
    return { schemaVersion: 2, workspaces: [wrapAsWorkspace(t('workspace.defaultName'), p as OrgDoc)] };
  }
  throw new Error(t('error.unknownVaultFormat'));
}
