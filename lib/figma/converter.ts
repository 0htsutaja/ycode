'use client';

import type { Layer, DesignProperties, LayoutDesign, TypographyDesign, SpacingDesign, SizingDesign, BordersDesign, BackgroundsDesign, EffectsDesign } from '@/types';
import type { YcodeFigmaPayload, YcodeNode } from '@/lib/figma/types';
import { generateId } from '@/lib/utils';
import { designToClassString } from '@/lib/tailwind-class-mapper';
import { uploadFigmaImage, uploadFigmaSvg } from '@/lib/figma/image-handler';

function px(value: number | null | undefined): string | undefined {
  if (value == null || value === 0) return undefined;
  return `${Math.round(value * 100) / 100}px`;
}

function getLayerName(node: YcodeNode): string {
  switch (node.__class) {
    case 'TextNode': return 'text';
    case 'ImageNode': return 'image';
    case 'SvgNode': return 'image';
    default: return 'div';
  }
}

function sanitizeCustomName(name: string): string {
  return name.trim().slice(0, 100);
}

function mapLayout(node: YcodeNode): LayoutDesign | undefined {
  if (node.display !== 'flex' && node.display !== 'grid') return undefined;

  const layout: LayoutDesign = { isActive: true };

  if (node.display === 'flex') {
    layout.display = 'Flex';
    layout.flexDirection = node.flexDirection || 'column';
    if (node.flexWrap === 'wrap') layout.flexWrap = 'wrap';
    if (node.justifyContent) layout.justifyContent = node.justifyContent;
    if (node.alignItems) layout.alignItems = node.alignItems;
    if (node.gap) layout.gap = node.gap + 'px';
    if (node.rowGap != null) {
      layout.rowGap = node.rowGap + 'px';
      layout.gapMode = 'individual';
    }
    if (node.columnGap != null) {
      layout.columnGap = node.columnGap + 'px';
      layout.gapMode = 'individual';
    }
  } else {
    layout.display = 'Grid';
    if (node.justifyContent) layout.justifyContent = node.justifyContent;
    if (node.alignItems) layout.alignItems = node.alignItems;
    if (node.gap) layout.gap = node.gap + 'px';
    if (node.rowGap != null) {
      layout.rowGap = node.rowGap + 'px';
      layout.gapMode = 'individual';
    }
    if (node.columnGap != null) {
      layout.columnGap = node.columnGap + 'px';
      layout.gapMode = 'individual';
    }
  }

  return layout;
}

function mapSpacing(node: YcodeNode): SpacingDesign | undefined {
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
  if (!paddingTop && !paddingRight && !paddingBottom && !paddingLeft) return undefined;

  const allEqual = paddingTop === paddingRight && paddingRight === paddingBottom && paddingBottom === paddingLeft;

  if (allEqual) {
    return { isActive: true, padding: paddingTop + 'px', paddingMode: 'all' };
  }

  return {
    isActive: true,
    paddingTop: paddingTop + 'px',
    paddingRight: paddingRight + 'px',
    paddingBottom: paddingBottom + 'px',
    paddingLeft: paddingLeft + 'px',
    paddingMode: 'individual',
  };
}

function mapSizing(
  node: YcodeNode,
  parentFlexDir?: string | null,
): { sizing: SizingDesign; extraClasses: string[] } {
  const sizing: SizingDesign = { isActive: true };
  const extraClasses: string[] = [];

  const isMainAxisHorizontal = parentFlexDir === 'row';
  const isMainAxisVertical = parentFlexDir === 'column';

  if (node.widthType === 'fill') {
    if (isMainAxisHorizontal) {
      extraClasses.push('flex-1');
    } else {
      sizing.width = '100%';
    }
  } else if (node.widthType === 'hug') {
    sizing.width = 'fit-content';
  } else {
    sizing.width = Math.round(node.width) + 'px';
  }

  if (node.heightType === 'fill') {
    if (isMainAxisVertical) {
      extraClasses.push('flex-1');
    } else {
      sizing.height = '100%';
    }
  } else if (node.heightType === 'hug') {
    sizing.height = 'fit-content';
  } else {
    sizing.height = Math.round(node.height) + 'px';
  }

  const minW = px(node.minWidth);
  if (minW) sizing.minWidth = minW;

  const maxW = px(node.maxWidth);
  if (maxW) sizing.maxWidth = maxW;

  const minH = px(node.minHeight);
  if (minH) sizing.minHeight = minH;

  const maxH = px(node.maxHeight);
  if (maxH) sizing.maxHeight = maxH;

  if (node.overflow === 'hidden') sizing.overflow = 'hidden';

  return { sizing, extraClasses };
}

