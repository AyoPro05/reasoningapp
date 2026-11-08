import { z } from 'zod';

const Text = z.string().trim().min(1).max(5_000);
const Id = z.string().trim().min(1).max(128);
const Coordinate = z.number().finite().min(-10_000).max(10_000);
const SequenceCell = z.union([
  z.strictObject({ shape: z.literal('missing') }),
  z.strictObject({
    shape: z.enum(['circle', 'square', 'triangle', 'diamond', 'star', 'arrow']),
    fill: z.enum(['outline', 'solid']), rotation: z.number().min(0).max(359),
  }),
]);

export const QuestionDiagram = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sequence'), alternativeText: Text,
    cells: z.array(SequenceCell).min(1).max(30),
  }),
  z.strictObject({
    kind: z.literal('table'), alternativeText: Text,
    columns: z.array(Text).min(1).max(20),
    rows: z.array(z.array(Text).min(1).max(20)).min(1).max(100),
  }).refine((table) => table.rows.every((row) => row.length === table.columns.length), { message: 'Each row must match the column count' }),
  z.strictObject({
    kind: z.literal('mechanical'), alternativeText: Text,
    assumptions: z.array(Text).min(1).max(20),
    parts: z.array(z.strictObject({
      id: Id, kind: z.enum(['gear', 'pulley', 'lever', 'load', 'pivot', 'arrow']),
      x: Coordinate, y: Coordinate, label: Text,
    })).min(1).max(50),
    connections: z.array(z.strictObject({
      from: Id, to: Id, kind: z.enum(['meshes', 'belt', 'rope', 'supports']),
    })).max(100),
  }).refine((diagram) => {
    const ids = new Set(diagram.parts.map((part) => part.id));
    return ids.size === diagram.parts.length && diagram.connections.every((connection) =>
      ids.has(connection.from) && ids.has(connection.to) && connection.from !== connection.to);
  }, { message: 'Parts must be unique and connections must reference distinct existing parts' }),
]);

export type QuestionDiagram = z.infer<typeof QuestionDiagram>;
