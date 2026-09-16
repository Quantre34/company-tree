import type { PositionedBox } from '../layout/layout';
import { FONT_SIZE_TITLE, FONT_SIZE_SUBTITLE, FONT_SIZE_PEOPLE, PAD_X, TITLE_LINE_H, SUBTITLE_LINE_H, PEOPLE_LINE_H } from '../layout/constants';
import type { Theme } from '../types/org';

interface Props {
  box: PositionedBox;
  theme: Theme;
  selected: boolean;
  onSelect: (id: string) => void;
  onAddChild?: (id: string) => void;
  interactive?: boolean;
}

export function NodeBox({ box, theme, selected, onSelect, onAddChild, interactive = true }: Props) {
  const n = box.node;
  const style = n.style ?? {};
  const rx = style.shape === 'sharp' ? 0 : style.shape === 'pill' ? Math.min(box.h / 2, 20) : 10;
  const fill = style.fill ?? theme.nodeBg;
  const stroke = '#DDE1E8';
  const textColor = style.textColor ?? theme.nodeText;
  const headerFill = style.headerFill ?? theme.primary;

  const inner = box.inner;

  return (
    <g
      className={'node-shell' + (selected ? ' selected' : '')}
      transform={`translate(${box.x}, ${box.y})`}
      onClick={interactive ? (e) => { e.stopPropagation(); onSelect(n.id); } : undefined}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      <rect className="frame" width={box.w} height={box.h} rx={rx} ry={rx} fill={fill} stroke={stroke} />

      {inner.hasBanner && (() => {
        const totalTitleH = inner.titleLines.length * TITLE_LINE_H;
        const firstBaseline = (inner.bannerH - totalTitleH) / 2 + TITLE_LINE_H - 4;
        return (
          <>
            <path d={roundedTopPath(box.w, inner.bannerH, rx)} fill={headerFill} />
            {inner.titleLines.map((line, i) => (
              <text
                key={i}
                x={box.w / 2}
                y={firstBaseline + i * TITLE_LINE_H}
                textAnchor="middle"
                fontSize={FONT_SIZE_TITLE}
                fontWeight={700}
                fill={theme.headerText}
                fontFamily={theme.fontFamily}
              >{line}</text>
            ))}
          </>
        );
      })()}

      {!inner.hasBanner && renderTitleSection(box, textColor, theme)}
      {renderSubtitleSection(box, textColor, theme)}
      {inner.imageBox && style.image && (
        <g>
          <clipPath id={`clip_${box.id}`}>
            <rect x={inner.imageBox.x} y={inner.imageBox.y} width={inner.imageBox.w} height={inner.imageBox.h} rx={4} ry={4} />
          </clipPath>
          <image
            x={inner.imageBox.x}
            y={inner.imageBox.y}
            width={inner.imageBox.w}
            height={inner.imageBox.h}
            href={style.image}
            preserveAspectRatio={style.imageMode === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
            clipPath={`url(#clip_${box.id})`}
          />
          <rect
            x={inner.imageBox.x} y={inner.imageBox.y}
            width={inner.imageBox.w} height={inner.imageBox.h}
            rx={4} ry={4} fill="none" stroke="#E4E7EC"
          />
        </g>
      )}
      {renderPeopleSection(box, textColor, theme)}

      {interactive && onAddChild && (
        <g
          className="node-plus"
          transform={`translate(${box.w - 10}, ${box.h - 10})`}
          onClick={(e) => { e.stopPropagation(); onAddChild(n.id); }}
        >
          <circle r={10} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={13} y={0}>+</text>
        </g>
      )}
    </g>
  );
}

function renderTitleSection(box: PositionedBox, color: string, theme: Theme) {
  const inner = box.inner;
  const section = inner.sections.find(s => s.type === 'title');
  if (!section) return null;
  return (
    <>
      {inner.titleLines.map((line, i) => (
        <text
          key={i}
          x={box.w / 2}
          y={section.y + TITLE_LINE_H * (i + 1) - 4}
          textAnchor="middle"
          fontSize={FONT_SIZE_TITLE}
          fontWeight={700}
          fill={color}
          fontFamily={theme.fontFamily}
        >{line}</text>
      ))}
    </>
  );
}

function renderSubtitleSection(box: PositionedBox, color: string, theme: Theme) {
  const inner = box.inner;
  const section = inner.sections.find(s => s.type === 'subtitle');
  if (!section) return null;
  return (
    <>
      {inner.subtitleLines.map((line, i) => (
        <text
          key={i}
          x={box.w / 2}
          y={section.y + SUBTITLE_LINE_H * (i + 1) - 3}
          textAnchor="middle"
          fontSize={FONT_SIZE_SUBTITLE}
          fontWeight={500}
          fill={color}
          opacity={0.75}
          fontFamily={theme.fontFamily}
        >{line}</text>
      ))}
    </>
  );
}

function renderPeopleSection(box: PositionedBox, color: string, theme: Theme) {
  const inner = box.inner;
  const section = inner.sections.find(s => s.type === 'people');
  if (!section) return null;
  return (
    <>
      {inner.peopleLines.map((p, i) => (
        <text
          key={p.id}
          x={box.w / 2}
          y={section.y + PEOPLE_LINE_H * (i + 1) - 3}
          textAnchor="middle"
          fontSize={FONT_SIZE_PEOPLE}
          fontWeight={400}
          fill={color}
          fontFamily={theme.fontFamily}
        >{p.text}</text>
      ))}
    </>
  );
}

function roundedTopPath(w: number, h: number, r: number): string {
  if (r <= 0) return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h} L 0 ${h} L 0 ${r} Q 0 0 ${r} 0 Z`;
}
