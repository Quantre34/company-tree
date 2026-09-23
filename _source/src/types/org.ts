export type NodeType = 'role' | 'department' | 'group';

export interface Person {
  id: string;
  name: string;
  role?: string;
  email?: string;
  note?: string;
}

export interface NodeStyle {
  headerStyle?: 'banner' | 'plain';
  fill?: string;
  headerFill?: string;
  textColor?: string;
  shape?: 'rounded' | 'sharp' | 'pill';
  width?: number;
  image?: string;     // data URL for optional per-node image
  imageMode?: 'cover' | 'contain';
  imageHeight?: number; // px, default 90
}

export interface OrgNode {
  id: string;
  parentId: string | null;
  order: number;
  type: NodeType;
  title: string;
  subtitle?: string;
  people: Person[];
  description?: string;
  collapsed?: boolean;
  layoutMode?: 'horizontal' | 'stacked';
  style?: NodeStyle;
  /**
   * If set, this node is "floating" — not part of the tree hierarchy.
   * The layout engine skips it during tree traversal and places it at the
   * supplied absolute canvas coordinates. Dropping it on a tree node clears
   * this field and assigns a parentId.
   */
  unattached?: { x: number; y: number };
}

export interface Theme {
  primary: string;
  accent: string;
  canvasBg: string;
  nodeBg: string;
  nodeText: string;
  headerText: string;
  linkColor: string;
  fontFamily: string;
}

export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface OrgDoc {
  schemaVersion: 1;
  meta: {
    orgName: string;
    title: string;
    logoUrl?: string;
    logoCorner?: LogoCorner;
    logoWidthPct?: number;     // 0..1, fraction of page width
    showLogo?: boolean;
    updatedAt: string;
    theme: Theme;
    defaults: {
      shape: 'rounded' | 'sharp' | 'pill';
      nodeWidth: number;
      hGap: number;
      vGap: number;
      layoutMode: 'horizontal' | 'stacked';
    };
  };
  nodes: OrgNode[];
  excelOnlyNotes?: string[];
}

/**
 * One named org chart ("Türkiye", "Avrupa", "ABD", ...) — a tab in the
 * spreadsheet-style workspace switcher. Same company, same vault/password,
 * independent tree per workspace.
 */
export interface Workspace {
  id: string;
  name: string;
  doc: OrgDoc;
}

/**
 * The shape actually encrypted into the vault blob. `schemaVersion: 2`
 * distinguishes it from a legacy single-doc vault (`OrgDoc`,
 * `schemaVersion: 1`) at the persistence boundary — see
 * `persistence/vaultMigration.ts`'s `normalizeVault`.
 */
export interface VaultDoc {
  schemaVersion: 2;
  workspaces: Workspace[];
}