function mapBackgrounds(node: YcodeNode): BackgroundsDesign | undefined {
  if (!node.fillEnabled) return undefined;

  const backgrounds: BackgroundsDesign = { isActive: true };
  let hasValue = false;

  if (node.fillColor) {
    backgrounds.backgroundColor = node.fillColor;
    hasValue = true;
  }

  if (node.fillGradient) {
    backgrounds.backgroundImage = node.fillGradient;
    hasValue = true;
  }

  return hasValue ? backgrounds : undefined;
}

function mapBorders(node: YcodeNode): BordersDesign | undefined {
  const borders: BordersDesign = {};
  let hasValue = false;

  if (node.borderEnabled) {
    if (node.borderColor) borders.borderColor = node.borderColor;
    borders.borderStyle = node.borderStyle || 'solid';

    if (node.borderPerSide) {
      if (node.borderTop != null) borders.borderTopWidth = node.borderTop + 'px';
      if (node.borderRight != null) borders.borderRightWidth = node.borderRight + 'px';
      if (node.borderBottom != null) borders.borderBottomWidth = node.borderBottom + 'px';
      if (node.borderLeft != null) borders.borderLeftWidth = node.borderLeft + 'px';
      borders.borderWidthMode = 'individual';
    } else {
      borders.borderWidth = node.borderWidth + 'px';
      borders.borderWidthMode = 'all';
    }
    hasValue = true;
  }

  if (node.radiusPerCorner) {
    if (node.radiusTopLeft != null) borders.borderTopLeftRadius = node.radiusTopLeft + 'px';
    if (node.radiusTopRight != null) borders.borderTopRightRadius = node.radiusTopRight + 'px';
    if (node.radiusBottomRight != null) borders.borderBottomRightRadius = node.radiusBottomRight + 'px';
    if (node.radiusBottomLeft != null) borders.borderBottomLeftRadius = node.radiusBottomLeft + 'px';
    borders.borderRadiusMode = 'individual';
    hasValue = true;
  } else if (node.radius) {
    borders.borderRadius = node.radius + 'px';
    hasValue = true;
  }

  if (!hasValue) return undefined;

  borders.isActive = true;
  return borders;
}

function mapEffects(node: YcodeNode): EffectsDesign | undefined {
  const effects: EffectsDesign = {};
  let hasValue = false;

  if (node.boxShadow) {
    effects.boxShadow = node.boxShadow;
    hasValue = true;
  }

  if (node.blur) {
    effects.blur = node.blur + 'px';
    hasValue = true;
  }

  if (node.backdropBlur) {
    effects.backdropBlur = node.backdropBlur + 'px';
    hasValue = true;
  }

  if (node.opacity < 1) {
    effects.opacity = String(Math.round(node.opacity * 100) / 100);
    hasValue = true;
  }

  if (!hasValue) return undefined;

  effects.isActive = true;
  return effects;
}

// ─── Text / HTML Parsing ────────────────────────────────────────────────────

interface TipTapMark {
  type: string;
}

interface TipTapTextNode {
  type: 'text';
  text: string;
  marks?: TipTapMark[];
}

interface TipTapParagraph {
  type: 'paragraph';
  content?: TipTapTextNode[];
}

interface TipTapDoc {
  type: 'doc';
  content: TipTapParagraph[];
}

function parseInlineStyle(style: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const part of style.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (key && value) props[key] = value;
  }
  return props;
}

function parseHtmlToTypographyAndTipTap(html: string): {
  typography: TypographyDesign;
  tiptapContent: TipTapDoc;
} {
  const typography: TypographyDesign = { isActive: true };

  const spanMatch = html.match(/<span[^>]*style="([^"]*)"[^>]*>/);
  if (spanMatch) {
    const styles = parseInlineStyle(spanMatch[1]);

    if (styles['font-family']) {
      typography.fontFamily = styles['font-family'].replace(/['"]/g, '');
    }
    if (styles['font-weight']) typography.fontWeight = styles['font-weight'];
    if (styles['font-size']) typography.fontSize = styles['font-size'];
    if (styles['line-height']) typography.lineHeight = styles['line-height'];
    if (styles['letter-spacing']) typography.letterSpacing = styles['letter-spacing'];
    if (styles['text-align']) typography.textAlign = styles['text-align'];
    if (styles['text-decoration']) typography.textDecoration = styles['text-decoration'];
    if (styles['text-transform']) typography.textTransform = styles['text-transform'];
    if (styles['color']) typography.color = styles['color'];
  }

  const pMatch = html.match(/<p[^>]*style="([^"]*)"[^>]*>/);
  if (pMatch) {
    const pStyles = parseInlineStyle(pMatch[1]);
    if (pStyles['line-height'] && !typography.lineHeight) typography.lineHeight = pStyles['line-height'];
    if (pStyles['font-size'] && !typography.fontSize) typography.fontSize = pStyles['font-size'];
    if (pStyles['text-align'] && !typography.textAlign) typography.textAlign = pStyles['text-align'];
  }

  const tiptapContent = htmlToTipTap(html);

  return { typography, tiptapContent };
}

function htmlToTipTap(html: string): TipTapDoc {
  const paragraphs: TipTapParagraph[] = [];

  const pBlocks = html.match(/<p[^>]*>([\s\S]*?)<\/p>/g);
  if (!pBlocks || pBlocks.length === 0) {
    const plainText = html.replace(/<[^>]+>/g, '').trim();
    if (plainText) {
      paragraphs.push({ type: 'paragraph', content: [{ type: 'text', text: plainText }] });
    } else {
      paragraphs.push({ type: 'paragraph' });
    }
    return { type: 'doc', content: paragraphs };
  }

  for (const pBlock of pBlocks) {
    const inner = pBlock.replace(/<\/?p[^>]*>/g, '');
    const textNodes = parseSpansToTextNodes(inner);
    paragraphs.push({
      type: 'paragraph',
      content: textNodes.length > 0 ? textNodes : undefined,
    });
  }

  return { type: 'doc', content: paragraphs };
}

function parseSpansToTextNodes(html: string): TipTapTextNode[] {
  const nodes: TipTapTextNode[] = [];
  const spanRegex = /<span[^>]*(?:style="([^"]*)")?[^>]*>([\s\S]*?)<\/span>/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = spanRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const between = html.slice(lastIndex, match.index).replace(/<[^>]+>/g, '');
      if (between) nodes.push({ type: 'text', text: between });
    }

    const styleStr = match[1] || '';
    const text = match[2].replace(/<[^>]+>/g, '');
    if (!text) { lastIndex = spanRegex.lastIndex; continue; }

    const marks: TipTapMark[] = [];
    const styles = parseInlineStyle(styleStr);
    const weight = parseInt(styles['font-weight'] || '400', 10);
    if (weight >= 700) marks.push({ type: 'bold' });
    if (styles['text-decoration']?.includes('underline')) marks.push({ type: 'underline' });
    if (styles['text-decoration']?.includes('line-through')) marks.push({ type: 'strike' });
    if (styles['font-style'] === 'italic') marks.push({ type: 'italic' });

    const node: TipTapTextNode = { type: 'text', text };
    if (marks.length > 0) node.marks = marks;
    nodes.push(node);
    lastIndex = spanRegex.lastIndex;
  }

  if (lastIndex < html.length) {
    const remaining = html.slice(lastIndex).replace(/<[^>]+>/g, '');
    if (remaining) nodes.push({ type: 'text', text: remaining });
  }

  return nodes;
}

// ─── Node Conversion ────────────────────────────────────────────────────────

async function convertNode(
  node: YcodeNode,
  parentFlexDir?: string | null,
  isRoot = false,
): Promise<Layer> {
  const id = generateId('lyr');
  const design: DesignProperties = {};

  const layout = mapLayout(node);
  if (layout) design.layout = layout;

  const spacing = mapSpacing(node);
  if (spacing) design.spacing = spacing;

  const { sizing, extraClasses } = mapSizing(node, parentFlexDir);
  if (isRoot) {
    sizing.width = '100%';
    sizing.height = 'fit-content';
  }
  design.sizing = sizing;

  const backgrounds = mapBackgrounds(node);
  if (backgrounds) design.backgrounds = backgrounds;

  const borders = mapBorders(node);
  if (borders) design.borders = borders;

  const effects = mapEffects(node);
  if (effects) design.effects = effects;

  if (node.rotation) {
    design.transforms = {
      isActive: true,
      rotate: `${node.rotation}deg`,
    };
  }

  if (node.aspectRatio) {
    const sizing = design.sizing || { isActive: true };
    sizing.aspectRatio = `[${node.aspectRatio}]`;
    sizing.isActive = true;
    design.sizing = sizing;
  }

  const layerName = getLayerName(node);
  const layer: Layer = {
    id,
    name: layerName,
    customName: sanitizeCustomName(node.name),
    classes: '',
    design,
  };

  if (node.__class === 'TextNode' && node.html) {
    const { typography, tiptapContent } = parseHtmlToTypographyAndTipTap(node.html);
    design.typography = typography;

    if (node.textVerticalAlignment === 'center') {
      const layout = design.layout || { isActive: true };
      layout.display = 'Flex';
      layout.alignItems = 'center';
      layout.isActive = true;
      design.layout = layout;
    } else if (node.textVerticalAlignment === 'bottom') {
      const layout = design.layout || { isActive: true };
      layout.display = 'Flex';
      layout.alignItems = 'flex-end';
      layout.isActive = true;
      design.layout = layout;
    }

    layer.variables = {
      text: {
        type: 'dynamic_rich_text',
        data: { content: tiptapContent },
      },
    };
    layer.restrictions = { editText: true };
  }

  if (node.__class === 'ImageNode' && node.imageData) {
    const filename = `${node.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const assetId = await uploadFigmaImage(node.imageData, filename);
    if (assetId) {
      layer.variables = {
        ...layer.variables,
        image: {
          src: { type: 'asset', data: { asset_id: assetId } },
          alt: { type: 'dynamic_text', data: { content: node.name } },
        },
      };
    }
  }

  if (node.__class === 'SvgNode' && node.svgData) {
    const filename = `${node.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;
    const assetId = await uploadFigmaSvg(node.svgData, filename);
    if (assetId) {
      layer.variables = {
        ...layer.variables,
        image: {
          src: { type: 'asset', data: { asset_id: assetId } },
          alt: { type: 'dynamic_text', data: { content: node.name } },
        },
      };
    }
  }

  if (node.children?.length) {
    const thisFlexDir = node.flexDirection || null;
    const childLayers = await Promise.all(
      node.children.map(child => convertNode(child, thisFlexDir))
    );
    layer.children = childLayers;
  }

  layer.classes = designToClassString(design);
  if (extraClasses.length > 0) {
    layer.classes = layer.classes + ' ' + extraClasses.join(' ');
  }

  console.log(`[FigmaConvert] ${node.__class} "${node.name}"`, { classes: layer.classes });

  if (!node.visible) {
    layer.settings = { ...layer.settings, hidden: true };
  }

  return layer;
}

export async function convertFigmaToLayers(payload: YcodeFigmaPayload): Promise<Layer[]> {
  console.log('[FigmaConvert] payload:', payload.nodes.length, 'nodes');
  const layers = await Promise.all(
    payload.nodes.map(node => convertNode(node, null, true))
  );
  return layers;
}
